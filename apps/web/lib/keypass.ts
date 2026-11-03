/** Key Pass (NEP-171, E-019): every lease is a token held by its grantee; the holder can move it. */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { ACCOUNT } from "./presets.ts";

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
  if (!ACCOUNT.test(receiver) || !receiver.endsWith(".testnet"))
    return "The new holder must be a .testnet account";
  if (receiver === holder) return "This account already holds the lease";
  return null;
}

/** The contract's sentence for a lease created without `transferable`, made plain. */
export const NOT_TRANSFERABLE = "this Key Pass is not transferable";
export const NOT_TRANSFERABLE_TEXT = `${NOT_TRANSFERABLE}: the key owner did not allow transfers for this lease.`;
