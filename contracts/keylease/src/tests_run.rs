//! Unit tests for the call path: what `use_lease` sends to OutLayer and what `on_result` records.
use crate::tests::{acct, call, ctx, fresh, setup, Setup, PROXY_HASH, SEC, T0};
use crate::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{json, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken, PromiseResult, RuntimeFeesConfig};

/// The `request_execution` call `use_lease` created: (receiver, args, deposit).
fn sent() -> (String, Value, NearToken) {
    let receipts = get_created_receipts();
    let r = receipts.first().unwrap_or_else(|| panic!("no receipt created"));
    match r.actions.first() {
        Some(MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            ..
        }) => {
            assert_eq!(method_name, b"request_execution");
            (
                r.receiver_id.to_string(),
                near_sdk::serde_json::from_slice(args).unwrap_or_default(),
                *attached_deposit,
            )
        }
        other => panic!("unexpected action {other:?}"),
    }
}

#[test]
fn use_lease_asks_outlayer_for_the_pinned_proxy_with_the_owners_row() {
    let mut s = setup();
    ctx("bob.testnet", T0 + SEC, 40);
    let _ =
        s.c.use_lease(s.lease, "/v1/chat".into(), None, Some("{\"q\":1}".into()));
    let (to, args, deposit) = sent();
    assert_eq!(to, "outlayer.testnet");
    assert_eq!(args["source"]["WasmUrl"]["hash"], PROXY_HASH);
    assert_eq!(args["source"]["WasmUrl"]["build_target"], "wasm32-wasip2");
    assert_eq!(
        args["secrets_ref"],
        json!({ "profile": "main", "account_id": "alice.testnet" })
    );
    assert_eq!(
        args["payer_account_id"], "bob.testnet",
        "OutLayer refunds unused compute to the caller"
    );
    assert_eq!(args["response_format"], "Json");
    assert!(
        args["resource_limits"]["max_instructions"].is_u64(),
        "limits present, so the run executes"
    );
    assert_eq!(
        deposit,
        NearToken::from_millinear(40).saturating_sub(RECEIPT_RESERVE)
    );
    let input: Value =
        near_sdk::serde_json::from_str(args["input_data"].as_str().unwrap_or_default()).unwrap_or_default();
    assert_eq!(
        input,
        json!({ "v": 1, "lease_id": "0", "provider": "NearAiCloud", "base_url": "https://cloud-api.near.ai",
                "allowed": ["/v1/chat"], "endpoint": "/v1/chat", "method": "POST", "body": "{\"q\":1}" })
    );
}

#[test]
fn refused_call_sends_nothing_and_uses_nothing() {
    let mut s = setup();
    ctx("mallory.testnet", T0 + SEC, 40);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = s.c.use_lease(s.lease, "/v1/chat".into(), None, None);
    }));
    assert!(r.is_err());
    assert_eq!(get_created_receipts().len(), 0);
    assert_eq!(s.c.get_lease(s.lease).map(|l| l.calls_used), Some(0));
}

#[test]
#[should_panic(expected = "attach at least")]
fn deposit_must_cover_outlayer_and_receipt() {
    let mut s = setup();
    ctx("bob.testnet", T0 + SEC, 24);
    let _ = s.c.use_lease(s.lease, "/v1/chat".into(), None, None);
}

#[test]
#[should_panic(expected = "body_too_large")]
fn body_limit_is_checked_before_spending() {
    let mut s = setup();
    ctx("bob.testnet", T0 + SEC, 40);
    let _ =
        s.c.use_lease(s.lease, "/v1/chat".into(), None, Some("x".repeat(64 * 1024 + 1)));
}

#[test]
#[should_panic(expected = "bad_input: A GET request cannot carry a body.")]
fn get_carries_no_body() {
    let mut s = setup();
    ctx("bob.testnet", T0 + SEC, 40);
    let _ =
        s.c.use_lease(s.lease, "/v1/chat".into(), Some("GET".into()), Some("{}".into()));
}

#[test]
#[should_panic(expected = "bad_input: method must be GET or POST.")]
fn only_get_and_post() {
    let mut s = setup();
    ctx("bob.testnet", T0 + SEC, 40);
    let _ =
        s.c.use_lease(s.lease, "/v1/chat".into(), Some("DELETE".into()), None);
}

/// Deliver OutLayer's answer to `on_result` the way the runtime does (predecessor = this contract).
fn deliver(c: &mut KeyLease, lease: U64, call_no: u32, answer: Option<&Value>) -> Value {
    let result = answer.map_or(PromiseResult::Failed, |v| {
        PromiseResult::Successful(v.to_string().into_bytes())
    });
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct("kl.testnet"))
            .predecessor_account_id(acct("kl.testnet"))
            .block_timestamp(T0 + 2 * SEC)
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![result],
    );
    let info = CallInfo {
        lease_id: lease,
        call: call_no,
        caller: acct("bob.testnet"),
        endpoint: "/v1/chat".into(),
        method: "POST".into(),
        input_sha256: "ab".repeat(32),
    };
    c.on_result(info, Ok(answer.cloned()))
}

#[test]
fn ok_answer_is_passed_on_and_receipted() {
    let Setup { mut c, lease, .. } = setup();
    call(&mut c, lease);
    let answer = json!({ "v": 1, "ok": true, "status": 200, "body": "hi", "body_encoding": "utf8",
                         "body_sha256": "00", "redacted": false });
    assert_eq!(deliver(&mut c, lease, 1, Some(&answer)), answer);
    let r = c.get_receipt(lease, 1).unwrap_or_else(|| panic!("no receipt"));
    assert_eq!(
        (r.outcome, r.http_status, r.code.clone()),
        (Outcome::Ok, Some(200), None)
    );
    assert!(r.output_sha256.is_some());
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"call_completed\"")));
    assert!(
        !get_logs().iter().any(|l| l.contains("\"hi\"")),
        "the body never goes into a log"
    );
}

#[test]
fn tripwire_answer_is_receipted_and_announced() {
    let Setup { mut c, lease, .. } = setup();
    call(&mut c, lease);
    let answer = json!({ "v": 1, "ok": false, "error": "tripwire", "hint": Refusal::Tripwire.hint() });
    deliver(&mut c, lease, 1, Some(&answer));
    assert_eq!(
        c.get_receipt(lease, 1).map(|r| r.outcome),
        Some(Outcome::Tripwire)
    );
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"tripwire\"")));
}

#[test]
fn failed_run_keeps_the_call_used() {
    let Setup { mut c, lease, .. } = setup();
    call(&mut c, lease);
    assert_eq!(deliver(&mut c, lease, 1, None), Value::Null);
    assert_eq!(c.get_receipt(lease, 1).map(|r| r.outcome), Some(Outcome::Failed));
    assert_eq!(
        c.get_lease(lease).map(|l| (l.calls_used, l.calls_left)),
        Some((1, 1))
    );
}

#[test]
fn classify_reads_every_kind_of_answer() {
    assert_eq!(classify(None), (Outcome::Failed, None, None));
    assert_eq!(classify(Some(&Value::Null)), (Outcome::Failed, None, None));
    assert_eq!(
        classify(Some(&json!({"ok": true, "status": 429}))),
        (Outcome::Ok, None, Some(429))
    );
    let code = |c: &str| classify(Some(&json!({"ok": false, "error": c})));
    assert_eq!(code("tripwire").0, Outcome::Tripwire);
    assert_eq!(code("endpoint_not_in_lease").0, Outcome::Refused);
    assert_eq!(
        code("upstream_error"),
        (Outcome::Error, Some("upstream_error".into()), None)
    );
    assert_eq!(code("key_unavailable").0, Outcome::Error);
}

#[test]
fn receipts_list_in_call_order() {
    let Setup { mut c, lease, .. } = setup();
    call(&mut c, lease);
    deliver(&mut c, lease, 1, Some(&json!({"ok": true, "status": 200})));
    call(&mut c, lease);
    deliver(&mut c, lease, 2, None);
    let list = c.list_receipts(lease, None, None);
    assert_eq!(list.iter().map(|r| r.call).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(c.list_receipts(lease, Some(2), Some(5)).len(), 1);
}

#[test]
fn admin_can_repoint_the_proxy() {
    ctx("admin.testnet", T0, 1000);
    let mut c = fresh();
    let next = "cd".repeat(32);
    c.set_proxy(
        format!("https://test.fastfs.io/x/outlayer.testnet/{next}.wasm"),
        next.clone(),
    );
    assert_eq!(c.get_config().proxy_hash, next);
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"proxy_changed\"")));
}

#[test]
#[should_panic(expected = "only the admin can change the proxy")]
fn others_cannot_repoint_the_proxy() {
    ctx("admin.testnet", T0, 1000);
    let mut c = fresh();
    ctx("mallory.testnet", T0, 0);
    c.set_proxy("https://evil.example/p.wasm".into(), "ab".repeat(32));
}

#[test]
#[should_panic(expected = "proxy_hash must be 64 lowercase hex chars")]
fn proxy_hash_is_validated() {
    ctx("admin.testnet", T0, 1000);
    let _ = KeyLease::new(
        acct("admin.testnet"),
        acct("outlayer.testnet"),
        "https://x.example/p.wasm".into(),
        "AB".repeat(32),
    );
}
