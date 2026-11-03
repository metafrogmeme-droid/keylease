//! Key Pass (NEP-171): a lease held as a token. Whoever holds the token holds the lease.
use crate::tests::{acct, call, ctx, fresh, refusal, SEC, T0};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken, PromiseResult};

/// alice leases 2 calls on /v1/chat to bob, transferable when asked.
fn pass(transferable: bool) -> (KeyLease, U64) {
    ctx("alice.testnet", T0, 1000);
    let mut c = fresh();
    let key = c.add_key(
        Provider::NearAiCloud,
        "https://cloud-api.near.ai".into(),
        "main".into(),
        "demo".into(),
    );
    let lease = c.create_lease(
        key,
        acct("bob.testnet"),
        2,
        U64(T0 + 3600 * SEC),
        vec!["/v1/chat".into()],
        Some(transferable),
    );
    (c, lease)
}

fn one_yocto(caller: &str) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acct(caller))
        .block_timestamp(T0 + SEC)
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}

fn transfer(c: &mut KeyLease, from: &str, to: &str, lease: U64) {
    one_yocto(from);
    c.nft_transfer(acct(to), lease.0.to_string(), None, None);
}

#[test]
fn every_lease_is_a_token_held_by_its_grantee() {
    let (c, lease) = pass(false);
    let t = c.nft_token(lease.0.to_string()).unwrap_or_else(|| unreachable!());
    assert_eq!(t.owner_id, acct("bob.testnet"));
    assert_eq!(t.token_id, "0");
    assert_eq!(t.metadata.title.as_deref(), Some("Key Pass 0"));
    assert!(c.nft_token("99".into()).is_none());
    assert!(c.nft_token("not a number".into()).is_none());
}

#[test]
fn create_lease_logs_a_nep171_mint() {
    let _ = pass(false);
    assert!(get_logs().iter().any(|l| l.contains("\"standard\":\"nep171\"")
        && l.contains("\"event\":\"nft_mint\"")
        && l.contains("\"owner_id\":\"bob.testnet\"")));
}

#[test]
fn transfer_moves_the_lease_and_the_old_holder_is_refused() {
    let (mut c, lease) = pass(true);
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"nft_transfer\"")
        && l.contains("\"old_owner_id\":\"bob.testnet\"")
        && l.contains("\"new_owner_id\":\"carol.testnet\"")));
    assert_eq!(
        refusal(&c, lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("not_lease_holder")
    );
    assert_eq!(refusal(&c, lease, "carol.testnet", "/v1/chat"), None);
    assert_eq!(c.list_leases_by_grantee(acct("bob.testnet"), None, None), vec![]);
    assert_eq!(
        c.list_leases_by_grantee(acct("carol.testnet"), None, None)
            .iter()
            .map(|l| l.lease_id)
            .collect::<Vec<_>>(),
        vec![lease]
    );
    assert_eq!(c.nft_supply_for_owner(acct("carol.testnet")), U128(1));
    assert_eq!(c.nft_supply_for_owner(acct("bob.testnet")), U128(0));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transfer_needs_exactly_one_yocto() {
    let (mut c, lease) = pass(true);
    ctx("bob.testnet", T0 + SEC, 0);
    c.nft_transfer(acct("carol.testnet"), lease.0.to_string(), None, None);
}

#[test]
#[should_panic(expected = "not_lease_holder")]
fn only_the_holder_can_transfer_not_even_the_key_owner() {
    let (mut c, lease) = pass(true);
    transfer(&mut c, "alice.testnet", "carol.testnet", lease);
}

#[test]
#[should_panic(expected = "this Key Pass is not transferable")]
fn a_lease_is_not_transferable_unless_the_owner_said_so() {
    let (mut c, lease) = pass(false);
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
}

#[test]
#[should_panic(expected = "approvals are not supported")]
fn no_approvals() {
    let (mut c, lease) = pass(true);
    one_yocto("bob.testnet");
    c.nft_transfer(acct("carol.testnet"), lease.0.to_string(), Some(0), None);
}

#[test]
#[should_panic(expected = "the receiver already holds this Key Pass")]
fn no_transfer_to_self() {
    let (mut c, lease) = pass(true);
    transfer(&mut c, "bob.testnet", "bob.testnet", lease);
}

#[test]
#[should_panic(expected = "lease_revoked")]
fn a_revoked_lease_cannot_be_transferred() {
    let (mut c, lease) = pass(true);
    ctx("alice.testnet", T0 + SEC, 0);
    c.revoke(lease);
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
}

#[test]
fn transfer_during_a_call_keeps_the_receipt_with_the_caller() {
    let (mut c, lease) = pass(true);
    assert_eq!(call(&mut c, lease), 1); // bob's call is authorized; OutLayer is still running it
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
    // OutLayer answers for bob's call after the transfer
    ctx("keylease.testnet", T0 + 2 * SEC, 0);
    let answer = near_sdk::serde_json::json!({ "ok": true, "status": 200 });
    let _ = c.on_result(
        CallInfo {
            lease_id: lease,
            call: 1,
            caller: acct("bob.testnet"),
            endpoint: "/v1/chat".into(),
            method: "POST".into(),
            input_sha256: "ab".repeat(32),
        },
        Ok(Some(answer)),
    );
    let r = c.get_receipt(lease, 1).unwrap_or_else(|| unreachable!());
    assert_eq!(r.caller, acct("bob.testnet"));
    assert_eq!(r.outcome, Outcome::Ok);
    // the next call belongs to carol: bob is refused, carol passes
    assert_eq!(
        refusal(&c, lease, "bob.testnet", "/v1/chat").as_deref(),
        Some("not_lease_holder")
    );
    assert_eq!(refusal(&c, lease, "carol.testnet", "/v1/chat"), None);
}

#[test]
fn transfers_back_and_forth_do_not_grow_storage() {
    let (mut c, lease) = pass(true);
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
    transfer(&mut c, "carol.testnet", "bob.testnet", lease);
    c.flush_all();
    let before = env::storage_usage();
    for _ in 0..3 {
        transfer(&mut c, "bob.testnet", "carol.testnet", lease);
        transfer(&mut c, "carol.testnet", "bob.testnet", lease);
    }
    c.flush_all();
    assert_eq!(env::storage_usage(), before);
}

#[test]
fn resolve_gives_the_pass_back_when_the_receiver_returns_true() {
    let (mut c, lease) = pass(true);
    transfer(&mut c, "bob.testnet", "carol.testnet", lease);
    for (answer, holder) in [
        (b"true".to_vec(), "bob.testnet"),
        (b"false".to_vec(), "carol.testnet"),
    ] {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acct("keylease.testnet"))
                .predecessor_account_id(acct("keylease.testnet"))
                .build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![PromiseResult::Successful(answer)],
        );
        let kept = c.nft_resolve_transfer(
            acct("bob.testnet"),
            acct("carol.testnet"),
            lease.0.to_string(),
            None,
        );
        assert_eq!(kept, holder == "carol.testnet");
        assert_eq!(
            c.nft_token(lease.0.to_string()).map(|t| t.owner_id),
            Some(acct(holder))
        );
        if holder == "bob.testnet" {
            transfer(&mut c, "bob.testnet", "carol.testnet", lease); // set up the second round
        }
    }
}

#[test]
fn metadata_and_enumeration() {
    let (c, lease) = pass(true);
    let m = c.nft_metadata();
    assert_eq!(
        (m.spec.as_str(), m.name.as_str()),
        ("nft-1.0.0", "KeyLease Key Pass")
    );
    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(
        c.nft_tokens(None, None)
            .iter()
            .map(|t| t.token_id.clone())
            .collect::<Vec<_>>(),
        vec![lease.0.to_string()]
    );
    assert_eq!(c.nft_tokens_for_owner(acct("bob.testnet"), None, None).len(), 1);
    let d = c
        .nft_token("0".into())
        .and_then(|t| t.metadata.description)
        .unwrap_or_default();
    assert!(d.contains("2 calls") && d.contains("/v1/chat"), "{d}");
}
