//! Sub-leases: a lease holder hands on a slice of its lease. Limits only shrink, every use counts on every
//! ancestor, and revoking a lease revokes its whole subtree in the same call.
use crate::tests::{acct, ctx, fresh, refusal, SEC, T0};
use crate::*;

const HOUR: u64 = 3600 * SEC;

/// alice (key owner) leases 10 calls on /v1/chat and /v1/models to bob for 2 hours.
fn root() -> (KeyLease, U64, U64) {
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
        10,
        U64(T0 + 2 * HOUR),
        vec!["/v1/chat".into(), "/v1/models".into()],
        None,
    );
    (c, key, lease)
}

fn sub(c: &mut KeyLease, by: &str, parent: U64, to: &str, calls: u32, until: u64, eps: &[&str]) -> U64 {
    ctx(by, T0 + SEC, 1000);
    c.create_sub_lease(
        parent,
        acct(to),
        calls,
        U64(until),
        eps.iter().map(|e| (*e).to_owned()).collect(),
    )
}

fn use_as(c: &mut KeyLease, who: &str, lease: U64, endpoint: &str, now: u64) {
    ctx(who, now, 25);
    let _ = c.use_lease(lease, endpoint.into(), None, Some("{}".into()));
}

#[test]
fn the_holder_hands_on_a_slice_and_each_use_counts_up_the_tree() {
    let (mut c, _, root) = root();
    let child = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        3,
        T0 + HOUR,
        &["/v1/chat"],
    );
    let v = c.get_lease(child).unwrap_or_else(|| unreachable!());
    assert_eq!(
        (v.parent, v.depth, v.issuer.as_str()),
        (Some(root), 1, "bob.testnet")
    );
    assert_eq!((v.calls_total, v.status), (3, LeaseStatus::Active));
    use_as(&mut c, "carol.testnet", child, "/v1/chat", T0 + 2 * SEC);
    assert_eq!(c.get_lease(child).map(|l| l.calls_used), Some(1));
    assert_eq!(c.get_lease(root).map(|l| l.calls_used), Some(1));
    assert_eq!(
        c.list_sub_leases(root)
            .iter()
            .map(|l| l.lease_id)
            .collect::<Vec<_>>(),
        vec![child]
    );
}

#[test]
#[should_panic(expected = "a sub-lease cannot have more calls than every lease above it has left")]
fn a_child_cannot_have_more_calls_than_its_parent_has_left() {
    let (mut c, _, root) = root();
    let _ = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        11,
        T0 + HOUR,
        &["/v1/chat"],
    );
}

#[test]
#[should_panic(expected = "a sub-lease cannot outlive the lease above it")]
fn a_child_cannot_outlive_its_parent() {
    let (mut c, _, root) = root();
    let _ = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        1,
        T0 + 3 * HOUR,
        &["/v1/chat"],
    );
}

#[test]
#[should_panic(expected = "a sub-lease can only use endpoints of the lease above it")]
fn a_child_cannot_widen_the_scope() {
    let (mut c, _, root) = root();
    let _ = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        1,
        T0 + HOUR,
        &["/v1/admin"],
    );
}

#[test]
#[should_panic(expected = "sub-leases go at most 3 levels deep")]
fn depth_is_at_most_three() {
    let (mut c, _, root) = root();
    let a = sub(
        &mut c,
        "bob.testnet",
        root,
        "c1.testnet",
        5,
        T0 + HOUR,
        &["/v1/chat"],
    );
    let b = sub(&mut c, "c1.testnet", a, "c2.testnet", 4, T0 + HOUR, &["/v1/chat"]);
    let d = sub(&mut c, "c2.testnet", b, "c3.testnet", 3, T0 + HOUR, &["/v1/chat"]);
    let _ = sub(&mut c, "c3.testnet", d, "c4.testnet", 2, T0 + HOUR, &["/v1/chat"]);
}

#[test]
#[should_panic(expected = "not_lease_holder")]
fn only_the_holder_can_sub_lease_not_even_the_key_owner() {
    let (mut c, _, root) = root();
    let _ = sub(
        &mut c,
        "alice.testnet",
        root,
        "carol.testnet",
        1,
        T0 + HOUR,
        &["/v1/chat"],
    );
}

#[test]
#[should_panic(expected = "lease_revoked")]
fn a_revoked_lease_cannot_be_sub_leased() {
    let (mut c, _, root) = root();
    ctx("alice.testnet", T0 + SEC, 0);
    c.revoke(root);
    let _ = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        1,
        T0 + HOUR,
        &["/v1/chat"],
    );
}

#[test]
#[should_panic(expected = "a lease can have at most 10 sub-leases")]
fn children_per_lease_are_bounded() {
    let (mut c, _, root) = root();
    for i in 0..11 {
        let _ = sub(
            &mut c,
            "bob.testnet",
            root,
            &format!("c{i}.testnet"),
            1,
            T0 + HOUR,
            &["/v1/chat"],
        );
    }
}

#[test]
fn revoking_a_parent_revokes_the_whole_subtree_in_the_same_call() {
    let (mut c, _, root) = root();
    let child = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        5,
        T0 + HOUR,
        &["/v1/chat"],
    );
    let grandchild = sub(
        &mut c,
        "carol.testnet",
        child,
        "dave.testnet",
        2,
        T0 + HOUR,
        &["/v1/chat"],
    );
    ctx("alice.testnet", T0 + 2 * SEC, 0);
    c.revoke(root);
    // no further transaction: both descendants are refused right after the one revoke
    assert_eq!(
        refusal(&c, root, "bob.testnet", "/v1/chat").as_deref(),
        Some("lease_revoked")
    );
    assert_eq!(
        refusal(&c, child, "carol.testnet", "/v1/chat").as_deref(),
        Some("parent_revoked")
    );
    assert_eq!(
        refusal(&c, grandchild, "dave.testnet", "/v1/chat").as_deref(),
        Some("parent_revoked")
    );
    for l in [child, grandchild] {
        assert_eq!(c.get_lease(l).map(|v| v.status), Some(LeaseStatus::Revoked));
    }
}

#[test]
fn revoking_a_middle_lease_spares_the_branches_above_and_beside_it() {
    let (mut c, _, root) = root();
    let left = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        3,
        T0 + HOUR,
        &["/v1/chat"],
    );
    let right = sub(
        &mut c,
        "bob.testnet",
        root,
        "erin.testnet",
        3,
        T0 + HOUR,
        &["/v1/chat"],
    );
    let under_left = sub(
        &mut c,
        "carol.testnet",
        left,
        "dave.testnet",
        1,
        T0 + HOUR,
        &["/v1/chat"],
    );
    ctx("bob.testnet", T0 + 2 * SEC, 0); // the issuer of `left` may revoke it
    c.revoke(left);
    assert_eq!(
        refusal(&c, under_left, "dave.testnet", "/v1/chat").as_deref(),
        Some("parent_revoked")
    );
    assert_eq!(refusal(&c, right, "erin.testnet", "/v1/chat"), None);
    assert_eq!(refusal(&c, root, "bob.testnet", "/v1/chat"), None);
}

#[test]
#[should_panic(expected = "only the key owner or the issuer can revoke this lease")]
fn strangers_cannot_revoke_a_sub_lease() {
    let (mut c, _, root) = root();
    let child = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        3,
        T0 + HOUR,
        &["/v1/chat"],
    );
    ctx("mallory.testnet", T0 + 2 * SEC, 0);
    c.revoke(child);
}

#[test]
fn the_panic_button_and_revoke_all_reach_every_descendant() {
    for panic_button in [true, false] {
        let (mut c, key, root) = root();
        let child = sub(
            &mut c,
            "bob.testnet",
            root,
            "carol.testnet",
            3,
            T0 + HOUR,
            &["/v1/chat"],
        );
        ctx("alice.testnet", T0 + 2 * SEC, 0);
        if panic_button {
            c.revoke_all_owner();
        } else {
            c.revoke_all(key);
        }
        assert!(refusal(&c, child, "carol.testnet", "/v1/chat").is_some());
    }
}

#[test]
fn a_parent_that_runs_out_stops_its_children() {
    let (mut c, _, root) = root();
    let child = sub(
        &mut c,
        "bob.testnet",
        root,
        "carol.testnet",
        5,
        T0 + HOUR,
        &["/v1/chat"],
    );
    for _ in 0..10 {
        use_as(&mut c, "bob.testnet", root, "/v1/chat", T0 + 2 * SEC);
    }
    assert_eq!(
        refusal(&c, child, "carol.testnet", "/v1/chat").as_deref(),
        Some("parent_quota_used")
    );
    assert_eq!(c.get_lease(child).map(|v| v.status), Some(LeaseStatus::UsedUp));
}

/// Small deterministic PRNG (xorshift64*), so the randomized test needs no dependency and is reproducible.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const EPS: [&str; 4] = ["/a", "/b", "/c", "/d"];

/// The invariants over a whole tree: no lease over its quota; every child inside its parent's expiry,
/// scope and calls, one level below it, at most 3 deep.
fn assert_tree(c: &KeyLease, nodes: &[(U64, String)]) {
    for (id, _) in nodes {
        let l = c.get_lease(*id).unwrap_or_else(|| unreachable!());
        assert!(
            l.calls_used <= l.calls_total,
            "lease {} used more than its quota",
            id.0
        );
        if let Some(p) = l.parent.and_then(|p| c.get_lease(p)) {
            assert!(l.expires_at.0 <= p.expires_at.0, "a child outlives its parent");
            assert!(
                l.endpoints.iter().all(|e| p.endpoints.contains(e)),
                "a child widens its parent"
            );
            assert!(
                l.calls_total <= p.calls_total,
                "a child has more calls than its parent"
            );
            assert!(l.depth == p.depth + 1 && l.depth <= 3);
        }
    }
}

/// Random trees, random sub-lease requests (inside and outside the limits), random calls and clock.
/// Whatever happens: a child never outlives, widens or out-calls a lease above it, and no call ever
/// passes past an ancestor's expiry, scope or quota.
#[test]
fn a_child_never_outlives_or_exceeds_any_lease_above_it() {
    // Refused requests panic by design; keep their messages out of the test output.
    let quiet = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for _case in 0..60 {
        ctx("alice.testnet", T0, 10_000);
        let mut c = fresh();
        let key = c.add_key(
            Provider::Custom,
            "https://api.example".into(),
            "p".into(),
            "k".into(),
        );
        let root_eps: Vec<String> = EPS
            .iter()
            .filter(|_| rng.below(2) == 0)
            .map(|e| (*e).to_owned())
            .collect();
        let root_eps = if root_eps.is_empty() {
            vec!["/a".to_owned()]
        } else {
            root_eps
        };
        let root_calls = 1 + u32::try_from(rng.below(12)).unwrap_or(0);
        let root_until = T0 + (1 + rng.below(4)) * HOUR;
        let root = c.create_lease(
            key,
            acct("h0.testnet"),
            root_calls,
            U64(root_until),
            root_eps,
            None,
        );
        let mut nodes = vec![(root, "h0.testnet".to_owned())];
        for step in 0..12 {
            let (parent, holder) = nodes[usize::try_from(rng.below(nodes.len() as u64)).unwrap_or(0)].clone();
            if rng.below(2) == 0 {
                // try a sub-lease: sometimes inside the limits, sometimes outside
                let p = c.get_lease(parent).unwrap_or_else(|| unreachable!());
                let calls = 1 + u32::try_from(rng.below(u64::from(p.calls_total) + 3)).unwrap_or(0);
                let until = T0 + SEC + rng.below(5 * HOUR);
                let eps: Vec<String> = EPS
                    .iter()
                    .filter(|_| rng.below(2) == 0)
                    .map(|e| (*e).to_owned())
                    .collect();
                let to = format!("h{}.testnet", nodes.len() + step);
                ctx(&holder, T0 + SEC, 10_000);
                let made = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    c.create_sub_lease(parent, acct(&to), calls, U64(until), eps.clone())
                }));
                if let Ok(child) = made {
                    nodes.push((child, to));
                }
            } else {
                // try a call at a random time on a random endpoint
                let now = T0 + 2 * SEC + rng.below(5 * HOUR);
                let ep = EPS[usize::try_from(rng.below(4)).unwrap_or(0)];
                ctx(&holder, now, 25);
                let before = c.get_lease(parent).map_or(0, |l| l.calls_used);
                let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _ = c.use_lease(parent, ep.into(), None, Some("{}".into()));
                }))
                .is_ok();
                if ok {
                    assert_eq!(c.get_lease(parent).map(|l| l.calls_used), Some(before + 1));
                    // the call passed: every lease up the chain allowed it at that moment
                    let mut cur = Some(parent);
                    while let Some(id) = cur {
                        let l = c.get_lease(id).unwrap_or_else(|| unreachable!());
                        assert!(
                            now < l.expires_at.0,
                            "a call passed after a lease above it expired"
                        );
                        assert!(
                            l.endpoints.iter().any(|e| e == ep),
                            "a call passed outside a lease's scope"
                        );
                        cur = l.parent;
                    }
                }
            }
            assert_tree(&c, &nodes);
        }
    }
    std::panic::set_hook(quiet);
}
