//! KeyLease contract. An owner registers a sealed API key once and lends calls, not the key.
//!
//! The key itself lives in OutLayer Secrets under the owner's account, locked to this contract and the
//! proxy build; this contract keeps only its public description and the leases. `use_lease` is the gate:
//! it checks the lease, uses one call and asks OutLayer to run the proxy; `on_result` stores a receipt.
#![allow(clippy::needless_pass_by_value)] // #[near] methods take owned arguments.
#![allow(missing_docs)] // #[near] generates undocumented items (ext structs, wrappers).

mod check;
mod events;
mod nft;
mod run;
mod sub;
mod views;

use keylease_rules as validate;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_nft;
#[cfg(test)]
mod tests_run;
#[cfg(test)]
mod tests_sub;

pub use check::check;
pub use keylease_reasons::Refusal;
pub use nft::{NftContractMetadata, Token, TokenMetadata};
pub use run::{classify, CallInfo, Config, Outcome, Receipt, MIN_DEPOSIT, RECEIPT_RESERVE};
pub use views::{CallCheck, KeyView, LeaseStatus, LeaseView};

use near_sdk::json_types::U64;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, CryptoHash, NearToken, PanicOnDefault, Promise,
};

/// Most keys one owner may register (storage griefing bound, T7).
pub const MAX_KEYS_PER_OWNER: u32 = 50;
/// Most leases one key may ever create (storage griefing bound, T7).
pub const MAX_LEASES_PER_KEY: u32 = 200;

/// Which kind of API the key opens; drives presets and request shapes in the proxy.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    /// NEAR AI Cloud (OpenAI-compatible, TEE inference).
    NearAiCloud,
    /// Any OpenAI-compatible API.
    OpenAiCompatible,
    /// Any Anthropic-compatible API.
    AnthropicCompatible,
    /// Any other HTTPS API under the key's base URL.
    Custom,
}

/// A registered key. The secret value is never here.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct KeyRecord {
    /// Account that owns the sealed secret and the key's leases.
    pub owner: AccountId,
    /// API kind.
    pub provider: Provider,
    /// Only host (and path prefix) the proxy may call with this key.
    pub base_url: String,
    /// OutLayer secret profile under `owner` that holds the key.
    pub secret_profile: String,
    /// Owner's name for the key.
    pub label: String,
    /// Block time of registration, ns.
    pub created_at: u64,
    /// Bumped by `revoke_all`: leases created under an older epoch are revoked.
    pub revoke_epoch: u32,
    /// Leases created so far (bounded by `MAX_LEASES_PER_KEY`).
    pub leases_created: u32,
}

/// A lease: the right to make `calls_total` calls to `endpoints` until `expires_at`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Lease {
    /// The key this lease uses.
    pub key_id: u64,
    /// Key owner at creation (the one who may revoke).
    pub owner: AccountId,
    /// Account allowed to call.
    pub grantee: AccountId,
    /// Calls granted.
    pub calls_total: u32,
    /// Calls used so far.
    pub calls_used: u32,
    /// Expiry, block time ns.
    pub expires_at: u64,
    /// Exact endpoint paths this lease may call.
    pub endpoints: Vec<String>,
    /// Revoked one by one.
    pub revoked: bool,
    /// Key's revoke epoch at creation.
    pub key_epoch: u32,
    /// Owner's revoke epoch at creation.
    pub owner_epoch: u32,
    /// The holder may transfer the lease as a Key Pass (NEP-171); set by the owner at creation.
    pub transferable: bool,
    /// The lease this one was handed on from (`create_sub_lease`); None for a lease from the key owner.
    pub parent: Option<u64>,
    /// 0 for a key owner's lease, parent's depth + 1 for a sub-lease (at most `MAX_DEPTH`).
    pub depth: u8,
    /// Who created it: the key owner, or the holder of the parent lease. May revoke it.
    pub issuer: AccountId,
    /// Sub-leases handed on from this lease (at most `MAX_CHILDREN`).
    pub children: Vec<u64>,
    /// Block time of creation, ns.
    pub created_at: u64,
}

#[derive(BorshStorageKey)]
#[near]
pub(crate) enum StorageKey {
    Keys,
    Leases,
    OwnerEpochs,
    KeysByOwner,
    KeysByOwnerSet { owner: CryptoHash },
    LeasesByOwner,
    LeasesByOwnerSet { owner: CryptoHash },
    LeasesByGrantee,
    LeasesByGranteeSet { grantee: CryptoHash },
    Receipts,
}

/// Contract state.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct KeyLease {
    keys: LookupMap<u64, KeyRecord>,
    leases: LookupMap<u64, Lease>,
    owner_epochs: LookupMap<AccountId, u32>,
    keys_by_owner: LookupMap<AccountId, IterableSet<u64>>,
    leases_by_owner: LookupMap<AccountId, IterableSet<u64>>,
    leases_by_grantee: LookupMap<AccountId, IterableSet<u64>>,
    receipts: LookupMap<(u64, u32), Receipt>,
    config: Config,
    next_key_id: u64,
    next_lease_id: u64,
}

#[near]
impl KeyLease {
    /// Fresh state. Private: only the contract account itself can initialise it, so nobody can front-run
    /// a deploy and make themselves admin (`cli deploy` sends the code and `new` in one transaction).
    /// `admin` may point the contract at a new proxy build (`set_proxy`).
    #[init]
    #[private]
    #[must_use]
    pub fn new(admin: AccountId, outlayer: AccountId, proxy_url: String, proxy_hash: String) -> Self {
        let config = Config::new(admin, outlayer, proxy_url, proxy_hash);
        Self {
            receipts: LookupMap::new(StorageKey::Receipts),
            config,
            keys: LookupMap::new(StorageKey::Keys),
            leases: LookupMap::new(StorageKey::Leases),
            owner_epochs: LookupMap::new(StorageKey::OwnerEpochs),
            keys_by_owner: LookupMap::new(StorageKey::KeysByOwner),
            leases_by_owner: LookupMap::new(StorageKey::LeasesByOwner),
            leases_by_grantee: LookupMap::new(StorageKey::LeasesByGrantee),
            next_key_id: 0,
            next_lease_id: 0,
        }
    }

    /// Register a key the caller sealed in OutLayer Secrets. Attach storage; the rest is refunded.
    #[payable]
    pub fn add_key(
        &mut self,
        provider: Provider,
        base_url: String,
        secret_profile: String,
        label: String,
    ) -> U64 {
        let before = env::storage_usage();
        ok(validate::base_url(&base_url));
        ok(validate::profile(&secret_profile));
        ok(validate::label(&label));
        let owner = env::predecessor_account_id();
        let id = self.next_key_id;
        self.next_key_id += 1;
        let set = self.keys_by_owner.entry(owner.clone()).or_insert_with(|| {
            IterableSet::new(StorageKey::KeysByOwnerSet {
                owner: env::sha256_array(owner.as_bytes()),
            })
        });
        require!(set.len() < MAX_KEYS_PER_OWNER, "too many keys for this owner");
        set.insert(id);
        set.flush(); // nested sets write on drop; flush now so the storage charge below is exact
        let record = KeyRecord {
            owner: owner.clone(),
            provider,
            base_url,
            secret_profile,
            label,
            created_at: env::block_timestamp(),
            revoke_epoch: 0,
            leases_created: 0,
        };
        events::key_added(id, &record);
        self.keys.insert(id, record);
        self.flush_and_settle(before, &owner);
        U64(id)
    }

    /// Rename a key. Owner only.
    #[payable]
    pub fn update_key_label(&mut self, key_id: U64, label: String) {
        let before = env::storage_usage();
        ok(validate::label(&label));
        let owner = env::predecessor_account_id();
        let key = self.owned_key_mut(key_id.0, &owner);
        key.label = label;
        self.flush_and_settle(before, &owner);
    }

    /// Remove a key. Every lease on it stops working at once; their records stay for history.
    /// Freed storage is refunded to the owner.
    pub fn remove_key(&mut self, key_id: U64) {
        let before = env::storage_usage();
        let owner = env::predecessor_account_id();
        self.owned_key_mut(key_id.0, &owner);
        self.keys.remove(&key_id.0);
        if let Some(set) = self.keys_by_owner.get_mut(&owner) {
            set.remove(&key_id.0);
            set.flush();
        }
        events::key_removed(key_id.0, &owner);
        self.flush_and_settle(before, &owner);
    }

    /// Lend calls on a key: `calls` calls to exactly these `endpoints` until `expires_at` (block time, ns).
    /// The lease is also a Key Pass token held by `grantee`; `transferable` (default false) lets the
    /// holder pass it on with `nft_transfer`.
    #[payable]
    pub fn create_lease(
        &mut self,
        key_id: U64,
        grantee: AccountId,
        calls: u32,
        expires_at: U64,
        endpoints: Vec<String>,
        transferable: Option<bool>,
    ) -> U64 {
        let before = env::storage_usage();
        ok(validate::calls(calls));
        ok(validate::expiry(expires_at.0, env::block_timestamp()));
        ok(validate::endpoints(&endpoints));
        let owner = env::predecessor_account_id();
        let owner_epoch = self.owner_epoch(&owner);
        let key = self.owned_key_mut(key_id.0, &owner);
        require!(
            key.leases_created < MAX_LEASES_PER_KEY,
            "this key has reached its lease limit"
        );
        key.leases_created += 1;
        let key_epoch = key.revoke_epoch;
        let id = self.next_lease_id;
        self.next_lease_id += 1;
        let lease = Lease {
            key_id: key_id.0,
            owner: owner.clone(),
            grantee: grantee.clone(),
            calls_total: calls,
            calls_used: 0,
            expires_at: expires_at.0,
            endpoints,
            revoked: false,
            key_epoch,
            owner_epoch,
            transferable: transferable.unwrap_or(false),
            parent: None,
            depth: 0,
            issuer: owner.clone(),
            children: Vec::new(),
            created_at: env::block_timestamp(),
        };
        events::lease_created(id, &lease);
        events::nft_mint(id, &lease.grantee);
        self.leases.insert(id, lease);
        Self::index(&mut self.leases_by_owner, &owner, id, |h| {
            StorageKey::LeasesByOwnerSet { owner: h }
        });
        Self::index(&mut self.leases_by_grantee, &grantee, id, |h| {
            StorageKey::LeasesByGranteeSet { grantee: h }
        });
        self.flush_and_settle(before, &owner);
        U64(id)
    }

    /// Revoke one lease, and with it every sub-lease below it (they are refused `parent_revoked` from
    /// this call on). The key owner may revoke any lease; the issuer of a sub-lease may revoke it.
    pub fn revoke(&mut self, lease_id: U64) {
        let caller = env::predecessor_account_id();
        let lease = self
            .leases
            .get_mut(&lease_id.0)
            .unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        require!(
            lease.owner == caller || lease.issuer == caller,
            "only the key owner or the issuer can revoke this lease"
        );
        lease.revoked = true;
        events::lease_revoked(lease_id.0, &caller);
    }

    /// Revoke every lease on one key, in one step whatever their number.
    pub fn revoke_all(&mut self, key_id: U64) {
        let caller = env::predecessor_account_id();
        let key = self.owned_key_mut(key_id.0, &caller);
        key.revoke_epoch += 1;
        events::revoked_all(Some(key_id.0), &caller);
    }

    /// Panic button: revoke every lease of the caller on every key, in one step.
    pub fn revoke_all_owner(&mut self) {
        let caller = env::predecessor_account_id();
        let next = self.owner_epoch(&caller) + 1;
        self.owner_epochs.insert(caller.clone(), next);
        events::revoked_all(None, &caller);
    }
}

impl KeyLease {
    pub(crate) fn owner_epoch(&self, owner: &AccountId) -> u32 {
        self.owner_epochs.get(owner).copied().unwrap_or(0)
    }

    fn owned_key_mut(&mut self, key_id: u64, caller: &AccountId) -> &mut KeyRecord {
        let key = self
            .keys
            .get_mut(&key_id)
            .unwrap_or_else(|| env::panic_str("no key has this id"));
        require!(&key.owner == caller, "only the key owner can do this");
        key
    }

    pub(crate) fn check_internal(
        &self,
        lease_id: u64,
        caller: &AccountId,
        endpoint: &str,
    ) -> Result<(), Refusal> {
        let lease = self.leases.get(&lease_id);
        let key = lease.and_then(|l| self.keys.get(&l.key_id));
        let owner_epoch = lease.map_or(0, |l| self.owner_epoch(&l.owner));
        check(lease, key, owner_epoch, caller, endpoint, env::block_timestamp())?;
        // Every lease above a sub-lease must still allow it (at most MAX_DEPTH steps).
        let mut up = lease.and_then(|l| l.parent);
        while let Some(id) = up {
            let p = self.leases.get(&id).ok_or(Refusal::ParentRevoked)?;
            if self.revoked(p) {
                return Err(Refusal::ParentRevoked);
            }
            if p.calls_used >= p.calls_total {
                return Err(Refusal::ParentQuotaUsed);
            }
            up = p.parent;
        }
        Ok(())
    }

    pub(crate) fn index(
        map: &mut LookupMap<AccountId, IterableSet<u64>>,
        account: &AccountId,
        id: u64,
        prefix: impl FnOnce(CryptoHash) -> StorageKey,
    ) {
        let set = map
            .entry(account.clone())
            .or_insert_with(|| IterableSet::new(prefix(env::sha256_array(account.as_bytes()))));
        set.insert(id);
        set.flush();
    }

    pub(crate) fn flush_all(&mut self) {
        self.keys.flush();
        self.leases.flush();
        self.keys_by_owner.flush();
        self.leases_by_owner.flush();
        self.leases_by_grantee.flush();
    }

    /// Take `id` out of `account`'s index; drop the account's set when it empties (no storage left behind).
    fn unindex(map: &mut LookupMap<AccountId, IterableSet<u64>>, account: &AccountId, id: u64) {
        let empty = map.get_mut(account).is_some_and(|set| {
            set.remove(&id);
            set.flush();
            set.is_empty()
        });
        if empty {
            if let Some(mut set) = map.remove(account) {
                set.clear();
                set.flush();
            }
        }
    }

    /// Write state, then charge the storage it grew by to `payer` (refunding the rest of the deposit),
    /// or refund what it shrank by.
    pub(crate) fn flush_and_settle(&mut self, before: u64, payer: &AccountId) {
        self.flush_all();
        let after = env::storage_usage();
        let attached = env::attached_deposit().as_yoctonear();
        let byte = env::storage_byte_cost().as_yoctonear();
        let refund = if after >= before {
            let cost = u128::from(after - before) * byte;
            require!(
                attached >= cost,
                format!("attach at least {cost} yoctoNEAR for storage")
            );
            attached - cost
        } else {
            attached + u128::from(before - after) * byte
        };
        if refund > 0 {
            Promise::new(payer.clone())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }
}

fn ok(r: Result<(), &'static str>) {
    if let Err(msg) = r {
        env::panic_str(msg);
    }
}

/// Panic with a refusal in the shared `<code>: <hint>` form.
pub(crate) fn refuse(r: Refusal) -> ! {
    env::panic_str(&format!("{}: {}", r.code(), r.hint()))
}
