//! Proctor on NEAR.
//!
//! A set is committed here by its hash before anything is asked. A run is a
//! paid request: this contract calls the grader on OutLayer, checks the report
//! that comes back against the committed hash, stores a certificate and pays
//! the question writers whose questions were used. Runs against models that
//! are not served from attested hardware are written into the set's exposure
//! list, because those questions have now been seen by that provider.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const MAX_SLICE: u32 = 10;
const MIN_BOND: NearToken = NearToken::from_millinear(100);
const DAY_NS: u64 = 86_400_000_000_000;

#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    );
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SetInfo {
    /// Account that stored the sealed copy on OutLayer, under profile = set id.
    pub keeper: AccountId,
    pub sha256: String,
    pub size: u32,
    pub authors: Vec<AccountId>,
    /// Paid to writers for each question used in a run, in yoctoNEAR.
    pub price_per_question: U128,
    pub runs: u32,
    /// After this many runs the set should be revealed and replaced.
    pub retire_after: u32,
    pub revealed: bool,
    /// Providers that have seen this set's questions, e.g. "openai".
    pub exposed_to: Vec<String>,
    /// Put up by the keeper at commit. Upheld challenges are paid from it.
    pub stake: U128,
    /// Question indexes whose answer key was successfully challenged.
    pub faulty: Vec<u32>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum ChallengeStatus {
    Open,
    Upheld,
    Rejected,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Challenge {
    pub id: u64,
    pub set_id: String,
    pub item_index: u32,
    /// What the challenger says the right answer is, and why.
    pub claim: String,
    pub challenger: AccountId,
    pub bond: U128,
    pub status: ChallengeStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AuthorTally {
    pub author: String,
    pub asked: u32,
    pub correct: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Certificate {
    pub id: u64,
    pub set_id: String,
    pub set_sha256: String,
    pub grader_version: String,
    pub model: String,
    /// True when NEAR AI lists the model as served from attested hardware.
    pub sealed: bool,
    pub start: u32,
    pub asked: u32,
    pub correct: u32,
    pub failures: u32,
    pub by_author: Vec<AuthorTally>,
    /// NEAR AI chat ids; each has a signature at /v1/signature/{id}.
    pub chat_ids: Vec<String>,
    pub requester: AccountId,
    pub paid_to_authors: U128,
    pub block_height: u64,
    /// One character per question from `start`: 1 right, 0 wrong, x no answer.
    pub results: String,
}

/// What the grader prints. Field names match grader/src/lib.rs.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Report {
    set_id: String,
    set_sha256: String,
    model: String,
    sealed: bool,
    start: u32,
    asked: u32,
    correct: u32,
    by_author: std::collections::BTreeMap<String, Tally>,
    chat_ids: Vec<String>,
    failures: u32,
    #[serde(default)]
    results: String,
    /// What wrong answers on questions with stakes cost, in milliNEAR.
    #[serde(default)]
    lost_milli: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Tally {
    asked: u32,
    correct: u32,
}

#[near(serializers = [json])]
pub struct PendingRun {
    pub set_id: String,
    pub model: String,
    pub start: u32,
    pub count: u32,
    pub requester: AccountId,
    pub fee: U128,
    /// Covers the model's cost for paid models run by the public. Kept by the
    /// owner, who pays NEAR AI Cloud. Refunded if the run fails.
    #[serde(default)]
    pub ai_fee: U128,
}

/// Usage in one UTC day: (day number, questions asked).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Default)]
pub struct DayCount {
    pub day: u64,
    pub asked: u32,
}

/// A model anyone may run. `ai_fee` is charged per question on top of the
/// writers' fee, to cover what the model costs on NEAR AI Cloud.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PublicModel {
    pub ai_fee: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Proctor {
    owner: AccountId,
    outlayer: AccountId,
    grader_project: String,
    /// sha256 of the grader wasm every run is pinned to.
    grader_version: String,
    sets: IterableMap<String, SetInfo>,
    certificates: Vector<Certificate>,
    challenges: Vector<Challenge>,
    /// Builds whose marking matches the current one, so their certificates
    /// still count toward scores. Always includes grader_version.
    comparable: Vec<String>,
    /// Accounts the owner runs exams from. No model list, no daily cap.
    trusted: Vec<AccountId>,
    public_models: IterableMap<String, PublicModel>,
    /// Questions one account may ask per day, and all public accounts together.
    cap_per_account: u32,
    cap_total: u32,
    usage: LookupMap<AccountId, DayCount>,
    usage_total: DayCount,
    /// Each AI's own wallet, in yoctoNEAR. A scam it approves is paid out of it.
    wallets: IterableMap<String, u128>,
    /// Total each AI has lost to scams, in yoctoNEAR.
    lost: IterableMap<String, u128>,
    /// Where approved scams send the money: the scammer.
    scam_sink: AccountId,
    /// Certificate id -> what that run cost the AI.
    cert_losses: LookupMap<u64, u128>,
    /// What a licence for each skill requires.
    skills: IterableMap<String, Skill>,
    /// First answer per model, set and question; retries don't count.
    marked: LookupMap<String, bool>,
    /// model|set -> first answers asked, right, and when last answered.
    tallies: LookupMap<String, Tally3>,
}

#[near(serializers = [borsh])]
struct ProctorV2 {
    owner: AccountId,
    outlayer: AccountId,
    grader_project: String,
    /// sha256 of the grader wasm every run is pinned to.
    grader_version: String,
    sets: IterableMap<String, SetInfo>,
    certificates: Vector<Certificate>,
    challenges: Vector<Challenge>,
    /// Builds whose marking matches the current one, so their certificates
    /// still count toward scores. Always includes grader_version.
    comparable: Vec<String>,
    /// Accounts the owner runs exams from. No model list, no daily cap.
    trusted: Vec<AccountId>,
    public_models: IterableMap<String, PublicModel>,
    /// Questions one account may ask per day, and all public accounts together.
    cap_per_account: u32,
    cap_total: u32,
    usage: LookupMap<AccountId, DayCount>,
    usage_total: DayCount,
}

/// A licence: pass `pass_percent` over at least `min_questions` first
/// answers on these sets. It lapses `valid_days` after the last answer.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Skill {
    pub sets: Vec<String>,
    pub pass_percent: u8,
    pub min_questions: u32,
    pub valid_days: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Default)]
pub struct Tally3 {
    pub asked: u32,
    pub right: u32,
    pub last_ms: u64,
}

#[near]
impl Proctor {
    #[init]
    pub fn new(outlayer: AccountId, grader_project: String, grader_version: String) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            outlayer,
            grader_project,
            comparable: vec![grader_version.clone()],
            grader_version,
            sets: IterableMap::new(b"s"),
            certificates: Vector::new(b"c"),
            challenges: Vector::new(b"h"),
            trusted: vec![],
            public_models: IterableMap::new(b"m"),
            cap_per_account: 20,
            cap_total: 300,
            usage: LookupMap::new(b"u"),
            usage_total: DayCount::default(),
            wallets: IterableMap::new(b"w"),
            lost: IterableMap::new(b"l"),
            scam_sink: env::predecessor_account_id(),
            cert_losses: LookupMap::new(b"q"),
            skills: IterableMap::new(b"k"),
            marked: LookupMap::new(b"x"),
            tallies: LookupMap::new(b"t"),
        }
    }

    #[private]
    #[init(ignore_state)]
    pub fn migrate(scam_sink: AccountId) -> Self {
        let old: ProctorV2 = env::state_read().expect("no state to migrate");
        Self {
            owner: old.owner,
            outlayer: old.outlayer,
            grader_project: old.grader_project,
            grader_version: old.grader_version,
            sets: old.sets,
            certificates: old.certificates,
            challenges: old.challenges,
            comparable: old.comparable,
            trusted: old.trusted,
            public_models: old.public_models,
            cap_per_account: old.cap_per_account,
            cap_total: old.cap_total,
            usage: old.usage,
            usage_total: old.usage_total,
            wallets: IterableMap::new(b"w"),
            lost: IterableMap::new(b"l"),
            scam_sink,
            cert_losses: LookupMap::new(b"q"),
            skills: IterableMap::new(b"k"),
            marked: LookupMap::new(b"x"),
            tallies: LookupMap::new(b"t"),
        }
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    /// Open a model to the public, or change its fee. `ai_fee` is per question.
    pub fn set_public_model(&mut self, model: String, ai_fee: U128) {
        self.only_owner();
        self.public_models.insert(model, PublicModel { ai_fee });
    }

    pub fn remove_public_model(&mut self, model: String) {
        self.only_owner();
        self.public_models.remove(&model);
    }

    pub fn set_caps(&mut self, per_account: u32, total: u32) {
        self.only_owner();
        self.cap_per_account = per_account;
        self.cap_total = total;
    }

    /// Put NEAR in an AI's wallet. Anyone can fund any model.
    #[payable]
    pub fn fund_wallet(&mut self, model: String) {
        let add = env::attached_deposit().as_yoctonear();
        require!(add > 0, "attach the NEAR to put in the wallet");
        let have = self.wallets.get(&model).copied().unwrap_or(0);
        self.wallets.insert(model.clone(), have + add);
        env::log_str(&format!("EVENT proctor funded {} {}", model, add));
    }

    pub fn set_scam_sink(&mut self, account: AccountId) {
        self.only_owner();
        self.scam_sink = account;
    }

    pub fn set_skill(&mut self, skill: String, rule: Skill) {
        self.only_owner();
        self.skills.insert(skill, rule);
    }

    pub fn set_trusted(&mut self, accounts: Vec<AccountId>) {
        self.only_owner();
        self.trusted = accounts;
    }

    /// A new grader build is a new version; old certificates keep the
    /// version they were made with.
    /// `same_marking` says the new build marks answers exactly as the old
    /// one did, so earlier certificates keep counting toward scores.
    pub fn set_grader_version(&mut self, grader_version: String, same_marking: Option<bool>) {
        self.only_owner();
        if !same_marking.unwrap_or(false) {
            self.comparable.clear();
        }
        if !self.comparable.contains(&grader_version) {
            self.comparable.push(grader_version.clone());
        }
        self.grader_version = grader_version;
    }

    /// Commit a set. Called by the keeper, the account whose OutLayer secret
    /// row (profile = set_id) holds the sealed questions. The attached deposit
    /// is the keeper's stake behind the answer keys.
    #[payable]
    pub fn commit_set(
        &mut self,
        set_id: String,
        sha256: String,
        size: u32,
        authors: Vec<AccountId>,
        price_per_question: U128,
        retire_after: u32,
    ) {
        require!(!self.sets.contains_key(&set_id), "set id taken");
        require!(sha256.len() == 64 && sha256.chars().all(|c| c.is_ascii_hexdigit()), "sha256 must be 64 hex chars");
        require!(size > 0 && !authors.is_empty(), "empty set");
        let info = SetInfo {
            keeper: env::predecessor_account_id(),
            sha256: sha256.to_lowercase(),
            size,
            authors,
            price_per_question,
            runs: 0,
            retire_after: retire_after.max(1),
            revealed: false,
            exposed_to: vec![],
            stake: U128(env::attached_deposit().as_yoctonear()),
            faulty: vec![],
        };
        env::log_str(&format!("EVENT proctor commit {} {}", set_id, info.sha256));
        self.sets.insert(set_id, info);
    }

    /// Ask `model` questions [start, start + count) of a set. The attached
    /// deposit covers the writers' fee plus OutLayer's execution cost; what
    /// OutLayer does not use comes back to the caller.
    #[payable]
    pub fn request_run(&mut self, set_id: String, model: String, start: u32, count: u32) -> Promise {
        let set = self.sets.get(&set_id).expect("no such set").clone();
        require!(!set.revealed, "set has been revealed");
        // retire_after counts full exams: every question asked that many times.
        require!(set.runs + count <= set.retire_after * set.size, "set is retired");
        require!(count > 0 && count <= MAX_SLICE, "count must be 1..=10");
        require!(start + count <= set.size, "slice is past the end of the set");

        let requester = env::predecessor_account_id();
        let ai_fee = if requester == self.owner || self.trusted.contains(&requester) {
            0
        } else {
            let per = self.public_models.get(&model).expect("this model isn't open to the public yet").ai_fee.0;
            self.count_usage(&requester, count);
            per * count as u128
        };
        let fee = set.price_per_question.0 * count as u128;
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > fee + ai_fee, "attach the writers' fee, the model fee and OutLayer's execution deposit");
        let exec_deposit = attached - fee - ai_fee;

        let input = json!({
            "model": model,
            "expected_set_sha256": set.sha256,
            "start": start,
            "count": count,
        });

        ext_outlayer::ext(self.outlayer.clone())
            .with_attached_deposit(NearToken::from_yoctonear(exec_deposit))
            .with_unused_gas_weight(1)
            .request_execution(
                json!({ "Project": { "project_id": self.grader_project, "version_key": self.grader_version } }),
                Some(json!({ "max_instructions": 50_000_000_000u64, "max_memory_mb": 256u32, "max_execution_seconds": 180u64 })),
                Some(input.to_string()),
                Some(json!({ "account_id": set.keeper, "profile": set_id })),
                Some("Json".to_string()),
                Some(requester.clone()),
                None,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_report(PendingRun { set_id, model, start, count, requester, fee: U128(fee), ai_fee: U128(ai_fee) }),
            )
    }

    #[private]
    pub fn on_report(
        &mut self,
        run: PendingRun,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> Option<u64> {
        let refund = |why: &str| {
            env::log_str(&format!("EVENT proctor run_failed {} {}", run.set_id, why));
            if run.fee.0 + run.ai_fee.0 > 0 {
                Promise::new(run.requester.clone()).transfer(NearToken::from_yoctonear(run.fee.0 + run.ai_fee.0));
            }
            None
        };

        let value = match result {
            Ok(Some(v)) => v,
            Ok(None) => return refund("grader produced no output"),
            Err(_) => return refund("outlayer refused the request"),
        };
        let report: Report = match serde_json::from_value(value.clone()) {
            Ok(r) => r,
            Err(_) => {
                let msg = value.get("error").and_then(|e| e.as_str()).unwrap_or("unreadable report").to_string();
                return refund(&msg);
            }
        };

        let mut set = match self.sets.get(&run.set_id) {
            Some(s) => s.clone(),
            None => return refund("set disappeared"),
        };
        if report.set_sha256 != set.sha256 || report.set_id != run.set_id || report.model != run.model || report.start != run.start {
            return refund("report does not match the request");
        }

        // Pay writers in proportion to how many of their questions were used.
        let mut paid: u128 = 0;
        if report.asked > 0 && run.fee.0 > 0 {
            for (author, t) in report.by_author.iter() {
                if let Ok(acc) = author.parse::<AccountId>() {
                    if set.authors.contains(&acc) {
                        let share = run.fee.0 * t.asked as u128 / report.asked as u128;
                        if share > 0 {
                            Promise::new(acc).transfer(NearToken::from_yoctonear(share));
                            paid += share;
                        }
                    }
                }
            }
        }
        if run.fee.0 > paid {
            Promise::new(run.requester.clone()).transfer(NearToken::from_yoctonear(run.fee.0 - paid));
        }

        if !report.sealed {
            let provider = run.model.split('/').next().unwrap_or(&run.model).to_lowercase();
            if !set.exposed_to.contains(&provider) {
                set.exposed_to.push(provider);
            }
        }
        set.runs += 1;
        self.sets.insert(run.set_id.clone(), set);

        let id = self.certificates.len() as u64;
        let cert = Certificate {
            id,
            set_id: run.set_id,
            set_sha256: report.set_sha256,
            grader_version: self.grader_version.clone(),
            model: report.model,
            sealed: report.sealed,
            start: report.start,
            asked: report.asked,
            correct: report.correct,
            failures: report.failures,
            by_author: report
                .by_author
                .into_iter()
                .map(|(author, t)| AuthorTally { author, asked: t.asked, correct: t.correct })
                .collect(),
            chat_ids: report.chat_ids,
            requester: run.requester,
            paid_to_authors: U128(paid),
            block_height: env::block_height(),
            results: report.results,
        };
        env::log_str(&format!("EVENT proctor certificate {} {} {}/{}", id, cert.model, cert.correct, cert.asked));

        // First answers count toward licences; asking again doesn't improve a record.
        let now = env::block_timestamp_ms();
        let tkey = format!("{}|{}", cert.model, cert.set_id);
        let mut t = self.tallies.get(&tkey).copied().unwrap_or_default();
        for (i, ch) in cert.results.chars().enumerate() {
            if ch != '0' && ch != '1' {
                continue;
            }
            let mkey = format!("{}|{}|{}", cert.model, cert.set_id, cert.start as usize + i);
            if self.marked.get(&mkey).is_none() {
                self.marked.insert(mkey, true);
                t.asked += 1;
                if ch == '1' {
                    t.right += 1;
                }
            }
        }
        t.last_ms = now;
        self.tallies.insert(tkey, t);

        // A scam the AI approved is paid from its own wallet to the scammer.
        if report.lost_milli > 0 {
            let want = report.lost_milli as u128 * 10u128.pow(21);
            let have = self.wallets.get(&cert.model).copied().unwrap_or(0);
            let take = want.min(have);
            if take > 0 {
                self.wallets.insert(cert.model.clone(), have - take);
                let so_far = self.lost.get(&cert.model).copied().unwrap_or(0);
                self.lost.insert(cert.model.clone(), so_far + take);
                self.cert_losses.insert(id, take);
                Promise::new(self.scam_sink.clone()).transfer(NearToken::from_yoctonear(take));
                env::log_str(&format!("EVENT proctor scammed {} {} {}", id, cert.model, take));
            }
        }
        self.certificates.push(cert);
        Some(id)
    }

    /// Publish a set once it is retired. Anyone can then check every
    /// earlier certificate against these exact bytes.
    pub fn reveal(&mut self, set_id: String, plaintext: String) {
        let mut set = self.sets.get(&set_id).expect("no such set").clone();
        require!(!set.revealed, "already revealed");
        let digest = hex(&env::sha256(plaintext.as_bytes()));
        require!(digest == set.sha256, "plaintext does not match the committed hash");
        set.revealed = true;
        self.sets.insert(set_id.clone(), set);
        env::log_str(&format!("EVENT proctor revealed {}", set_id));
    }

    /// Once a set is public, anyone can dispute one answer key. The bond is
    /// lost to the keeper if the challenge fails.
    #[payable]
    pub fn challenge(&mut self, set_id: String, item_index: u32, claim: String) -> u64 {
        let set = self.sets.get(&set_id).expect("no such set");
        require!(set.revealed, "challenges open once the set is revealed");
        require!(item_index < set.size, "no such question");
        require!(!set.faulty.contains(&item_index), "already marked faulty");
        require!(env::attached_deposit() >= MIN_BOND, "bond is at least 0.1 NEAR");
        require!(!claim.is_empty() && claim.len() <= 2000, "claim must be 1..=2000 bytes");
        let id = self.challenges.len() as u64;
        self.challenges.push(Challenge {
            id,
            set_id,
            item_index,
            claim,
            challenger: env::predecessor_account_id(),
            bond: U128(env::attached_deposit().as_yoctonear()),
            status: ChallengeStatus::Open,
        });
        env::log_str(&format!("EVENT proctor challenge {id}"));
        id
    }

    /// Reviewed by the owner for now. Upheld: the challenger gets the bond
    /// back plus one question's share of the stake, and the question is
    /// dropped from adjusted scores. Rejected: the bond goes to the keeper.
    pub fn resolve_challenge(&mut self, id: u64, upheld: bool) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        let mut c = self.challenges.get(id as u32).expect("no such challenge").clone();
        require!(c.status == ChallengeStatus::Open, "already resolved");
        let mut set = self.sets.get(&c.set_id).expect("no such set").clone();
        if upheld {
            let share = set.stake.0 / set.size as u128;
            set.stake = U128(set.stake.0 - share);
            set.faulty.push(c.item_index);
            Promise::new(c.challenger.clone()).transfer(NearToken::from_yoctonear(c.bond.0 + share));
            c.status = ChallengeStatus::Upheld;
        } else {
            Promise::new(set.keeper.clone()).transfer(NearToken::from_yoctonear(c.bond.0));
            c.status = ChallengeStatus::Rejected;
        }
        env::log_str(&format!("EVENT proctor challenge_resolved {} {}", id, upheld));
        self.sets.insert(c.set_id.clone(), set);
        self.challenges.replace(id as u32, c);
    }

    pub fn get_challenges(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Challenge> {
        let from = from.unwrap_or(0);
        let end = (from + limit.unwrap_or(50)).min(self.challenges.len() as u64);
        (from..end).filter_map(|i| self.challenges.get(i as u32).cloned()).collect()
    }

    pub fn get_set(&self, set_id: String) -> Option<SetInfo> {
        self.sets.get(&set_id).cloned()
    }

    pub fn list_sets(&self, from: Option<u32>, limit: Option<u32>) -> Vec<(String, SetInfo)> {
        self.sets
            .iter()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn get_certificates(&self, from: Option<u64>, limit: Option<u64>) -> Vec<Certificate> {
        let from = from.unwrap_or(0);
        let end = (from + limit.unwrap_or(50)).min(self.certificates.len() as u64);
        (from..end).filter_map(|i| self.certificates.get(i as u32).cloned()).collect()
    }

    pub fn config(&self) -> Value {
        json!({
            "owner": self.owner,
            "outlayer": self.outlayer,
            "grader_project": self.grader_project,
            "grader_version": self.grader_version,
            "comparable": self.comparable,
            "certificates": self.certificates.len(),
            "cap_per_account": self.cap_per_account,
            "cap_total": self.cap_total,
        })
    }

    /// Every AI wallet: what's left and what scams have taken.
    pub fn list_wallets(&self) -> Vec<Value> {
        let mut names: Vec<String> = self.wallets.keys().cloned().collect();
        for k in self.lost.keys() {
            if !names.contains(k) {
                names.push(k.clone());
            }
        }
        names.into_iter().map(|m| json!({
            "model": m,
            "balance": U128(self.wallets.get(&m).copied().unwrap_or(0)),
            "lost": U128(self.lost.get(&m).copied().unwrap_or(0)),
        })).collect()
    }

    pub fn cert_loss(&self, id: u64) -> U128 {
        U128(self.cert_losses.get(&id).copied().unwrap_or(0))
    }

    pub fn list_skills(&self) -> Vec<(String, Skill)> {
        self.skills.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Whether `model` holds a licence for `skill`. Contracts can call this
    /// before letting an AI act. `maker_saw_exam` is true when the model runs
    /// on its maker's servers, so the maker has seen at least one exam set.
    pub fn licence(&self, model: String, skill: String) -> Value {
        let Some(rule) = self.skills.get(&skill) else {
            return json!({ "licensed": false, "reason": "no such skill" });
        };
        let mut t = Tally3::default();
        for set in &rule.sets {
            if let Some(x) = self.tallies.get(&format!("{}|{}", model, set)) {
                t.asked += x.asked;
                t.right += x.right;
                t.last_ms = t.last_ms.max(x.last_ms);
            }
        }
        let percent = if t.asked > 0 { t.right * 100 / t.asked } else { 0 };
        let expires_ms = t.last_ms + rule.valid_days as u64 * 86_400_000;
        let provider = model.split('/').next().unwrap_or("").to_lowercase();
        let maker_saw_exam = rule.sets.iter().any(|s| self.sets.get(s).map(|x| x.exposed_to.contains(&provider)).unwrap_or(false));
        // Like a driving test: refusing an honest bill is a minor fault, but
        // any money lost to a scam is a serious fault and fails the exam.
        let lost = self.lost.get(&model).copied().unwrap_or(0);
        let (licensed, reason) = if t.asked < rule.min_questions {
            (false, format!("has answered {} of the {} questions needed", t.asked, rule.min_questions))
        } else if lost > 0 {
            let milli = lost / 10u128.pow(21);
            (false, format!("paid scammers {}.{:03} NEAR; one scam paid fails the exam", milli / 1000, milli % 1000))
        } else if percent < rule.pass_percent as u32 {
            (false, format!("scored {}%, needs {}%", percent, rule.pass_percent))
        } else if env::block_timestamp_ms() > expires_ms {
            (false, "licence expired; sit the exam again".to_string())
        } else {
            (true, format!("passed with {}%", percent))
        };
        json!({
            "model": model, "skill": skill, "licensed": licensed, "reason": reason,
            "percent": percent, "asked": t.asked, "right": t.right,
            "pass_percent": rule.pass_percent, "min_questions": rule.min_questions,
            "expires_ms": expires_ms, "maker_saw_exam": maker_saw_exam,
            "lost": U128(self.lost.get(&model).copied().unwrap_or(0)),
        })
    }

    pub fn list_public_models(&self) -> Vec<(String, PublicModel)> {
        self.public_models.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Questions this account can still ask today, and all public accounts together.
    pub fn allowance(&self, account_id: AccountId) -> Value {
        let today = env::block_timestamp() / DAY_NS;
        let mine = self.usage.get(&account_id).filter(|d| d.day == today).map(|d| d.asked).unwrap_or(0);
        let all = if self.usage_total.day == today { self.usage_total.asked } else { 0 };
        let unlimited = account_id == self.owner || self.trusted.contains(&account_id);
        json!({
            "unlimited": unlimited,
            "account_left": self.cap_per_account.saturating_sub(mine),
            "total_left": self.cap_total.saturating_sub(all),
        })
    }
}

impl Proctor {
    fn count_usage(&mut self, who: &AccountId, count: u32) {
        let today = env::block_timestamp() / DAY_NS;
        let mut mine = self.usage.get(who).copied().filter(|d| d.day == today).unwrap_or(DayCount { day: today, asked: 0 });
        if self.usage_total.day != today {
            self.usage_total = DayCount { day: today, asked: 0 };
        }
        require!(mine.asked + count <= self.cap_per_account, "this account has used today's questions; try again tomorrow");
        require!(self.usage_total.asked + count <= self.cap_total, "the site has used today's questions; try again tomorrow");
        mine.asked += count;
        self.usage_total.asked += count;
        self.usage.insert(who.clone(), mine);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn setup() -> Proctor {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        Proctor::new("outlayer.testnet".parse().unwrap(), "owner.testnet/grader".into(), "ab".repeat(32))
    }

    fn commit(p: &mut Proctor, plaintext: &str) {
        p.commit_set(
            "set-1".into(),
            hex(&env::sha256(plaintext.as_bytes())),
            10,
            vec![accounts(1), accounts(2)],
            U128(1_000),
            5,
        );
    }

    #[test]
    #[should_panic(expected = "isn't open to the public")]
    fn public_cannot_run_unlisted_model() {
        let mut p = setup();
        commit(&mut p, "x");
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(3)).attached_deposit(NearToken::from_near(1)).build());
        p.request_run("set-1".into(), "anthropic/claude-opus-5-5".into(), 0, 1);
    }

    #[test]
    #[should_panic(expected = "used today's questions")]
    fn daily_cap_per_account() {
        let mut p = setup();
        commit(&mut p, "x");
        p.set_caps(1, 100);
        let who: AccountId = accounts(3);
        p.count_usage(&who, 1);
        p.count_usage(&who, 1);
    }

    #[test]
    fn grader_upgrade_keeps_scores_when_marking_is_unchanged() {
        let mut p = setup();
        p.set_grader_version("cd".repeat(32), Some(true));
        assert_eq!(p.comparable.len(), 2);
        p.set_grader_version("ef".repeat(32), None);
        assert_eq!(p.comparable, vec!["ef".repeat(32)]);
    }

    #[test]
    fn licence_needs_enough_first_answers_and_the_pass_mark() {
        let mut p = setup();
        p.set_skill("money".into(), Skill { sets: vec!["set-1".into()], pass_percent: 90, min_questions: 2, valid_days: 30 });
        p.tallies.insert("m/x|set-1".into(), Tally3 { asked: 1, right: 1, last_ms: 0 });
        assert_eq!(p.licence("m/x".into(), "money".into())["licensed"], false);
        p.tallies.insert("m/x|set-1".into(), Tally3 { asked: 10, right: 9, last_ms: 0 });
        assert_eq!(p.licence("m/x".into(), "money".into())["licensed"], true);
        p.tallies.insert("m/x|set-1".into(), Tally3 { asked: 10, right: 8, last_ms: 0 });
        assert_eq!(p.licence("m/x".into(), "money".into())["licensed"], false);
        p.tallies.insert("m/x|set-1".into(), Tally3 { asked: 10, right: 10, last_ms: 0 });
        p.lost.insert("m/x".into(), 5 * 10u128.pow(22));
        let l = p.licence("m/x".into(), "money".into());
        assert_eq!(l["licensed"], false);
        assert!(l["reason"].as_str().unwrap().contains("0.050 NEAR"));
    }

    #[test]
    fn anyone_can_fund_a_wallet() {
        let mut p = setup();
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(4)).attached_deposit(NearToken::from_near(1)).build());
        p.fund_wallet("m/x".into());
        assert_eq!(p.list_wallets()[0]["balance"], json!(U128(NearToken::from_near(1).as_yoctonear())));
    }

    #[test]
    fn reveal_must_match_commitment() {
        let mut p = setup();
        commit(&mut p, "{\"set_id\":\"set-1\"}");
        p.reveal("set-1".into(), "{\"set_id\":\"set-1\"}".into());
        assert!(p.get_set("set-1".into()).unwrap().revealed);
    }

    #[test]
    #[should_panic(expected = "plaintext does not match")]
    fn swapped_set_is_rejected() {
        let mut p = setup();
        commit(&mut p, "original");
        p.reveal("set-1".into(), "something else".into());
    }

    #[test]
    fn upheld_challenge_marks_question_faulty() {
        let mut p = setup();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(0))
            .attached_deposit(NearToken::from_near(1))
            .build());
        commit(&mut p, "x");
        p.reveal("set-1".into(), "x".into());
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_millinear(100))
            .build());
        let id = p.challenge("set-1".into(), 4, "key says 12, the working gives 14".into());
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        p.resolve_challenge(id, true);
        let set = p.get_set("set-1".into()).unwrap();
        assert_eq!(set.faulty, vec![4]);
        assert_eq!(set.stake.0, NearToken::from_near(1).as_yoctonear() * 9 / 10);
        assert_eq!(p.get_challenges(None, None)[0].status, ChallengeStatus::Upheld);
    }

    #[test]
    #[should_panic(expected = "challenges open once the set is revealed")]
    fn no_challenges_while_sealed() {
        let mut p = setup();
        commit(&mut p, "x");
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_millinear(100))
            .build());
        p.challenge("set-1".into(), 0, "wrong".into());
    }

    #[test]
    #[should_panic(expected = "set id taken")]
    fn set_ids_are_unique() {
        let mut p = setup();
        commit(&mut p, "a");
        commit(&mut p, "a");
    }
}
