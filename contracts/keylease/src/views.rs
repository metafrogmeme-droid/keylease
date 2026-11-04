//! Read-only views: plain status for the web app, SDK and agents.
use crate::{KeyLease, KeyLeaseExt, KeyRecord, Lease, Provider};
use near_sdk::json_types::U64;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{near, AccountId};

/// Most items one list call returns.
pub const MAX_PAGE: u32 = 100;

/// A key as shown to anyone.
#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct KeyView {
    pub key_id: U64,
    pub owner: AccountId,
    pub provider: Provider,
    pub base_url: String,
    pub secret_profile: String,
    pub label: String,
    pub created_at: U64,
    pub leases_created: u32,
}

/// Lease state in one word.
#[near(serializers = [json])]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LeaseStatus {
    Active,
    Revoked,
    Expired,
    UsedUp,
}

/// A lease as shown to anyone: calls used/left, expiry, status.
#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct LeaseView {
    pub lease_id: U64,
    pub key_id: U64,
    pub owner: AccountId,
    pub grantee: AccountId,
    pub calls_total: u32,
    pub calls_used: u32,
    pub calls_left: u32,
    pub expires_at: U64,
    pub endpoints: Vec<String>,
    pub status: LeaseStatus,
    pub created_at: U64,
    /// The lease this one was handed on from; None for a key owner's lease.
    pub parent: Option<U64>,
    pub depth: u8,
    pub issuer: AccountId,
    /// Highest nonce a signed call used; the next signed call needs a higher one.
    pub last_nonce: U64,
}

/// Answer of `check_call`: would this call pass right now, and if not, why and what to do.
#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct CallCheck {
    pub ok: bool,
    pub reason: Option<String>,
    pub hint: Option<String>,
}

#[near]
impl KeyLease {
    pub fn get_key(&self, key_id: U64) -> Option<KeyView> {
        self.keys.get(&key_id.0).map(|k| key_view(key_id.0, k))
    }

    pub fn get_lease(&self, lease_id: U64) -> Option<LeaseView> {
        self.leases
            .get(&lease_id.0)
            .map(|l| self.lease_view(lease_id.0, l))
    }

    /// Dry run of `use_lease` for `caller`: no gas for the caller, no state change.
    pub fn check_call(&self, lease_id: U64, caller: AccountId, endpoint: String) -> CallCheck {
        match self.check_internal(lease_id.0, &caller, &endpoint) {
            Ok(()) => CallCheck {
                ok: true,
                reason: None,
                hint: None,
            },
            Err(r) => CallCheck {
                ok: false,
                reason: Some(r.code().to_owned()),
                hint: Some(r.hint().to_owned()),
            },
        }
    }

    pub fn list_keys_by_owner(
        &self,
        owner: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<KeyView> {
        page(&self.keys_by_owner, &owner, from_index, limit)
            .filter_map(|id| self.keys.get(&id).map(|k| key_view(id, k)))
            .collect()
    }

    pub fn list_leases_by_owner(
        &self,
        owner: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<LeaseView> {
        self.lease_page(&self.leases_by_owner, &owner, from_index, limit)
    }

    pub fn list_leases_by_grantee(
        &self,
        grantee: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<LeaseView> {
        self.lease_page(&self.leases_by_grantee, &grantee, from_index, limit)
    }
}

impl KeyLease {
    fn lease_page(
        &self,
        index: &LookupMap<AccountId, IterableSet<u64>>,
        account: &AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<LeaseView> {
        page(index, account, from_index, limit)
            .filter_map(|id| self.leases.get(&id).map(|l| self.lease_view(id, l)))
            .collect()
    }

    fn lease_view(&self, id: u64, l: &Lease) -> LeaseView {
        LeaseView {
            lease_id: U64(id),
            key_id: U64(l.key_id),
            owner: l.owner.clone(),
            grantee: l.grantee.clone(),
            calls_total: l.calls_total,
            calls_used: l.calls_used,
            calls_left: l.calls_total.saturating_sub(l.calls_used),
            expires_at: U64(l.expires_at),
            endpoints: l.endpoints.clone(),
            status: self.status(id, l),
            created_at: U64(l.created_at),
            parent: l.parent.map(U64),
            depth: l.depth,
            issuer: l.issuer.clone(),
            last_nonce: U64(l.last_nonce),
        }
    }

    /// Status as the gate would see it for the grantee (endpoint aside), leases above it included.
    fn status(&self, id: u64, l: &Lease) -> LeaseStatus {
        let probe = l.endpoints.first().map_or("", String::as_str);
        match self.check_internal(id, &l.grantee, probe) {
            Ok(()) => LeaseStatus::Active,
            Err(crate::Refusal::LeaseExpired) => LeaseStatus::Expired,
            Err(crate::Refusal::QuotaUsed | crate::Refusal::ParentQuotaUsed) => LeaseStatus::UsedUp,
            Err(_) => LeaseStatus::Revoked,
        }
    }
}

fn key_view(id: u64, k: &KeyRecord) -> KeyView {
    KeyView {
        key_id: U64(id),
        owner: k.owner.clone(),
        provider: k.provider,
        base_url: k.base_url.clone(),
        secret_profile: k.secret_profile.clone(),
        label: k.label.clone(),
        created_at: U64(k.created_at),
        leases_created: k.leases_created,
    }
}

fn page<'a>(
    index: &'a LookupMap<AccountId, IterableSet<u64>>,
    account: &AccountId,
    from_index: Option<u32>,
    limit: Option<u32>,
) -> impl Iterator<Item = u64> + 'a {
    let from = from_index.unwrap_or(0) as usize;
    let take = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
    index
        .get(account)
        .into_iter()
        .flat_map(move |set| set.iter().skip(from).take(take).copied())
}
