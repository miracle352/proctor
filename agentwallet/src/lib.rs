//! Licensed agent wallets.
//!
//! An owner opens a wallet for an AI agent and names the agent's account.
//! That account holds only a function-call key for `spend` here, so the
//! agent can't move money any other way, and it can't attach deposits. Each
//! spend asks Proctor whether the agent holds a money licence; if it doesn't
//! (never passed, or caught paying a hunter's trap), the wallet freezes and
//! everything left goes back to the owner in the same transaction.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Wallet {
    pub owner: AccountId,
    /// The model or agent id whose licence this wallet follows.
    pub model: String,
    pub agent: AccountId,
    pub left: U128,
    pub per_spend: U128,
    pub spent: U128,
    pub frozen: bool,
    pub reason: String,
    pub opened_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Spend {
    pub agent: AccountId,
    pub model: String,
    pub to: AccountId,
    pub amount: U128,
    pub paid: bool,
    pub reason: String,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AgentWallets {
    proctor: AccountId,
    skill: String,
    wallets: IterableMap<AccountId, Wallet>,
    log: Vector<Spend>,
}

#[near]
impl AgentWallets {
    #[init]
    pub fn new(proctor: AccountId, skill: String) -> Self {
        Self { proctor, skill, wallets: IterableMap::new(b"w"), log: Vector::new(b"l") }
    }

    /// Open a wallet for `agent` (the account the agent signs with). The
    /// attached deposit is its budget; the caller is the owner.
    #[payable]
    pub fn open(&mut self, model: String, agent: AccountId, per_spend: U128) {
        require!(model.len() <= 120, "model id too long");
        require!(!self.wallets.contains_key(&agent), "that agent account already has a wallet");
        let budget = env::attached_deposit().as_yoctonear();
        require!(budget > 0 && per_spend.0 > 0 && per_spend.0 <= budget, "attach a budget, and keep the per-spend cap within it");
        self.wallets.insert(agent.clone(), Wallet {
            owner: env::predecessor_account_id(), model: model.clone(), agent: agent.clone(), left: U128(budget), per_spend,
            spent: U128(0), frozen: false, reason: "open".into(), opened_ms: env::block_timestamp_ms(),
        });
        env::log_str(&format!("EVENT wallet opened {} {} {}", agent, model, budget));
    }

    /// The owner adds to a wallet that isn't frozen.
    #[payable]
    pub fn top_up(&mut self, agent: AccountId) {
        let mut w = self.wallets.get(&agent).expect("no such wallet").clone();
        require!(env::predecessor_account_id() == w.owner, "only the owner tops up");
        require!(!w.frozen, "this wallet is frozen");
        w.left = U128(w.left.0 + env::attached_deposit().as_yoctonear());
        self.wallets.insert(agent, w);
    }

    /// The owner closes a wallet and takes back what's left.
    pub fn close(&mut self, agent: AccountId) {
        let mut w = self.wallets.get(&agent).expect("no such wallet").clone();
        require!(env::predecessor_account_id() == w.owner, "only the owner closes it");
        if w.left.0 > 0 { Promise::new(w.owner.clone()).transfer(NearToken::from_yoctonear(w.left.0)); }
        w.left = U128(0);
        w.frozen = true;
        w.reason = "closed by its owner".into();
        self.wallets.insert(agent, w);
    }

    /// The agent pays someone. Callable only by the agent's own account;
    /// Proctor is asked about the licence before anything moves.
    pub fn spend(&mut self, to: AccountId, amount: U128) -> Promise {
        let agent = env::predecessor_account_id();
        let w = self.wallets.get(&agent).expect("this account has no wallet").clone();
        require!(!w.frozen, "this wallet is frozen");
        require!(to != agent && to != env::current_account_id(), "can't pay itself");
        require!(amount.0 > 0 && amount.0 <= w.per_spend.0 && amount.0 <= w.left.0, "over the per-spend cap or what's left");
        Promise::new(self.proctor.clone())
            .function_call("licence".to_string(), serde_json::to_vec(&json!({ "model": w.model, "skill": self.skill })).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(25))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(20)).on_licence(agent, to, amount))
    }

    #[private]
    pub fn on_licence(&mut self, agent: AccountId, to: AccountId, amount: U128, #[callback_result] licence: Result<Value, PromiseError>) -> Spend {
        let (ok, reason) = match licence {
            Ok(v) => (v["licensed"].as_bool().unwrap_or(false), v["reason"].as_str().unwrap_or("no reason given").to_string()),
            Err(_) => (false, "Proctor did not answer".to_string()),
        };
        let mut w = self.wallets.get(&agent).expect("no wallet").clone();
        let paid = ok && !w.frozen && amount.0 <= w.left.0;
        if paid {
            w.left = U128(w.left.0 - amount.0);
            w.spent = U128(w.spent.0 + amount.0);
            Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount.0));
            env::log_str(&format!("EVENT wallet paid {} {} {}", agent, to, amount.0));
        } else if !ok && !w.frozen {
            w.frozen = true;
            w.reason = reason.clone();
            if w.left.0 > 0 { Promise::new(w.owner.clone()).transfer(NearToken::from_yoctonear(w.left.0)); }
            env::log_str(&format!("EVENT wallet frozen {} returned {} {}", agent, w.left.0, reason));
            w.left = U128(0);
        }
        let model = w.model.clone();
        self.wallets.insert(agent.clone(), w);
        let s = Spend { agent, model, to, amount, paid, reason, block_height: env::block_height() };
        self.log.push(s.clone());
        s
    }

    pub fn wallet(&self, agent: AccountId) -> Option<Wallet> { self.wallets.get(&agent).cloned() }
    pub fn wallets_of(&self, owner: AccountId) -> Vec<Wallet> { self.wallets.values().filter(|w| w.owner == owner).cloned().collect() }
    pub fn wallets_for(&self, model: String) -> Vec<Wallet> { self.wallets.values().filter(|w| w.model == model).cloned().collect() }
    pub fn list(&self, from: u32, limit: u32) -> Vec<Wallet> { self.wallets.values().skip(from as usize).take(limit as usize).cloned().collect() }
    pub fn spends(&self, from: u32, limit: u32) -> Vec<Spend> { self.log.iter().skip(from as usize).take(limit as usize).cloned().collect() }
    pub fn config(&self) -> Value { json!({ "proctor": self.proctor, "skill": self.skill, "wallets": self.wallets.len(), "spends": self.log.len() }) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;
    const MILLI: u128 = 1_000_000_000_000_000_000_000;

    fn ctx(who: usize, deposit: u128) {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(10)).build());
    }
    fn opened() -> AgentWallets {
        ctx(1, 0);
        let mut c = AgentWallets::new(accounts(5), "money".into());
        ctx(1, 500 * MILLI);
        c.open("agent:o/a".into(), accounts(2), U128(100 * MILLI));
        c
    }

    #[test]
    fn licensed_agent_pays_and_a_caught_one_freezes() {
        let mut c = opened();
        ctx(0, 0);
        assert!(c.on_licence(accounts(2), accounts(3), U128(60 * MILLI), Ok(json!({"licensed": true, "reason": "passed"}))).paid);
        let s = c.on_licence(accounts(2), accounts(3), U128(60 * MILLI), Ok(json!({"licensed": false, "reason": "revoked: paid a scam"})));
        assert!(!s.paid);
        let w = c.wallet(accounts(2)).unwrap();
        assert!(w.frozen && w.left.0 == 0 && w.spent.0 == 60 * MILLI && w.reason.starts_with("revoked"));
    }

    #[test]
    #[should_panic(expected = "this account has no wallet")]
    fn only_the_agent_account_spends() {
        let mut c = opened();
        ctx(1, 0);
        c.spend(accounts(3), U128(10 * MILLI));
    }

    #[test]
    #[should_panic(expected = "over the per-spend cap")]
    fn per_spend_cap_holds() {
        let mut c = opened();
        ctx(2, 0);
        c.spend(accounts(3), U128(150 * MILLI));
    }

    #[test]
    fn owner_closes_and_takes_back() {
        let mut c = opened();
        ctx(1, 0);
        c.close(accounts(2));
        assert!(c.wallet(accounts(2)).unwrap().frozen);
    }
}
