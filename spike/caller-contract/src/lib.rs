//! Spike contract: asks `outlayer` to run a published wasm with a secret owned by another account.
//!
//! Deployed twice for the spike: once on the account the secret's condition names (expect the secret to
//! open) and once on a decoy account (expect a refusal). Anyone may call `run`, the way any agent will
//! sign `use_lease` later: the condition must not depend on who signs.
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, Gas, GasWeight, PanicOnDefault, Promise, PromiseError};

/// Gas for `request_execution` before the remaining gas is shared out (it reserves 50 TGas for its
/// own yield callback).
const EXECUTION_GAS: Gas = Gas::from_tgas(120);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Spike {
    outlayer: AccountId,
    last_result: Option<String>,
    runs: u64,
}

/// The `request_execution` arguments for one run (pure, unit-tested).
#[must_use]
pub fn execution_args(
    wasm_url: &str,
    wasm_hash: &str,
    secret_owner: &AccountId,
    profile: &str,
    input: Option<&str>,
) -> Value {
    json!({
        "source": { "WasmUrl": { "url": wasm_url, "hash": wasm_hash, "build_target": "wasm32-wasip2" } },
        "resource_limits": { "max_instructions": 1_000_000_000_u64, "max_memory_mb": 128, "max_execution_seconds": 30 },
        "input_data": input.unwrap_or("{\"spike\":true}"),
        "secrets_ref": { "profile": profile, "account_id": secret_owner },
        "response_format": "Json"
    })
}

#[near]
impl Spike {
    #[init]
    #[must_use]
    pub fn new(outlayer: AccountId) -> Self {
        Self {
            outlayer,
            last_result: None,
            runs: 0,
        }
    }

    /// Request one OutLayer run. The attached deposit pays OutLayer; unused compute is refunded to this
    /// contract (the payer).
    #[payable]
    pub fn run(
        &mut self,
        wasm_url: String,
        wasm_hash: String,
        secret_owner: AccountId,
        profile: String,
        input: Option<String>,
    ) -> Promise {
        let args = execution_args(&wasm_url, &wasm_hash, &secret_owner, &profile, input.as_deref());
        env::log_str(&format!(
            "spike run requested by signer {}",
            env::signer_account_id()
        ));
        Promise::new(self.outlayer.clone())
            .function_call_weight(
                "request_execution".to_owned(),
                args.to_string().into_bytes(),
                env::attached_deposit(),
                EXECUTION_GAS,
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_result(),
            )
    }

    /// Receives OutLayer's answer: the guest's JSON on success, `null` when the run was refused or failed.
    #[private]
    pub fn on_result(&mut self, #[callback_result] result: Result<Value, PromiseError>) -> Value {
        self.runs += 1;
        let value = result.unwrap_or(Value::Null);
        let text = value.to_string();
        env::log_str(&format!("spike result: {text}"));
        self.last_result = Some(text);
        value
    }

    pub fn last_result(&self) -> Option<String> {
        self.last_result.clone()
    }

    pub fn runs(&self) -> u64 {
        self.runs
    }

    pub fn outlayer(&self) -> AccountId {
        self.outlayer.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_name_the_owner_row_and_pinned_build() {
        let owner: AccountId = "alice.testnet".parse().unwrap_or_else(|_| unreachable!());
        let hash = "ab".repeat(32);
        let a = execution_args(
            "https://test.fastfs.io/x/outlayer.testnet/h.wasm",
            &hash,
            &owner,
            "spike",
            None,
        );
        assert_eq!(a["source"]["WasmUrl"]["hash"], hash.as_str());
        assert_eq!(a["source"]["WasmUrl"]["build_target"], "wasm32-wasip2");
        assert_eq!(a["secrets_ref"]["account_id"], "alice.testnet");
        assert_eq!(a["secrets_ref"]["profile"], "spike");
        assert_eq!(a["response_format"], "Json");
        assert!(
            a["resource_limits"]["max_instructions"].is_u64(),
            "limits present, so the run executes"
        );
        assert_eq!(a["input_data"], "{\"spike\":true}");
        let padded = execution_args("u", &hash, &owner, "spike", Some("{\"pad\":8000}"));
        assert_eq!(padded["input_data"], "{\"pad\":8000}");
    }
}
