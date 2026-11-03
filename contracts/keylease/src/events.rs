//! NEP-297 events (`EVENT_JSON:` logs) for indexers and the web app. Never carry a secret.
use crate::{KeyRecord, Lease};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

const STANDARD: &str = "keylease";
const VERSION: &str = "0.1.0";

fn emit(event: &str, data: Value) {
    let body = json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}

pub fn key_added(id: u64, k: &KeyRecord) {
    emit(
        "key_added",
        json!({ "key_id": id.to_string(), "owner": k.owner, "provider": k.provider, "base_url": k.base_url }),
    );
}

pub fn key_removed(id: u64, owner: &AccountId) {
    emit("key_removed", json!({ "key_id": id.to_string(), "owner": owner }));
}

pub fn lease_created(id: u64, l: &Lease) {
    emit(
        "lease_created",
        json!({
            "lease_id": id.to_string(), "key_id": l.key_id.to_string(), "owner": l.owner, "grantee": l.grantee,
            "calls": l.calls_total, "expires_at": l.expires_at.to_string(), "endpoints": l.endpoints,
        }),
    );
}

pub fn lease_revoked(id: u64, by: &AccountId) {
    emit("lease_revoked", json!({ "lease_id": id.to_string(), "by": by }));
}

pub fn revoked_all(key_id: Option<u64>, by: &AccountId) {
    emit(
        "leases_revoked_all",
        json!({ "key_id": key_id.map(|k| k.to_string()), "by": by }),
    );
}

pub fn call_authorized(lease_id: u64, caller: &AccountId, endpoint: &str, n: u32) {
    emit(
        "call_authorized",
        json!({ "lease_id": lease_id.to_string(), "caller": caller, "endpoint": endpoint, "call": n }),
    );
}

pub fn call_completed(r: &crate::Receipt) {
    let name = if r.outcome == crate::Outcome::Tripwire {
        "tripwire"
    } else {
        "call_completed"
    };
    emit(
        name,
        json!({
            "lease_id": r.lease_id, "call": r.call, "caller": r.caller, "endpoint": r.endpoint,
            "outcome": r.outcome, "code": r.code, "http_status": r.http_status,
            "input_sha256": r.input_sha256, "output_sha256": r.output_sha256,
        }),
    );
}

pub fn proxy_changed(c: &crate::Config) {
    emit(
        "proxy_changed",
        json!({ "proxy_url": c.proxy_url, "proxy_hash": c.proxy_hash }),
    );
}
