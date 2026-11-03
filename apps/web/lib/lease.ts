/** Lease transactions (same contract calls as `kl lease`). */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";

const TGAS = 1_000_000_000_000n;
/** Covers the lease's storage; the contract refunds what it does not use. */
export const LEASE_DEPOSIT = 50_000_000_000_000_000_000_000n; // 0.05 NEAR

export function leaseTx(
  contractId: string,
  keyId: string,
  grantee: string,
  calls: number,
  expiresAt: bigint,
  endpoints: readonly string[],
): Tx {
  return {
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "create_lease",
        { key_id: keyId, grantee, calls, expires_at: expiresAt.toString(), endpoints: [...endpoints] },
        50n * TGAS,
        LEASE_DEPOSIT,
      ),
    ],
  };
}
