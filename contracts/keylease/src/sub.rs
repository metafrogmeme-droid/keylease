//! Sub-leases: the holder of a lease hands on a slice of it. Limits only shrink: calls no more than every
//! lease above has left, expiry no later than the parent's, endpoints a subset of the parent's, at most
//! `MAX_DEPTH` levels. Each use counts on every lease above (run.rs), the gate checks every lease above
//! (`check_internal`), and revoking a lease refuses its whole subtree from that call on (`parent_revoked`),
//! however many children it has: nothing is written per child.
use crate::views::LeaseView;
use crate::{events, ok, refuse, validate, KeyLease, KeyLeaseExt, Lease, Refusal, StorageKey};
use near_sdk::json_types::U64;
use near_sdk::{env, near, require, AccountId};

/// Deepest sub-lease: a key owner's lease is depth 0.
pub const MAX_DEPTH: u8 = 3;
/// Most sub-leases one lease may hand on (storage griefing bound, T7/T13).
pub const MAX_CHILDREN: usize = 10;

#[near]
impl KeyLease {
    /// Hand on part of a lease you hold: `calls` calls on `endpoints` (a subset of the parent's) until
    /// `expires_at` (no later than the parent's). The new lease's storage is paid by the caller.
    #[payable]
    pub fn create_sub_lease(
        &mut self,
        parent: U64,
        grantee: AccountId,
        calls: u32,
        expires_at: U64,
        endpoints: Vec<String>,
    ) -> U64 {
        let before = env::storage_usage();
        let caller = env::predecessor_account_id();
        ok(validate::calls(calls));
        ok(validate::expiry(expires_at.0, env::block_timestamp()));
        ok(validate::endpoints(&endpoints));
        let p = self
            .leases
            .get(&parent.0)
            .unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        if p.grantee != caller {
            refuse(Refusal::NotLeaseHolder);
        }
        // The parent itself must be usable right now (own refusals first, then the leases above it).
        let probe = p.endpoints.first().cloned().unwrap_or_default();
        if let Err(r) = self.check_internal(parent.0, &caller, &probe) {
            refuse(r);
        }
        require!(p.depth < MAX_DEPTH, "sub-leases go at most 3 levels deep");
        require!(
            p.children.len() < MAX_CHILDREN,
            "a lease can have at most 10 sub-leases"
        );
        require!(
            calls <= self.calls_left_up_the_chain(parent.0),
            "a sub-lease cannot have more calls than every lease above it has left"
        );
        require!(
            expires_at.0 <= p.expires_at,
            "a sub-lease cannot outlive the lease above it"
        );
        require!(
            endpoints.iter().all(|e| p.endpoints.contains(e)),
            "a sub-lease can only use endpoints of the lease above it"
        );

        let child = Lease {
            key_id: p.key_id,
            owner: p.owner.clone(),
            grantee: grantee.clone(),
            calls_total: calls,
            calls_used: 0,
            expires_at: expires_at.0,
            endpoints,
            revoked: false,
            // Same epochs as the parent: revoke_all on the key and the owner's panic button reach it too.
            key_epoch: p.key_epoch,
            owner_epoch: p.owner_epoch,
            transferable: false,
            parent: Some(parent.0),
            depth: p.depth + 1,
            issuer: caller.clone(),
            children: Vec::new(),
            created_at: env::block_timestamp(),
        };
        let owner = p.owner.clone();
        let id = self.next_lease_id;
        self.next_lease_id += 1;
        if let Some(p) = self.leases.get_mut(&parent.0) {
            p.children.push(id);
        }
        events::sub_lease_created(id, &child);
        events::nft_mint(id, &child.grantee);
        self.leases.insert(id, child);
        Self::index(&mut self.leases_by_owner, &owner, id, |h| {
            StorageKey::LeasesByOwnerSet { owner: h }
        });
        Self::index(&mut self.leases_by_grantee, &grantee, id, |h| {
            StorageKey::LeasesByGranteeSet { grantee: h }
        });
        self.flush_and_settle(before, &caller);
        U64(id)
    }

    /// The sub-leases handed on from one lease.
    pub fn list_sub_leases(&self, lease_id: U64) -> Vec<LeaseView> {
        self.leases.get(&lease_id.0).map_or_else(Vec::new, |l| {
            l.children
                .iter()
                .filter_map(|id| self.get_lease(U64(*id)))
                .collect()
        })
    }
}

impl KeyLease {
    /// The fewest calls left on this lease or any lease above it.
    fn calls_left_up_the_chain(&self, id: u64) -> u32 {
        let mut left = u32::MAX;
        let mut cur = Some(id);
        while let Some(i) = cur {
            let Some(l) = self.leases.get(&i) else { break };
            left = left.min(l.calls_total.saturating_sub(l.calls_used));
            cur = l.parent;
        }
        left
    }
}
