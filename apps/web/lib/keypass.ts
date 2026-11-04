/** Key Pass (NEP-171, E-019): every lease is a token held by its grantee; the holder can move it. */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { parseTestnetAccount } from "./account.ts";

const TGAS = 1_000_000_000_000n;

/** `nft_transfer` of the lease's Key Pass: exactly 1 yoctoNEAR, as NEP-171 requires. */
export function transferTx(contractId: string, leaseId: string, receiver: string): Tx {
  return {
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "nft_transfer",
        { receiver_id: receiver, token_id: leaseId },
        30n * TGAS,
        1n,
      ),
    ],
  };
}

/** What is wrong with the new holder, or null. The contract checks the same. */
export function receiverProblem(receiver: string, holder: string): string | null {
  const r = parseTestnetAccount(receiver);
  if ("error" in r) return `New holder: ${r.error}`;
  if (r.id === holder) return "This account already holds the lease";
  return null;
}

/** The new holder as the transfer sends it: trimmed, an EVM address lowercased. */
export function receiverId(raw: string): string {
  const r = parseTestnetAccount(raw);
  return "id" in r ? r.id : raw.trim();
}

/** The contract's sentence for a lease created without `transferable`, made plain. */
export const NOT_TRANSFERABLE = "this Key Pass is not transferable";
export const NOT_TRANSFERABLE_TEXT = `${NOT_TRANSFERABLE}: the key owner did not allow transfers for this lease.`;
