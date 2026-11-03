//! Stable refusal codes for KeyLease.
//!
//! One source of truth for the reason a call is refused. The contract, the proxy, the SDK and the
//! web app all show the same `code` and the same one-sentence `hint`. The table in
//! `docs/WORDING.md` must match this file; a test enforces it.

#![no_std]

/// Why a leased call was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Refusal {
    /// The lease expiry time has passed.
    LeaseExpired,
    /// The lease has no calls left.
    QuotaUsed,
    /// The requested endpoint path is not in the lease.
    EndpointNotInLease,
    /// The lease owner revoked the lease.
    LeaseRevoked,
    /// The caller does not hold the lease.
    NotLeaseHolder,
    /// The request or response matched a key-exfiltration pattern.
    Tripwire,
    /// A parent lease in the sub-lease chain was revoked.
    ParentRevoked,
    /// A parent lease in the sub-lease chain has no calls left.
    ParentQuotaUsed,
    /// No lease has this id.
    LeaseNotFound,
}

impl Refusal {
    /// Every refusal, in display order.
    pub const ALL: [Refusal; 9] = [
        Refusal::LeaseExpired,
        Refusal::QuotaUsed,
        Refusal::EndpointNotInLease,
        Refusal::LeaseRevoked,
        Refusal::NotLeaseHolder,
        Refusal::Tripwire,
        Refusal::ParentRevoked,
        Refusal::ParentQuotaUsed,
        Refusal::LeaseNotFound,
    ];

    /// Machine-readable code, stable across releases. Lowercase `snake_case`.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Refusal::LeaseExpired => "lease_expired",
            Refusal::QuotaUsed => "quota_used",
            Refusal::EndpointNotInLease => "endpoint_not_in_lease",
            Refusal::LeaseRevoked => "lease_revoked",
            Refusal::NotLeaseHolder => "not_lease_holder",
            Refusal::Tripwire => "tripwire",
            Refusal::ParentRevoked => "parent_revoked",
            Refusal::ParentQuotaUsed => "parent_quota_used",
            Refusal::LeaseNotFound => "lease_not_found",
        }
    }

    /// One sentence telling the agent or human what to do next.
    #[must_use]
    pub const fn hint(self) -> &'static str {
        match self {
            Refusal::LeaseExpired => "This lease has expired; ask the key owner for a new lease.",
            Refusal::QuotaUsed => "All calls in this lease are used; ask the key owner for more calls.",
            Refusal::EndpointNotInLease => {
                "This endpoint is not in the lease; call one of the listed endpoints or ask for a wider lease."
            }
            Refusal::LeaseRevoked => "The key owner revoked this lease; ask them for a new one.",
            Refusal::NotLeaseHolder => {
                "Your account does not hold this lease; use the wallet or agent the lease was shared with."
            }
            Refusal::Tripwire => {
                "The call looked like an attempt to read the key, so it was stopped and recorded on chain."
            }
            Refusal::ParentRevoked => {
                "A lease above this one was revoked; ask the agent that shared it with you for a new lease."
            }
            Refusal::ParentQuotaUsed => {
                "A lease above this one has no calls left; ask the agent that shared it with you."
            }
            Refusal::LeaseNotFound => "No lease has this id; check the lease id you were given.",
        }
    }

    /// Parse a code back into a refusal.
    #[must_use]
    pub fn from_code(code: &str) -> Option<Refusal> {
        Refusal::ALL.into_iter().find(|r| r.code() == code)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::Refusal;
    use std::collections::BTreeSet;
    use std::string::String;
    use std::vec::Vec;

    #[test]
    fn codes_are_unique_snake_case_and_round_trip() {
        let mut seen = BTreeSet::new();
        for r in Refusal::ALL {
            let c = r.code();
            assert!(seen.insert(c), "duplicate code {c}");
            assert!(
                c.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{c} not snake_case"
            );
            assert_eq!(Refusal::from_code(c), Some(r));
        }
        assert_eq!(Refusal::from_code("unknown"), None);
    }

    #[test]
    fn hints_are_one_sentence() {
        for r in Refusal::ALL {
            let h = r.hint();
            assert!(h.ends_with('.'), "{h}");
            assert_eq!(h.matches(". ").count(), 0, "more than one sentence: {h}");
            assert!(h.len() <= 120, "hint too long: {h}");
        }
    }

    /// docs/WORDING.md lists every code with the exact hint. Keeps docs and code in step.
    #[test]
    fn wording_doc_matches_code() {
        let doc = include_str!("../../../docs/WORDING.md");
        let rows: Vec<(String, String)> = doc
            .lines()
            .filter_map(|l| {
                let cells: Vec<&str> = l.split('|').map(str::trim).collect();
                let code = cells.get(1)?.strip_prefix('`')?.strip_suffix('`')?;
                Some((String::from(code), String::from(*cells.get(2)?)))
            })
            .collect();
        assert_eq!(rows.len(), Refusal::ALL.len(), "WORDING.md refusal table size");
        for (r, (code, hint)) in Refusal::ALL.iter().zip(rows.iter()) {
            assert_eq!(r.code(), code);
            assert_eq!(r.hint(), hint);
        }
    }
}
