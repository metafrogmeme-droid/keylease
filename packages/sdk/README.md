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

- Each call attaches 0.025 NEAR; OutLayer refunds unused compute to the caller.
- A refused call throws `KeyLeaseError` with `code` and `hint` from docs/WORDING.md (for example
  `endpoint_not_in_lease`, `quota_used`, `lease_revoked`, `tripwire`) and a `receipt` with the transaction link.
- `leaseFromEnv()` reads `KEYLEASE_CONTRACT_ID` and `KEYLEASE_LEASE_ID` as well (used by `@keylease/mcp`).
- Testnet only: the contract and the signing account must be `.testnet` accounts, and the RPC must answer as
  testnet.
- `attestation` is `null` until the Verify work (PR 12).
