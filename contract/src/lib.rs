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
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const MAX_SLICE: u32 = 10;

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
}

#[near]
impl Proctor {
    #[init]
    pub fn new(outlayer: AccountId, grader_project: String, grader_version: String) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            outlayer,
            grader_project,
            grader_version,
            sets: IterableMap::new(b"s"),
            certificates: Vector::new(b"c"),
        }
    }

    /// A new grader build is a new version; old certificates keep the
    /// version they were made with.
    pub fn set_grader_version(&mut self, grader_version: String) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.grader_version = grader_version;
    }

    /// Commit a set. Called by the keeper, the account whose OutLayer secret
    /// row (profile = set_id) holds the sealed questions.
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
        require!(set.runs < set.retire_after, "set is retired");
        require!(count > 0 && count <= MAX_SLICE, "count must be 1..=10");
        require!(start + count <= set.size, "slice is past the end of the set");

        let fee = set.price_per_question.0 * count as u128;
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > fee, "attach the writers' fee plus OutLayer's execution deposit");
        let exec_deposit = attached - fee;
        let requester = env::predecessor_account_id();

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
                    .on_report(PendingRun { set_id, model, start, count, requester, fee: U128(fee) }),
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
            if run.fee.0 > 0 {
                Promise::new(run.requester.clone()).transfer(NearToken::from_yoctonear(run.fee.0));
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
        };
        env::log_str(&format!("EVENT proctor certificate {} {} {}/{}", id, cert.model, cert.correct, cert.asked));
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
            "certificates": self.certificates.len(),
        })
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
    #[should_panic(expected = "set id taken")]
    fn set_ids_are_unique() {
        let mut p = setup();
        commit(&mut p, "a");
        commit(&mut p, "a");
    }
}
