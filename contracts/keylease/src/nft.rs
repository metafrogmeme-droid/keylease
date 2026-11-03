//! Key Pass: every lease is an NEP-171 token (`token_id` = lease id, `owner_id` = the lease's grantee).
//! Whoever holds the token holds the lease: `nft_transfer` re-points the lease, so the old holder's next
//! call is refused with `not_lease_holder`. Only leases the key owner created `transferable` move.
//! NEP-171 core, NEP-177 metadata, NEP-181 enumeration; no approvals (NEP-178).
use crate::{events, refuse, KeyLease, KeyLeaseExt, Lease, Refusal, StorageKey};
use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseOrValue};
use std::collections::HashMap;

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(15);
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(30);
const MAX_PAGE: u64 = 100;

/// NEP-177 contract metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// NEP-177 token metadata: what the lease allows, in words.
#[near(serializers = [json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    /// Unix ms.
    pub issued_at: Option<String>,
    /// Unix ms.
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// NEP-171 token.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
    pub approved_account_ids: HashMap<AccountId, u64>,
}

/// The receiver side of `nft_transfer_call` (NEP-171); only its generated `ext_nft_receiver` is used.
#[allow(dead_code)]
#[ext_contract(ext_nft_receiver)]
pub trait NonFungibleTokenReceiver {
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> PromiseOrValue<bool>;
}

fn lease_id(token_id: &str) -> Option<u64> {
    token_id
        .parse()
        .ok()
        .filter(|_| token_id.bytes().all(|b| b.is_ascii_digit()))
}

fn ms(ns: u64) -> String {
    (ns / 1_000_000).to_string()
}

fn token(id: u64, l: &Lease) -> Token {
    Token {
        token_id: id.to_string(),
        owner_id: l.grantee.clone(),
        metadata: TokenMetadata {
            title: Some(format!("Key Pass {id}")),
            description: Some(format!(
                "KeyLease lease {id} on key {}: {} calls on {} until {} (Unix ms). Holds calls, never the key.",
                l.key_id,
                l.calls_total,
                l.endpoints.join(" "),
                ms(l.expires_at),
            )),
            issued_at: Some(ms(l.created_at)),
            expires_at: Some(ms(l.expires_at)),
            ..TokenMetadata::default()
        },
        approved_account_ids: HashMap::new(),
    }
}

impl KeyLease {
    /// Move the lease to `receiver`; returns the previous holder.
    fn transfer_internal(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_id: &str,
        approval_id: Option<u32>,
        memo: Option<&str>,
    ) -> AccountId {
        require!(approval_id.is_none(), "approvals are not supported");
        let id = lease_id(token_id).unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        let lease = self
            .leases
            .get(&id)
            .unwrap_or_else(|| refuse(Refusal::LeaseNotFound));
        if &lease.grantee != sender {
            refuse(Refusal::NotLeaseHolder);
        }
        require!(lease.transferable, "this Key Pass is not transferable");
        require!(receiver != sender, "the receiver already holds this Key Pass");
        if self.revoked(lease) {
            refuse(Refusal::LeaseRevoked);
        }
        self.move_lease(id, sender, receiver);
        events::nft_transfer(id, sender, receiver, memo);
        sender.clone()
    }

    fn move_lease(&mut self, id: u64, from: &AccountId, to: &AccountId) {
        if let Some(l) = self.leases.get_mut(&id) {
            l.grantee = to.clone();
        }
        Self::unindex(&mut self.leases_by_grantee, from, id);
        Self::index(&mut self.leases_by_grantee, to, id, |h| {
            StorageKey::LeasesByGranteeSet { grantee: h }
        });
        self.flush_all();
    }

    /// Revoked one by one, by `revoke_all` on its key, or by the owner's panic button.
    pub(crate) fn revoked(&self, l: &Lease) -> bool {
        let key_live = self
            .keys
            .get(&l.key_id)
            .is_some_and(|k| k.revoke_epoch == l.key_epoch);
        l.revoked || !key_live || self.owner_epoch(&l.owner) != l.owner_epoch
    }
}

#[near]
impl KeyLease {
    /// NEP-171. Holder only, exactly 1 yoctoNEAR, transferable leases only. The lease follows the token.
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u32>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.transfer_internal(&sender, &receiver_id, &token_id, approval_id, memo.as_deref());
    }

    /// NEP-171 transfer with a call to the receiver's `nft_on_transfer`; it gets the Key Pass back if
    /// the receiver returns true or fails.
    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u32>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        let previous = self.transfer_internal(&sender, &receiver_id, &token_id, approval_id, memo.as_deref());
        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_ON_TRANSFER)
            .nft_on_transfer(sender, previous.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .nft_resolve_transfer(previous, receiver_id, token_id, None),
            )
            .into()
    }

    /// NEP-171 resolve: true when the receiver keeps the Key Pass.
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        owner_id: AccountId,
        receiver_id: AccountId,
        token_id: String,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let _ = approved_account_ids;
        // NEP-171: give the Key Pass back when the receiver says true, fails, or answers nonsense.
        let give_back = env::promise_result_checked(0, 16).map_or(true, |v| {
            near_sdk::serde_json::from_slice::<bool>(&v).unwrap_or(true)
        });
        let Some(id) = lease_id(&token_id) else {
            return true;
        };
        // The receiver keeps it unless it asked to give it back and still holds it.
        let held_by_receiver = self.leases.get(&id).is_some_and(|l| l.grantee == receiver_id);
        if !give_back || !held_by_receiver {
            return !give_back;
        }
        self.move_lease(id, &receiver_id, &owner_id);
        events::nft_transfer(id, &receiver_id, &owner_id, None);
        false
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let id = lease_id(&token_id)?;
        self.leases.get(&id).map(|l| token(id, l))
    }

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "KeyLease Key Pass".into(),
            symbol: "KEYPASS".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    /// NEP-181. Leases are never deleted, so the supply is the number created.
    pub fn nft_total_supply(&self) -> U128 {
        U128(u128::from(self.next_lease_id))
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = u64::try_from(from_index.map_or(0, |f| f.0)).unwrap_or(u64::MAX);
        let take = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
        (from..self.next_lease_id)
            .filter_map(|id| self.leases.get(&id).map(|l| token(id, l)))
            .take(usize::try_from(take).unwrap_or(0))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(
            self.leases_by_grantee
                .get(&account_id)
                .map_or(0, |s| u128::from(s.len())),
        )
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let from = usize::try_from(from_index.map_or(0, |f| f.0)).unwrap_or(usize::MAX);
        let take = usize::try_from(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)).unwrap_or(0);
        self.leases_by_grantee
            .get(&account_id)
            .map_or_else(Vec::new, |set| {
                set.iter()
                    .skip(from)
                    .take(take)
                    .filter_map(|id| self.leases.get(id).map(|l| token(*id, l)))
                    .collect()
            })
    }
}
