//! A tiny agent wallet that only lets an AI spend if Proctor says it holds a
//! licence for handling money. It shows how any NEAR contract can make an AI
//! pass a sealed exam before it acts: one cross-contract call to `licence`.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::Vector;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Attempt {
    pub model: String,
    pub asked_by: AccountId,
    pub paid: bool,
    pub reason: String,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    proctor: AccountId,
    skill: String,
    /// Each payment goes to this supplier, never to the caller, so the demo
    /// can't be used to drain the vault.
    supplier: AccountId,
    amount: u128,
    attempts: Vector<Attempt>,
}

#[near]
impl Vault {
    #[init]
    pub fn new(proctor: AccountId, skill: String, supplier: AccountId, amount: U128) -> Self {
        Self { proctor, skill, supplier, amount: amount.0, attempts: Vector::new(b"a") }
    }

    /// The AI `model` asks the vault to pay the supplier's bill. The vault
    /// asks Proctor first and pays only if the model holds a licence.
    pub fn agent_pay(&mut self, model: String) -> Promise {
        require!(model.len() <= 100, "model id too long");
        Promise::new(self.proctor.clone())
            .function_call("licence".to_string(), serde_json::to_vec(&json!({ "model": model, "skill": self.skill })).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(20))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_licence(model, env::predecessor_account_id()),
            )
    }

    #[private]
    pub fn on_licence(&mut self, model: String, asked_by: AccountId, #[callback_result] licence: Result<Value, PromiseError>) -> Attempt {
        let (ok, reason) = match licence {
            Ok(v) => (v["licensed"].as_bool().unwrap_or(false), v["reason"].as_str().unwrap_or("no reason given").to_string()),
            Err(_) => (false, "Proctor did not answer".to_string()),
        };
        let paid = ok && env::account_balance().as_yoctonear() > self.amount + NearToken::from_millinear(500).as_yoctonear();
        let reason = if ok && !paid { "vault is out of funds".to_string() } else { reason };
        if paid {
            Promise::new(self.supplier.clone()).transfer(NearToken::from_yoctonear(self.amount));
            env::log_str(&format!("EVENT vault paid {} {}", model, self.amount));
        } else {
            env::log_str(&format!("EVENT vault refused {} {}", model, reason));
        }
        let a = Attempt { model, asked_by, paid, reason, block_height: env::block_height() };
        self.attempts.push(a.clone());
        a
    }

    pub fn attempts(&self, from: u32, limit: u32) -> Vec<Attempt> {
        self.attempts.iter().skip(from as usize).take(limit as usize).cloned().collect()
    }

    pub fn config(&self) -> Value {
        json!({ "proctor": self.proctor, "skill": self.skill, "supplier": self.supplier, "amount": U128(self.amount), "attempts": self.attempts.len() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn vault(balance_near: u128) -> Vault {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(accounts(0))
            .account_balance(NearToken::from_near(balance_near)).build());
        Vault::new(accounts(1), "money".into(), accounts(2), U128(NearToken::from_millinear(10).as_yoctonear()))
    }

    #[test]
    fn pays_only_a_licensed_ai() {
        let mut v = vault(5);
        let a = v.on_licence("m/x".into(), accounts(3), Ok(json!({ "licensed": true, "reason": "passed with 95%" })));
        assert!(a.paid);
        assert!(get_logs().iter().any(|l| l.starts_with("EVENT vault paid m/x")));
    }

    #[test]
    fn refuses_a_caught_ai_and_says_why() {
        let mut v = vault(5);
        let a = v.on_licence("m/x".into(), accounts(3), Ok(json!({ "licensed": false, "reason": "revoked: paid a scam" })));
        assert!(!a.paid);
        assert_eq!(a.reason, "revoked: paid a scam");
    }

    #[test]
    fn refuses_when_proctor_does_not_answer() {
        let mut v = vault(5);
        let a = v.on_licence("m/x".into(), accounts(3), Err(PromiseError::Failed));
        assert!(!a.paid);
        assert_eq!(a.reason, "Proctor did not answer");
    }

    #[test]
    fn keeps_a_reserve_and_never_pays_the_caller() {
        let mut v = vault(0);
        let a = v.on_licence("m/x".into(), accounts(3), Ok(json!({ "licensed": true, "reason": "passed" })));
        assert!(!a.paid);
        assert_eq!(a.reason, "vault is out of funds");
        assert_eq!(v.config()["supplier"], json!(accounts(2)));
    }
}
