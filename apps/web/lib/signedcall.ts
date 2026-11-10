/**
 * PR 11c (E-021): a lease held by a 0x address, called from a page where another NEAR wallet is
 * connected. MetaMask (the page's injected EIP-1193 provider) signs only the text the contract's
 * `signed_call_message` view returns, as EIP-191 `personal_sign`; the connected NEAR wallet sends
 * `use_lease_signed` and pays. The contract derives the holder from the signature. No key and no relayer
 * are in the browser: the page never builds the signed text and never sees a private key.
 */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { callBlocked, isEvmHolder, type TestCallArgs } from "./holdercall.ts";
import type { LeaseView } from "./lease-view.ts";
import { CALL_DEPOSIT } from "./testkey.ts";

const TGAS = 1_000_000_000_000n;

/** How long a signature stays valid: the SDK's default, time for the MetaMask and the NEAR wallet prompt. */
export const SIGNATURE_TTL_MS = 5 * 60_000;

/** The part of an EIP-1193 provider (`window.ethereum`) this page uses. */
export interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** MetaMask's provider on this page (its in-app browser or the extension), or null. */
export function injectedEthereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const e = (window as { ethereum?: Partial<Eip1193> }).ethereum;
  return e && typeof e.request === "function" ? (e as Eip1193) : null;
}

/**
 * Whether this wallet can send a call that the lease's 0x holder signs in MetaMask: another account is
 * connected, the holder is an EVM address, and the lease itself takes calls.
 */
export function canSignInMetaMask(lease: LeaseView, account: string | null): boolean {
  return (
    account !== null &&
    account !== lease.grantee &&
    isEvmHolder(lease.grantee) &&
    callBlocked(lease, lease.grantee) === null
  );
}

/** A reason to stop before anything is sent; the page shows its text as it is. */
export class SignedCallStop extends Error {}

/** UTF-8 bytes as 0x hex: the message form `personal_sign` takes, so the wallet shows the plain text. */
export function utf8Hex(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface Signed {
  readonly holder: string;
  readonly nonce: string;
  readonly validUntilMs: string;
  readonly signature: string;
}

/** Contract views, bound to this page's RPC and contract. */
export type ViewFn = <T>(method: string, args: object) => Promise<T>;

/**
 * Ask MetaMask to sign one test call: its account must map to the lease's holder (the contract's own
 * mapping), the nonce is the lease's `last_nonce` + 1, and the text comes from `signed_call_message`.
 * Throws `SignedCallStop` before anything is signed or sent when one of these does not hold.
 */
export async function signInMetaMask(
  eth: Eip1193,
  views: ViewFn,
  args: TestCallArgs,
  now: () => number = Date.now,
): Promise<Signed> {
  const accounts = await eth.request({ method: "eth_requestAccounts" }).catch((e: unknown) => {
    throw declined(e) ?? e;
  });
  const address: unknown = Array.isArray(accounts) ? (accounts as unknown[])[0] : undefined;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(address))
    throw new SignedCallStop("MetaMask gave no account; unlock it and try again.");
  const [holder, lease] = await Promise.all([
    views<string>("evm_holder_account", { address }),
    views<{ grantee: string; last_nonce?: string } | null>("get_lease", { lease_id: args.lease_id }),
  ]);
  if (lease === null) throw new SignedCallStop("No lease has this id; check the lease id you were given.");
  if (holder !== lease.grantee)
    throw new SignedCallStop(
      `The MetaMask account ${holder} does not hold this lease; switch to ${lease.grantee} in MetaMask.`,
    );
  if (lease.last_nonce === undefined)
    throw new SignedCallStop("This contract predates signed calls; the holder calls with its own wallet.");
  const nonce = (BigInt(lease.last_nonce) + 1n).toString();
  const validUntilMs = String(now() + SIGNATURE_TTL_MS);
  // The signed text comes only from the contract; the page never builds it.
  const text = await views<string>("signed_call_message", {
    lease_id: args.lease_id,
    nonce,
    valid_until_ms: validUntilMs,
    method: args.method,
    endpoint: args.endpoint,
    ...(args.body === undefined ? {} : { body: args.body }),
  });
  const signature = await eth
    .request({ method: "personal_sign", params: [utf8Hex(text), address] })
    .catch((e: unknown) => {
      throw declined(e) ?? e;
    });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(signature))
    throw new SignedCallStop("MetaMask returned no usable signature; nothing was sent.");
  return { holder, nonce, validUntilMs, signature: signature.toLowerCase() };
}

/** EIP-1193 code 4001: the user said no in MetaMask. */
function declined(e: unknown): SignedCallStop | null {
  return (e as { code?: unknown } | null)?.code === 4001
    ? new SignedCallStop("MetaMask declined; nothing was signed or sent.")
    : null;
}

/** `use_lease_signed` with the holder's signature; the connected wallet sends it and pays the deposit. */
export function signedCallTx(contractId: string, args: TestCallArgs, signed: Signed): Tx {
  return {
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "use_lease_signed",
        {
          ...args,
          nonce: signed.nonce,
          valid_until_ms: signed.validUntilMs,
          signer: { Evm: { signature: signed.signature } },
        },
        300n * TGAS,
        CALL_DEPOSIT,
      ),
    ],
  };
}
