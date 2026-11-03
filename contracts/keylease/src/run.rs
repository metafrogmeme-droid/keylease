//! The call path: `use_lease` → OutLayer `request_execution` (proxy in the TEE) → `on_result` (receipt).
use crate::{events, refuse, KeyLease, KeyLeaseExt, Refusal};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, Promise, PromiseError};

/// Largest request body (same limit as the proxy).
pub const MAX_BODY: usize = 64 * 1024;
/// Kept from the caller's deposit to store the call's receipt.
pub const RECEIPT_RESERVE: NearToken = NearToken::from_millinear(5);
/// Smallest deposit `use_lease` takes: the receipt reserve plus OutLayer's compute deposit. The unused
/// compute deposit is refunded by OutLayer straight to the caller.
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(25);
/// Gas for `request_execution` before the rest is shared out (OutLayer reserves 50 teragas of it for
/// its own resume callback).
const OUTLAYER_GAS: Gas = Gas::from_tgas(100);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

/// Where the proxy runs and which build it is.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// May point the contract at a new proxy build (keys stay locked to the hash their owner chose).
    pub admin: AccountId,
    /// OutLayer contract.
    pub outlayer: AccountId,
    /// Published proxy wasm (a `FastFS` URL).
    pub proxy_url: String,
    /// sha256 of the proxy wasm: what owners lock their keys to.
    pub proxy_hash: String,
}

impl Config {
    pub(crate) fn new(admin: AccountId, outlayer: AccountId, proxy_url: String, proxy_hash: String) -> Self {
        validate_proxy(&proxy_url, &proxy_hash);
        Self {
            admin,
            outlayer,
            proxy_url,
            proxy_hash,
        }
    }
}

fn validate_proxy(url: &str, hash: &str) {
    require!(
        url.starts_with("https://") && url.len() <= 300,
        "proxy_url must be an https URL"
    );
    require!(
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "proxy_hash must be 64 lowercase hex chars"
    );
}

/// How a call ended.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The API answered (any HTTP status).
    Ok,
    /// The proxy refused under a lease rule.
    Refused,
    /// The answer carried the key and was withheld.
    Tripwire,
    /// The proxy could not complete the call (bad input, key unavailable, upstream error, too large).
    Error,
    /// OutLayer returned no answer (run failed or timed out).
    Failed,
}

/// On-chain record of one call: hashes and outcome, never the body or the key.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub lease_id: U64,
    pub call: u32,
    pub caller: AccountId,
    pub endpoint: String,
    pub method: String,
    /// sha256 (hex) of the exact input sent to the proxy.
    pub input_sha256: String,
    /// sha256 (hex) of the JSON this contract returned, when there was an answer.
    pub output_sha256: Option<String>,
    pub outcome: Outcome,
    /// Refusal or error code from the proxy.
    pub code: Option<String>,
    /// Upstream HTTP status when the API answered.
    pub http_status: Option<u16>,
    pub at: U64,
}

/// Read the proxy's answer: outcome, code and HTTP status. Pure, unit-tested.
#[must_use]
pub fn classify(answer: Option<&Value>) -> (Outcome, Option<String>, Option<u16>) {
    let Some(v) = answer.filter(|v| !v.is_null()) else {
        return (Outcome::Failed, None, None);
    };
    if v["ok"] == true {
        let status = v["status"].as_u64().and_then(|s| u16::try_from(s).ok());
        return (Outcome::Ok, None, status);
    }
    let code = v["error"].as_str().map(str::to_owned);
    let outcome = match code.as_deref() {
        Some("tripwire") => Outcome::Tripwire,
        Some(c) if Refusal::from_code(c).is_some() => Outcome::Refused,
        _ => Outcome::Error,
    };
    (outcome, code, None)
}

fn sha256_hex(data: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in env::sha256_array(data) {
        out.push(char::from(DIGITS[usize::from(b >> 4)]));
        out.push(char::from(DIGITS[usize::from(b & 0xf)]));
    }
    out
}

/// What `use_lease` hands to `on_result` about the call it started.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallInfo {
    pub lease_id: U64,
    pub call: u32,
    pub caller: AccountId,
    pub endpoint: String,
    pub method: String,
    pub input_sha256: String,
}

#[near]
impl KeyLease {
    /// Make one leased call: `method` (`GET` or `POST`, default `POST`) on `endpoint` with `body`.
    /// Attach at least [`MIN_DEPOSIT`]; OutLayer refunds unused compute to the caller.
    /// Refuses with `<code>: <hint>` (docs/WORDING.md). The call is used before the run starts and is not
    /// given back if the run fails (T4). Returns the proxy's answer through `on_result`.
    #[payable]
    pub fn use_lease(
        &mut self,
        lease_id: U64,
        endpoint: String,
        method: Option<String>,
        body: Option<String>,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        if let Err(r) = self.check_internal(lease_id.0, &caller, &endpoint) {
            refuse(r);
        }
        let method = method.unwrap_or_else(|| "POST".to_owned());
        require!(
            method == "GET" || method == "POST",
            "bad_input: method must be GET or POST."
        );
        let body = body.unwrap_or_default();
        require!(
            body.len() <= MAX_BODY,
            "body_too_large: The request body is over 64 KB; send a smaller request."
        );
        require!(
            method == "POST" || body.is_empty(),
            "bad_input: A GET request cannot carry a body."
        );
        let attached = env::attached_deposit();
        require!(
            attached >= MIN_DEPOSIT,
            format!("attach at least {MIN_DEPOSIT} for OutLayer and the receipt; unused compute is refunded")
        );

        let lease = self
            .leases
            .get_mut(&lease_id.0)
            .unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        lease.calls_used += 1;
        let call = lease.calls_used;
        let allowed = lease.endpoints.clone();
        let key = self
            .keys
            .get(&lease.key_id)
            .unwrap_or_else(|| refuse(Refusal::LeaseRevoked));

        let input = json!({
            "v": 1, "lease_id": lease_id.0.to_string(), "provider": key.provider, "base_url": key.base_url,
            "allowed": allowed, "endpoint": endpoint, "method": method, "body": body,
        })
        .to_string();
        let input_sha256 = sha256_hex(input.as_bytes());
        let args = json!({
            "source": { "WasmUrl": {
                "url": self.config.proxy_url, "hash": self.config.proxy_hash, "build_target": "wasm32-wasip2",
            } },
            "resource_limits": { "max_instructions": 1_000_000_000_u64, "max_memory_mb": 128, "max_execution_seconds": 30 },
            "input_data": input,
            "secrets_ref": { "profile": key.secret_profile, "account_id": key.owner },
            "response_format": "Json",
            "payer_account_id": caller,
        });
        events::call_authorized(lease_id.0, &caller, &endpoint, call);
        Promise::new(self.config.outlayer.clone())
            .function_call_weight(
                "request_execution".to_owned(),
                args.to_string().into_bytes(),
                attached.saturating_sub(RECEIPT_RESERVE),
                OUTLAYER_GAS,
                GasWeight(1),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_result(CallInfo {
                        lease_id,
                        call,
                        caller,
                        endpoint,
                        method,
                        input_sha256,
                    }),
            )
    }

    /// OutLayer's answer comes back here: store the receipt, emit an event, pass the answer on.
    #[private]
    pub fn on_result(
        &mut self,
        info: CallInfo,
        #[callback_result] result: Result<Option<Value>, PromiseError>,
    ) -> Value {
        let CallInfo {
            lease_id,
            call,
            caller,
            endpoint,
            method,
            input_sha256,
        } = info;
        let answer = result.ok().flatten().filter(|v| !v.is_null());
        let (outcome, code, http_status) = classify(answer.as_ref());
        let output_sha256 = answer.as_ref().map(|v| sha256_hex(v.to_string().as_bytes()));
        let receipt = Receipt {
            lease_id,
            call,
            caller,
            endpoint,
            method,
            input_sha256,
            output_sha256,
            outcome,
            code,
            http_status,
            at: U64(env::block_timestamp()),
        };
        events::call_completed(&receipt);
        self.receipts.insert((lease_id.0, call), receipt);
        answer.unwrap_or(Value::Null)
    }

    /// Point the contract at a new proxy build. Admin only. Keys locked to the old hash stop opening
    /// until their owner re-points the lock (T2).
    pub fn set_proxy(&mut self, proxy_url: String, proxy_hash: String) {
        require!(
            env::predecessor_account_id() == self.config.admin,
            "only the admin can change the proxy"
        );
        validate_proxy(&proxy_url, &proxy_hash);
        self.config.proxy_url = proxy_url;
        self.config.proxy_hash = proxy_hash;
        events::proxy_changed(&self.config);
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_receipt(&self, lease_id: U64, call: u32) -> Option<Receipt> {
        self.receipts.get(&(lease_id.0, call)).cloned()
    }

    /// Receipts of one lease, oldest first, from call `from_call` (1-based).
    pub fn list_receipts(&self, lease_id: U64, from_call: Option<u32>, limit: Option<u32>) -> Vec<Receipt> {
        let used = self.leases.get(&lease_id.0).map_or(0, |l| l.calls_used);
        let from = from_call.unwrap_or(1).max(1);
        let take = limit
            .unwrap_or(crate::views::MAX_PAGE)
            .min(crate::views::MAX_PAGE);
        (from..=used)
            .take(take as usize)
            .filter_map(|c| self.receipts.get(&(lease_id.0, c)).cloned())
            .collect()
    }
}
