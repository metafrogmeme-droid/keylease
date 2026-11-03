//! Unit tests: one test per rule and per refusal.
use crate::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken};

pub(crate) const SEC: u64 = 1_000_000_000;
pub(crate) const T0: u64 = 1_700_000_000 * SEC;

pub(crate) fn acct(s: &str) -> AccountId {
    s.parse().unwrap_or_else(|_| unreachable!())
}

pub(crate) fn ctx(caller: &str, now: u64, deposit_millinear: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct(caller))
        .block_timestamp(now)
        .attached_deposit(NearToken::from_millinear(deposit_millinear))
        .build());
}

pub(crate) const PROXY_HASH: &str = "95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970";

pub(crate) fn fresh() -> KeyLease {
    KeyLease::new(
        acct("admin.testnet"),
        acct("outlayer.testnet"),
        format!("https://test.fastfs.io/kl.testnet/outlayer.testnet/{PROXY_HASH}.wasm"),
        PROXY_HASH.into(),
    )
}

/// One leased call as `bob.testnet` with the minimum deposit; returns calls used afterwards.
pub(crate) fn call(c: &mut KeyLease, lease: U64) -> u32 {
    ctx("bob.testnet", T0 + SEC, 25);
    let _ = c.use_lease(lease, "/v1/chat".into(), None, Some("{}".into()));
    c.get_lease(lease).map_or(0, |l| l.calls_used)
}

pub(crate) struct Setup {
    pub(crate) c: KeyLease,
    pub(crate) key: U64,
    pub(crate) lease: U64,
}

/// alice registers a key and leases 2 calls on /v1/chat to bob for 1 hour.
pub(crate) fn setup() -> Setup {
    ctx("alice.testnet", T0, 1000);
    let mut c = fresh();
    let key = c.add_key(
        Provider::NearAiCloud,
        "https://cloud-api.near.ai".into(),
        "main".into(),
        "demo key".into(),
    );
    let lease = c.create_lease(
        key,
        acct("bob.testnet"),
        2,
        U64(T0 + 3600 * SEC),
        vec!["/v1/chat".into()],
        None,
    );
    Setup { c, key, lease }
}

pub(crate) fn refusal(c: &KeyLease, lease: U64, caller: &str, endpoint: &str) -> Option<String> {
    c.check_call(lease, acct(caller), endpoint.into()).reason
}

#[test]
fn grantee_call_passes_and_counts() {
    let mut s = setup();
    assert_eq!(call(&mut s.c, s.lease), 1);
    let v = s.c.get_lease(s.lease).unwrap_or_else(|| unreachable!());
    assert_eq!(
        (v.calls_used, v.calls_left, v.status),
        (1, 1, LeaseStatus::Active)
    );
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("\"event\":\"call_authorized\"")));
}

#[test]
fn refusal_lease_not_found() {
    let s = setup();
    assert_eq!(
        refusal(&s.c, U64(99), "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_not_found")
    );
}

#[test]
fn refusal_not_lease_holder() {
    let s = setup();
    assert_eq!(
        refusal(&s.c, s.lease, "mallory.testnet", "/v1/chat").as_deref(),
        Some("not_lease_holder")
    );
    // The owner of the key is not the grantee either.
    assert_eq!(
        refusal(&s.c, s.lease, "alice.testnet", "/v1/chat").as_deref(),
        Some("not_lease_holder")
    );
}

#[test]
fn refusal_endpoint_not_in_lease() {
    let s = setup();
    for e in [
        "/v1/chat/",
        "/v1/chatx",
        "/v1/keys",
        "/V1/chat",
        "/v1/chat/../keys",
        "",
    ] {
        assert_eq!(
            refusal(&s.c, s.lease, "bob.testnet", e).as_deref(),
            Some("endpoint_not_in_lease"),
            "{e}"
        );
    }
}

#[test]
fn refusal_quota_used() {
    let mut s = setup();
    call(&mut s.c, s.lease);
    call(&mut s.c, s.lease);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("quota_used")
    );
    assert_eq!(
        s.c.get_lease(s.lease).map(|l| l.status),
        Some(LeaseStatus::UsedUp)
    );
}

#[test]
#[should_panic(expected = "quota_used: All calls in this lease are used")]
fn use_lease_panics_with_code_and_hint() {
    let mut s = setup();
    for _ in 0..3 {
        call(&mut s.c, s.lease);
    }
}

#[test]
fn refusal_lease_expired_at_the_exact_expiry() {
    let s = setup();
    ctx("bob.testnet", T0 + 3600 * SEC - 1, 0);
    assert_eq!(refusal(&s.c, s.lease, "bob.testnet", "/v1/chat"), None);
    ctx("bob.testnet", T0 + 3600 * SEC, 0);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_expired")
    );
    assert_eq!(
        s.c.get_lease(s.lease).map(|l| l.status),
        Some(LeaseStatus::Expired)
    );
}

#[test]
fn refusal_lease_revoked_one() {
    let mut s = setup();
    s.c.revoke(s.lease);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
    assert_eq!(
        s.c.get_lease(s.lease).map(|l| l.status),
        Some(LeaseStatus::Revoked)
    );
}

#[test]
fn refusal_revoke_all_on_key_then_new_lease_works() {
    let mut s = setup();
    s.c.revoke_all(s.key);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
    let fresh = s.c.create_lease(
        s.key,
        acct("bob.testnet"),
        1,
        U64(T0 + 60 * SEC),
        vec!["/v1/chat".into()],
        None,
    );
    assert_eq!(refusal(&s.c, fresh, "bob.testnet", "/v1/chat"), None);
}

#[test]
fn refusal_revoke_all_owner_covers_every_key() {
    let mut s = setup();
    let key2 = s.c.add_key(
        Provider::Custom,
        "https://mock.example".into(),
        "mock".into(),
        "mock".into(),
    );
    let l2 = s.c.create_lease(
        key2,
        acct("carol.testnet"),
        5,
        U64(T0 + 60 * SEC),
        vec!["/echo".into()],
        None,
    );
    s.c.revoke_all_owner();
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
    assert_eq!(
        refusal(&s.c, l2, "carol.testnet", "/echo").as_deref(),
        Some("lease_revoked")
    );
}

#[test]
fn refusal_removed_key() {
    let mut s = setup();
    s.c.remove_key(s.key);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
    assert!(s.c.get_key(s.key).is_none());
    assert!(s.c.get_lease(s.lease).is_some(), "lease record stays for history");
}

#[test]
fn revoked_wins_over_expired_and_used_up() {
    let mut s = setup();
    s.c.revoke(s.lease);
    ctx("bob.testnet", T0 + 7200 * SEC, 0);
    assert_eq!(
        refusal(&s.c, s.lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
}

#[test]
#[should_panic(expected = "only the key owner or the issuer can revoke this lease")]
fn only_owner_revokes() {
    let mut s = setup();
    ctx("bob.testnet", T0, 0);
    s.c.revoke(s.lease);
}

#[test]
#[should_panic(expected = "only the key owner can do this")]
fn only_owner_leases_a_key() {
    let mut s = setup();
    ctx("mallory.testnet", T0, 1000);
    s.c.create_lease(
        s.key,
        acct("mallory.testnet"),
        1,
        U64(T0 + SEC),
        vec!["/v1/chat".into()],
        None,
    );
}

#[test]
#[should_panic(expected = "only the key owner can do this")]
fn only_owner_revokes_all_on_a_key() {
    let mut s = setup();
    ctx("mallory.testnet", T0, 0);
    s.c.revoke_all(s.key);
}

#[test]
fn revoke_all_owner_by_someone_else_changes_nothing() {
    let mut s = setup();
    ctx("mallory.testnet", T0, 0);
    s.c.revoke_all_owner();
    assert_eq!(refusal(&s.c, s.lease, "bob.testnet", "/v1/chat"), None);
}

#[test]
#[should_panic(expected = "only the key owner can do this")]
fn only_owner_removes_a_key() {
    let mut s = setup();
    ctx("mallory.testnet", T0, 0);
    s.c.remove_key(s.key);
}

#[test]
#[should_panic(expected = "expiry must be in the future")]
fn lease_needs_future_expiry() {
    let mut s = setup();
    s.c.create_lease(
        s.key,
        acct("bob.testnet"),
        1,
        U64(T0),
        vec!["/v1/chat".into()],
        None,
    );
}

#[test]
#[should_panic(expected = "calls must be between 1 and 1000000")]
fn lease_needs_calls() {
    let mut s = setup();
    s.c.create_lease(
        s.key,
        acct("bob.testnet"),
        0,
        U64(T0 + SEC),
        vec!["/v1/chat".into()],
        None,
    );
}

#[test]
#[should_panic(expected = "endpoint has a forbidden character or segment")]
fn lease_endpoints_are_validated() {
    let mut s = setup();
    s.c.create_lease(
        s.key,
        acct("bob.testnet"),
        1,
        U64(T0 + SEC),
        vec!["/v1/../keys".into()],
        None,
    );
}

#[test]
#[should_panic(expected = "base_url must start with https://")]
fn key_needs_https() {
    ctx("alice.testnet", T0, 1000);
    let mut c = fresh();
    c.add_key(
        Provider::Custom,
        "http://api.example".into(),
        "p".into(),
        "l".into(),
    );
}

#[test]
#[should_panic(expected = "for storage")]
fn storage_must_be_paid() {
    ctx("alice.testnet", T0, 0);
    let mut c = fresh();
    c.add_key(
        Provider::Custom,
        "https://api.example".into(),
        "p".into(),
        "l".into(),
    );
}

#[test]
#[should_panic(expected = "this key has reached its lease limit")]
fn lease_limit_per_key() {
    let mut s = setup();
    for _ in 1..=MAX_LEASES_PER_KEY {
        ctx("alice.testnet", T0, 1000); // one transaction per lease, as on chain (log limit is per tx)
        s.c.create_lease(
            s.key,
            acct("bob.testnet"),
            1,
            U64(T0 + SEC),
            vec!["/v1/chat".into()],
            None,
        );
    }
}

#[test]
fn views_list_by_owner_and_grantee_with_paging() {
    let mut s = setup();
    for _ in 0..3 {
        s.c.create_lease(
            s.key,
            acct("carol.testnet"),
            1,
            U64(T0 + SEC),
            vec!["/v1/chat".into()],
            None,
        );
    }
    assert_eq!(
        s.c.list_leases_by_owner(acct("alice.testnet"), None, None).len(),
        4
    );
    assert_eq!(
        s.c.list_leases_by_grantee(acct("carol.testnet"), None, None)
            .len(),
        3
    );
    assert_eq!(
        s.c.list_leases_by_grantee(acct("carol.testnet"), Some(1), Some(1))
            .len(),
        1
    );
    assert_eq!(
        s.c.list_leases_by_grantee(acct("nobody.testnet"), None, None),
        vec![]
    );
    let keys = s.c.list_keys_by_owner(acct("alice.testnet"), None, None);
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].leases_created, 4);
    s.c.update_key_label(s.key, "renamed".into());
    assert_eq!(s.c.get_key(s.key).map(|k| k.label), Some("renamed".into()));
}

#[test]
fn check_call_gives_code_and_hint() {
    let s = setup();
    let c =
        s.c.check_call(s.lease, acct("mallory.testnet"), "/v1/chat".into());
    assert!(!c.ok);
    assert_eq!(c.reason.as_deref(), Some("not_lease_holder"));
    assert_eq!(c.hint.as_deref(), Some(Refusal::NotLeaseHolder.hint()));
    assert!(s.c.check_call(s.lease, acct("bob.testnet"), "/v1/chat".into()).ok);
}

#[test]
fn events_never_carry_a_secret_field() {
    let _s = setup();
    for log in get_logs() {
        assert!(log.starts_with("EVENT_JSON:"), "{log}");
        assert!(!log.to_lowercase().contains("secret\":"), "{log}");
    }
}
