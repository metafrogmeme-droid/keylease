/** Receipts, revoke transactions and plain status lines for the owner's lease list (brief §4). */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { PROXY_ERRORS, REFUSALS } from "./wording.ts";

const TGAS = 1_000_000_000_000n;

/** On-chain record of one call (contracts/keylease/src/run.rs `Receipt`). */
export interface Receipt {
  readonly lease_id: string;
  readonly call: number;
  readonly caller: string;
  readonly endpoint: string;
  readonly method: string;
  readonly input_sha256: string;
  readonly output_sha256: string | null;
  readonly outcome: "ok" | "refused" | "tripwire" | "error" | "failed";
  readonly code: string | null;
  readonly http_status: number | null;
  readonly at: string;
}

/** ✓ or ✗ and one short reason. */
export function outcomeText(r: Receipt): { ok: boolean; text: string } {
  switch (r.outcome) {
    case "ok": {
      const s = r.http_status ?? 0;
      return { ok: s >= 200 && s < 300, text: `HTTP ${String(s)}` };
    }
    case "failed":
      return { ok: false, text: "no answer from OutLayer (run failed or timed out)" };
    default: {
      const code = r.code ?? r.outcome;
      const hint = REFUSALS[code] ?? PROXY_ERRORS[code];
      return { ok: false, text: hint ? `${code}: ${hint}` : code };
    }
  }
}

function call(contractId: string, method: string, args: object): Tx {
  return { receiverId: contractId, actions: [actionCreators.functionCall(method, args, 30n * TGAS, 0n)] };
}

/** One-click revoke: the next call on this lease is refused with `lease_revoked`. */
export const revokeTx = (contractId: string, leaseId: string) =>
  call(contractId, "revoke", { lease_id: leaseId });

/** Revoke every lease on one key (one O(1) epoch bump). */
export const revokeAllTx = (contractId: string, keyId: string) =>
  call(contractId, "revoke_all", { key_id: keyId });

/** Panic button: revoke every lease of the signing owner, on every key, in one transaction. */
export const revokeEverythingTx = (contractId: string) => call(contractId, "revoke_all_owner", {});
