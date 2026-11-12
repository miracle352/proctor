//! Budgets for AIs, held back the moment a licence drops.
//!
//! A second, independent consumer of Proctor's licence. The owner gives each
//! AI a budget and names the account allowed to spend it (the AI's
//! operator). Every spend asks Proctor for the AI's money licence first. If
//! the licence is gone, suspended by a hunter or revoked, the spend is
//! refused and the rest of the budget goes straight back to the owner, so a
//! caught AI is cut off from money in the same transaction that tries to use it.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, Vector};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Budget {
    pub operator: AccountId,
    pub left: U128,
    pub per_spend: U128,
    pub frozen: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Spend {
    pub model: String,
    pub to: AccountId,
    pub amount: U128,
    pub paid: bool,
    pub reason: String,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Budgets {
    owner: AccountId,
    proctor: AccountId,
    skill: String,
    budgets: IterableMap<String, Budget>,
    log: Vector<Spend>,
}

#[near]
impl Budgets {
    #[init]
    pub fn new(proctor: AccountId, skill: String) -> Self {
        Self { owner: env::predecessor_account_id(), proctor, skill, budgets: IterableMap::new(b"b"), log: Vector::new(b"l") }
    }

    /// Owner funds an AI's budget (attached deposit) and names its operator.
    #[payable]
    pub fn grant(&mut self, model: String, operator: AccountId, per_spend: U128) {
        require!(env::predecessor_account_id() == self.owner, "only the owner grants budgets");
        require!(model.len() <= 100, "model id too long");
        let add = env::attached_deposit().as_yoctonear();
        let left = self.budgets.get(&model).map(|b| b.left.0).unwrap_or(0) + add;
        self.budgets.insert(model.clone(), Budget { operator, left: U128(left), per_spend, frozen: false });
        env::log_str(&format!("EVENT budget granted {} {}", model, left));
    }

    /// The AI's operator spends from its budget. Proctor is asked first.
    pub fn spend(&mut self, model: String, to: AccountId, amount: U128) -> Promise {
        let b = self.budgets.get(&model).expect("no budget for this AI").clone();
        require!(env::predecessor_account_id() == b.operator, "only this AI's operator can spend its budget");
        require!(!b.frozen, "this budget is frozen: its AI lost its licence");
        require!(amount.0 > 0 && amount.0 <= b.per_spend.0 && amount.0 <= b.left.0, "amount is over the per-spend cap or the budget left");
        Promise::new(self.proctor.clone())
            .function_call("licence".to_string(), serde_json::to_vec(&json!({ "model": model, "skill": self.skill })).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(20))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(20)).on_licence(model, to, amount))
    }

    #[private]
    pub fn on_licence(&mut self, model: String, to: AccountId, amount: U128, #[callback_result] licence: Result<Value, PromiseError>) -> Spend {
        let (ok, reason) = match licence {
            Ok(v) => (v["licensed"].as_bool().unwrap_or(false), v["reason"].as_str().unwrap_or("no reason given").to_string()),
            Err(_) => (false, "Proctor did not answer".to_string()),
        };
        let mut b = self.budgets.get(&model).expect("no budget").clone();
        let paid = ok && !b.frozen && amount.0 <= b.left.0;
        if paid {
            b.left = U128(b.left.0 - amount.0);
            Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount.0));
            env::log_str(&format!("EVENT budget paid {} {} {}", model, to, amount.0));
        } else if !ok && !b.frozen {
            // cut it off: what's left goes home
            b.frozen = true;
            if b.left.0 > 0 { Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(b.left.0)); }
            env::log_str(&format!("EVENT budget frozen {} {} returned {}", model, reason, b.left.0));
            b.left = U128(0);
        }
        self.budgets.insert(model.clone(), b);
        let s = Spend { model, to, amount, paid, reason, block_height: env::block_height() };
        self.log.push(s.clone());
        s
    }

    pub fn budget(&self, model: String) -> Option<Budget> { self.budgets.get(&model).cloned() }
    pub fn list(&self) -> Vec<(String, Budget)> { self.budgets.iter().map(|(k, v)| (k.clone(), v.clone())).collect() }
    pub fn spends(&self, from: u32, limit: u32) -> Vec<Spend> { self.log.iter().skip(from as usize).take(limit as usize).cloned().collect() }
    pub fn config(&self) -> Value { json!({ "owner": self.owner, "proctor": self.proctor, "skill": self.skill, "spends": self.log.len() }) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: usize, deposit: u128) {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(10)).build());
    }
    const MILLI: u128 = 1_000_000_000_000_000_000_000;

    #[test]
    fn a_licensed_ai_spends_and_a_caught_one_is_cut_off() {
        ctx(1, 0);
        let mut b = Budgets::new(accounts(4), "money".into());
        ctx(1, 300 * MILLI);
        b.grant("m/x".into(), accounts(2), U128(100 * MILLI));
        ctx(0, 0);
        let s = b.on_licence("m/x".into(), accounts(3), U128(40 * MILLI), Ok(json!({"licensed": true, "reason": "passed"})));
        assert!(s.paid);
        assert_eq!(b.budget("m/x".into()).unwrap().left.0, 260 * MILLI);
        let s = b.on_licence("m/x".into(), accounts(3), U128(40 * MILLI), Ok(json!({"licensed": false, "reason": "suspended: paid a scam"})));
        assert!(!s.paid);
        let left = b.budget("m/x".into()).unwrap();
        assert!(left.frozen);
        assert_eq!(left.left.0, 0);
    }

    #[test]
    #[should_panic(expected = "only this AI's operator")]
    fn only_the_operator_spends() {
        ctx(1, 0);
        let mut b = Budgets::new(accounts(4), "money".into());
        ctx(1, 300 * MILLI);
        b.grant("m/x".into(), accounts(2), U128(100 * MILLI));
        ctx(3, 0);
        b.spend("m/x".into(), accounts(3), U128(10 * MILLI));
    }
}
