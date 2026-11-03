//! Test double for `outlayer.testnet`, for sandbox tests only. It answers `request_execution` the way
//! OutLayer running the KeyLease proxy would, chosen by the input's endpoint, and records every request
//! (arguments, caller, deposit) so tests can check what the KeyLease contract sent.
#![allow(missing_docs, clippy::needless_pass_by_value, clippy::too_many_arguments)]
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutlayer {
    requests: Vec<String>,
}

#[near]
impl MockOutlayer {
    /// `/fail` → no answer (`null`); `/tripwire` → the proxy's tripwire answer; anything else → 200 with an echo.
    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) -> Option<Value> {
        let input: Value = input_data
            .as_deref()
            .and_then(|s| near_sdk::serde_json::from_str(s).ok())
            .unwrap_or_default();
        self.requests.push(
            json!({
                "predecessor": env::predecessor_account_id(), "signer": env::signer_account_id(),
                "deposit": env::attached_deposit().as_yoctonear().to_string(), "source": source,
                "resource_limits": resource_limits, "input": input, "secrets_ref": secrets_ref,
                "response_format": response_format, "payer_account_id": payer_account_id, "params": params,
            })
            .to_string(),
        );
        match input["endpoint"].as_str() {
            Some("/fail") => None,
            Some("/tripwire") => {
                Some(json!({ "v": 1, "ok": false, "error": "tripwire", "hint": "withheld" }))
            }
            _ => Some(json!({
                "v": 1, "ok": true, "status": 200, "body": format!("echo {}", input["body"].as_str().unwrap_or_default()),
                "body_encoding": "utf8", "body_sha256": "00", "redacted": false,
            })),
        }
    }

    #[must_use]
    pub fn requests(&self) -> Vec<String> {
        self.requests.clone()
    }
}
