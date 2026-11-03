//! Test double for `outlayer.testnet`, for sandbox tests only.
//!
//! `request_execution` takes exactly OutLayer's argument types and refuses what OutLayer refuses, so a
//! shape mismatch between the KeyLease contract and the real OutLayer fails our sandbox tests instead of
//! a testnet run. Spec: the OutLayer contract at commit
//! [`aaf60a2`](https://github.com/out-layer/outlayer/tree/aaf60a26855e30bc3318126382903df92dea7d3d/contract/src):
//! - signature: `contract/src/execution.rs` lines 35-45
//! - types: `contract/src/lib.rs` lines 137-157 (`ExecutionSource`), 179-223 (`RequestParams`),
//!   228-241 (`ResponseFormat`), 246-260 (`ResourceLimits`), 361-364 (`SecretsReference`)
//! - checks: `execution.rs` 48-130 and 240-262, `projects.rs` 780-800 (`code_source_error`),
//!   `secrets.rs` 2522 (`profile_shape_error`); caps and pricing `lib.rs` 74-93, 666-672, 818-832
//!
//! Differences, on purpose: unknown JSON fields are refused here (OutLayer ignores them, which would hide
//! a typo); the answer comes back at once instead of by yield/resume, chosen by the input's endpoint:
//! `/fail` → `null` (a failed run), `/tripwire` → the proxy's tripwire answer, else an ok echo.
#![allow(missing_docs, clippy::needless_pass_by_value, clippy::too_many_arguments)]
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId};

/// `ExecutionSource` (lib.rs 137-157).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug)]
pub enum ExecutionSource {
    GitHub {
        repo: String,
        commit: String,
        build_target: Option<String>,
    },
    WasmUrl {
        url: String,
        hash: String,
        build_target: Option<String>,
    },
    Project {
        project_id: String,
        version_key: Option<String>,
    },
}

/// `ResourceLimits` (lib.rs 246-260).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug, Default)]
pub struct ResourceLimits {
    pub max_instructions: Option<u64>,
    pub max_memory_mb: Option<u32>,
    pub max_execution_seconds: Option<u64>,
}

/// `SecretsReference` (lib.rs 361-364).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug)]
pub struct SecretsReference {
    pub profile: String,
    pub account_id: AccountId,
}

/// `ResponseFormat` (lib.rs 228-241); default `Text`.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ResponseFormat {
    Bytes,
    #[default]
    Text,
    Json,
}

/// `RequestParams` (lib.rs 179-223). Its flags mirror OutLayer's struct one to one.
#[allow(clippy::struct_excessive_bools)]
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug, Default)]
pub struct RequestParams {
    #[serde(default)]
    pub force_rebuild: bool,
    #[serde(default)]
    pub store_on_fastfs: bool,
    #[serde(default)]
    pub compile_only: bool,
    #[serde(default)]
    pub project_uuid: Option<String>,
    #[serde(default)]
    pub attached_usd: Option<U128>,
    #[serde(default)]
    pub use_bound_identity: bool,
}

const MAX_INSTRUCTIONS: u64 = 500_000_000_000;
const MAX_EXECUTION_SECONDS: u64 = 180;
const MAX_MEMORY_MB: u32 = 4096;
const INPUT_DATA_FREE_BYTES: usize = 32 * 1024;
const MAX_WASM_URL_LEN: usize = 2048;
// Pricing as OutLayer initialises it (lib.rs 666-672); testnet's owner may have changed it since.
const BASE_FEE: u128 = 1_000_000_000_000_000_000_000;
const PER_MILLION_INSTRUCTIONS_FEE: u128 = 100_000_000_000_000;
const PER_MS_FEE: u128 = 100_000_000_000_000_000;

/// What OutLayer's `estimate_cost` + `input_storage_deposit` require attached.
#[must_use]
pub fn required_deposit(limits: &ResourceLimits, input_len: usize) -> u128 {
    let instructions = limits.max_instructions.unwrap_or(1_000_000_000);
    let seconds = limits.max_execution_seconds.unwrap_or(60);
    let compute = BASE_FEE
        + u128::from(instructions / 1_000_000) * PER_MILLION_INSTRUCTIONS_FEE
        + u128::from(seconds * 1000) * PER_MS_FEE;
    let storage =
        input_len.saturating_sub(INPUT_DATA_FREE_BYTES) as u128 * env::storage_byte_cost().as_yoctonear();
    compute + storage
}

fn check_profile(profile: &str) {
    let ok = (1..=64).contains(&profile.len())
        && profile
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    require!(ok, "secrets_ref.profile must be 1-64 letters, digits, '-' or '_'");
}

fn check_wasm_url(url: &str, hash: &str) {
    require!(
        hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "source.hash must be the SHA-256 of the WASM as 64 lowercase hex characters"
    );
    require!(
        url.starts_with("https://") && url.len() > "https://".len(),
        "source.url must be an https:// URL"
    );
    require!(
        url.len() <= MAX_WASM_URL_LEN,
        "source.url is longer than 2048 bytes"
    );
    require!(
        !url.chars().any(|c| c.is_whitespace() || c.is_control()),
        "source.url must not contain whitespace or control characters"
    );
}

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutlayer {
    requests: Vec<String>,
}

#[near]
impl MockOutlayer {
    /// OutLayer's `request_execution`, same arguments, same refusals; answers at once (see module docs).
    #[payable]
    pub fn request_execution(
        &mut self,
        source: ExecutionSource,
        resource_limits: Option<ResourceLimits>,
        input_data: Option<String>,
        secrets_ref: Option<SecretsReference>,
        response_format: Option<ResponseFormat>,
        payer_account_id: Option<AccountId>,
        params: Option<RequestParams>,
    ) -> Option<Value> {
        if let Some(r) = &secrets_ref {
            check_profile(&r.profile);
        }
        let params = params.unwrap_or_default();
        match &source {
            ExecutionSource::WasmUrl { url, hash, .. } => {
                check_wasm_url(url, hash);
                require!(
                    !params.force_rebuild,
                    "force_rebuild is not applicable for WasmUrl code source"
                );
            }
            ExecutionSource::GitHub { .. } | ExecutionSource::Project { .. } => {
                env::panic_str("mock-outlayer models WasmUrl sources only (all KeyLease uses)")
            }
        }
        require!(
            !params.store_on_fastfs || params.force_rebuild,
            "store_on_fastfs requires force_rebuild to ensure fresh compilation and upload"
        );
        let compile_only = params.compile_only || resource_limits.is_none();
        require!(
            !compile_only,
            "mock-outlayer does not model compile_only (no resource_limits): nothing would run"
        );
        let limits = resource_limits.clone().unwrap_or_default();
        require!(
            limits.max_instructions.unwrap_or_default() <= MAX_INSTRUCTIONS,
            "max_instructions over the hard limit"
        );
        require!(
            limits.max_execution_seconds.unwrap_or_default() <= MAX_EXECUTION_SECONDS,
            "max_execution_seconds over the hard limit"
        );
        require!(
            limits.max_memory_mb.unwrap_or_default() <= MAX_MEMORY_MB,
            "max_memory_mb over the hard limit"
        );
        let input_len = input_data.as_ref().map_or(0, String::len);
        let required = required_deposit(&limits, input_len);
        let paid = env::attached_deposit().as_yoctonear();
        require!(
            paid >= required,
            format!("Insufficient payment: required {required} yoctoNEAR, got {paid}")
        );

        let input: Value = input_data
            .as_deref()
            .and_then(|s| near_sdk::serde_json::from_str(s).ok())
            .unwrap_or_default();
        self.requests.push(
            json!({
                "predecessor": env::predecessor_account_id(), "signer": env::signer_account_id(),
                "deposit": paid.to_string(), "required": required.to_string(), "source": source_json(&source),
                "resource_limits": { "max_instructions": limits.max_instructions,
                                     "max_memory_mb": limits.max_memory_mb,
                                     "max_execution_seconds": limits.max_execution_seconds },
                "input": input, "secrets_ref": secrets_ref.map(|r| json!({ "profile": r.profile, "account_id": r.account_id })),
                "response_format": response_format.unwrap_or_default(), "payer_account_id": payer_account_id,
            })
            .to_string(),
        );
        let answer = match input["endpoint"].as_str() {
            Some("/fail") => return None,
            Some("/tripwire") => json!({ "v": 1, "ok": false, "error": "tripwire", "hint": "withheld" }),
            _ => json!({
                "v": 1, "ok": true, "status": 200,
                "body": format!("echo {}", input["body"].as_str().unwrap_or_default()),
                "body_encoding": "utf8", "body_sha256": "00", "redacted": false,
            }),
        };
        // Json returns the guest's JSON as is; Text and Bytes return a JSON string (execution.rs 441-452).
        Some(match response_format.unwrap_or_default() {
            ResponseFormat::Json => answer,
            ResponseFormat::Text | ResponseFormat::Bytes => Value::String(answer.to_string()),
        })
    }

    #[must_use]
    pub fn requests(&self) -> Vec<String> {
        self.requests.clone()
    }
}

fn source_json(source: &ExecutionSource) -> Value {
    match source {
        ExecutionSource::WasmUrl {
            url,
            hash,
            build_target,
        } => {
            json!({ "WasmUrl": { "url": url, "hash": hash, "build_target": build_target } })
        }
        ExecutionSource::GitHub { repo, commit, .. } => {
            json!({ "GitHub": { "repo": repo, "commit": commit } })
        }
        ExecutionSource::Project { project_id, .. } => json!({ "Project": { "project_id": project_id } }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn call(source: Value, limits: Option<Value>, profile: &str, deposit_millinear: u128) {
        testing_env!(VMContextBuilder::new()
            .attached_deposit(NearToken::from_millinear(deposit_millinear))
            .build());
        let args = json!({
            "source": source, "resource_limits": limits, "input_data": "{\"endpoint\":\"/a\",\"body\":\"x\"}",
            "secrets_ref": { "profile": profile, "account_id": "alice.testnet" }, "response_format": "Json",
        });
        let a: Value = args;
        let source: ExecutionSource =
            near_sdk::serde_json::from_value(a["source"].clone()).unwrap_or_else(|e| panic!("{e}"));
        let limits: Option<ResourceLimits> =
            near_sdk::serde_json::from_value(a["resource_limits"].clone()).unwrap_or_else(|e| panic!("{e}"));
        let secrets: Option<SecretsReference> =
            near_sdk::serde_json::from_value(a["secrets_ref"].clone()).unwrap_or_else(|e| panic!("{e}"));
        let mut m = MockOutlayer::default();
        let _ = m.request_execution(
            source,
            limits,
            a["input_data"].as_str().map(str::to_owned),
            secrets,
            Some(ResponseFormat::Json),
            None,
            None,
        );
    }

    fn wasm(hash: &str) -> Value {
        json!({ "WasmUrl": { "url": "https://h.example/p.wasm", "hash": hash, "build_target": "wasm32-wasip2" } })
    }

    fn limits() -> Value {
        json!({ "max_instructions": 1_000_000_000_u64, "max_memory_mb": 128, "max_execution_seconds": 30 })
    }

    #[test]
    fn our_request_shape_is_accepted_and_costs_what_outlayer_charges() {
        call(wasm(&"ab".repeat(32)), Some(limits()), "main", 20);
        let l = ResourceLimits {
            max_instructions: Some(1_000_000_000),
            max_memory_mb: Some(128),
            max_execution_seconds: Some(30),
        };
        assert_eq!(
            required_deposit(&l, 10),
            4_000_100_000_000_000_000_000,
            "0.0040001 NEAR"
        );
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn uppercase_hash_is_refused() {
        call(wasm(&"AB".repeat(32)), Some(limits()), "main", 20);
    }

    #[test]
    #[should_panic(expected = "secrets_ref.profile")]
    fn bad_profile_is_refused() {
        call(wasm(&"ab".repeat(32)), Some(limits()), "has space", 20);
    }

    #[test]
    #[should_panic(expected = "Insufficient payment")]
    fn too_small_deposit_is_refused() {
        call(wasm(&"ab".repeat(32)), Some(limits()), "main", 4);
    }

    #[test]
    #[should_panic(expected = "compile_only")]
    fn missing_limits_would_only_compile() {
        call(wasm(&"ab".repeat(32)), None, "main", 20);
    }

    #[test]
    fn unknown_fields_are_refused() {
        let bad = json!({ "WasmUrl": { "url": "https://h.example/p.wasm", "hash": "ab", "build_target": null, "extra": 1 } });
        assert!(near_sdk::serde_json::from_value::<ExecutionSource>(bad).is_err());
        let typo = json!({ "max_instrucions": 1 });
        assert!(near_sdk::serde_json::from_value::<ResourceLimits>(typo).is_err());
    }
}
