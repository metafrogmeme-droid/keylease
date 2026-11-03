# @keylease/sdk

Make API calls with a KeyLease lease on NEAR testnet. You hold a lease id; the key stays sealed in
OutLayer's TEE and never reaches your code.

```ts
import { lease } from "@keylease/sdk";

// Signs as the lease holder: NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY come from env, never from code.
const l = lease({ contract: "keylease.<owner>.testnet", leaseId: "7" });
const { data, receipt } = await l.call("/chat/completions", {
  model: "…",
  messages: [{ role: "user", content: "Hi" }],
});
console.log(data, receipt.url);

await l.check("/chat/completions"); // { ok, reason, hint }: free, no transaction
await l.status(); // calls used and left, expiry, endpoints, status
```

Hand on part of a lease, or move it (you must hold it; the key owner's limits only shrink):

```ts
// 2 of your calls, on one endpoint, for 30 minutes: never more than this lease has left, never longer.
const { leaseId, receipt } = await l.subLease({
  grantee: "helper.testnet",
  calls: 2,
  endpoints: ["/chat/completions"],
  expiresAt: new Date(Date.now() + 30 * 60_000),
});
await l.subLeases(); // the sub-leases handed on from this lease
await l.transfer("bob.testnet"); // the Key Pass (NEP-171): bob holds the lease now, you are refused
await l.keyPass(); // { token_id, owner_id, metadata }
```

- `subLease` checks the limits against `l.status()` first (free) and throws before any transaction: calls
  at most what is left, `expiresAt` no later than this lease, endpoints a subset, at most 3 levels deep. The
  contract checks again, including every lease further up (`parent_quota_used`, `parent_revoked`).
  Revoking a lease refuses every sub-lease below it in the same call. Storage: 0.05 NEAR attached, the rest
  refunded.
- `transfer` attaches exactly 1 yoctoNEAR. It works only when the key owner made the lease transferable;
  otherwise it throws `KeyLeaseError` `transfer_refused` with the contract's sentence. Sub-leases are never
  transferable.
- Each call attaches 0.025 NEAR; OutLayer refunds unused compute to the caller.
- A refused call throws `KeyLeaseError` with `code` and `hint` from docs/WORDING.md (for example
  `endpoint_not_in_lease`, `quota_used`, `lease_revoked`, `tripwire`) and a `receipt` with the transaction link.
  A refused `subLease` or `transfer` that the contract explains in a plain sentence has the code
  `sub_lease_refused` or `transfer_refused`, with that sentence as `hint`.
- `leaseFromEnv()` reads `KEYLEASE_CONTRACT_ID` and `KEYLEASE_LEASE_ID` as well (used by `@keylease/mcp`).
- Testnet only: the contract and the signing account must be `.testnet` accounts, and the RPC must answer as
  testnet.
- `attestation` is `null` until the Verify work (PR 12).
