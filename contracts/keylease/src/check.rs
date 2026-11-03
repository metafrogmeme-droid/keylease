//! The gate every call passes. Pure, so every refusal is unit-tested without a chain.
use crate::{KeyRecord, Lease};
use keylease_reasons::Refusal;
use near_sdk::AccountId;

/// Decide whether `caller` may use one call of `lease` on `endpoint` at `now` (block time, ns).
///
/// Order matters: a caller who does not hold the lease learns nothing else about it.
///
/// # Errors
/// The first [`Refusal`] that applies.
pub fn check(
    lease: Option<&Lease>,
    key: Option<&KeyRecord>,
    owner_epoch: u32,
    caller: &AccountId,
    endpoint: &str,
    now: u64,
) -> Result<(), Refusal> {
    let lease = lease.ok_or(Refusal::LeaseNotFound)?;
    if &lease.grantee != caller {
        return Err(Refusal::NotLeaseHolder);
    }
    let key_live = key.is_some_and(|k| k.revoke_epoch == lease.key_epoch);
    if lease.revoked || !key_live || owner_epoch != lease.owner_epoch {
        return Err(Refusal::LeaseRevoked);
    }
    if now >= lease.expires_at {
        return Err(Refusal::LeaseExpired);
    }
    if !lease.endpoints.iter().any(|e| e == endpoint) {
        return Err(Refusal::EndpointNotInLease);
    }
    if lease.calls_used >= lease.calls_total {
        return Err(Refusal::QuotaUsed);
    }
    Ok(())
}
