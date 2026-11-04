/**
 * `lease({ contract, leaseId })` → `l.call(endpoint, body)`. The holder of a lease makes API calls through
 * the KeyLease contract and OutLayer's TEE; it never sees the key. Refusals throw `KeyLeaseError` with the
 * code and the sentence from docs/WORDING.md. The holder can also hand on part of the lease
 * (`l.subLease`, E-020) and move it to another account (`l.transfer`, the Key Pass, E-019).
 */
import { parseTestnetAccount } from "./account.ts";
import { nearTransport } from "./near.ts";
import type { HolderSigner } from "./signer.ts";
import { TxFailed, type Transport } from "./transport.ts";
import { PROXY_ERRORS, REFUSALS } from "./wording.ts";

/** Attached to each call: OutLayer's compute deposit plus the receipt; unused compute is refunded. */
export const CALL_DEPOSIT = 25_000_000_000_000_000_000_000n; // 0.025 NEAR
const CALL_TGAS = 300;
/** Attached to `create_sub_lease` for the new lease's storage; the contract refunds what it does not use. */
export const SUB_LEASE_DEPOSIT = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
const SMALL_TGAS = 30;
/** How long a holder's signature stays valid by default (signed calls, E-021). */
export const SIGNATURE_TTL_MS = 5 * 60_000;
const MAX_SIGNATURE_TTL_MS = 60 * 60_000;
/** Sub-leases go at most this many levels below a key owner's lease (contract `MAX_DEPTH`). */
export const MAX_SUB_LEASE_DEPTH = 3;

export interface LeaseOptions {
  /** The KeyLease contract, a `.testnet` account. */
  readonly contract: string;
  readonly leaseId: string;
  /** Signing account; default env NEAR_ACCOUNT_ID. */
  readonly account?: string;
  /** `ed25519:…`; default env NEAR_PRIVATE_KEY. Never printed. */
  readonly privateKey?: string;
  /** Default env NEAR_RPC_URL, else https://rpc.testnet.near.org. */
  readonly rpc?: string;
  /** Instead of account/privateKey/rpc: a custom signer (tests, wallets). */
  readonly transport?: Transport;
  /** Clock in Unix ms, for the expiry checks (tests). Default `Date.now`. */
  readonly now?: () => number;
  /**
   * The lease is held by an EVM address or a Solana key (E-021): this signer signs each call and a relayer
   * account sends it. The relayer is `transport`, or KEYLEASE_RELAYER_ACCOUNT_ID and
   * KEYLEASE_RELAYER_PRIVATE_KEY from env (a throwaway testnet key, never printed).
   */
  readonly signer?: HolderSigner;
  /** How long each signature stays valid, 1 s to 1 h. Default 5 minutes. */
  readonly signatureTtlMs?: number;
}

export interface CallOptions {
  /** Default POST; GET sends no body. */
  readonly method?: "GET" | "POST";
  /** Override the 0.025 NEAR deposit. */
  readonly deposit?: bigint;
}

export interface Receipt {
  readonly leaseId: string;
  /** Call number on this lease (1-based), from the contract's `call_authorized` event. */
  readonly call: number | null;
  readonly tx: string;
  readonly url: string;
}

export interface CallResult {
  /** Upstream HTTP status (the proxy reached the API). */
  readonly status: number;
  /** The API's answer: parsed JSON when it is JSON, else text (base64 when not UTF-8). */
  readonly data: unknown;
  /** True when the proxy redacted a bearer-like token from the answer. */
  readonly redacted: boolean;
  readonly bodySha256: string;
  readonly receipt: Receipt;
  /** OutLayer TEE attestation for the run; filled by the Verify work (PR 12). */
  readonly attestation: null;
}

/** A call that did not run, or whose answer was withheld. `code` is from docs/WORDING.md. */
export class KeyLeaseError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly receipt: Receipt | null;
  constructor(code: string, hint: string, receipt: Receipt | null) {
    super(`${code}: ${hint}`);
    this.name = "KeyLeaseError";
    this.code = code;
    this.hint = hint;
    this.receipt = receipt;
  }
}

/** The contract's `get_lease` view. */
export interface LeaseStatus {
  readonly lease_id: string;
  readonly key_id: string;
  /** The key owner. */
  readonly owner: string;
  /** The holder: the account that may call, sub-lease and transfer it. */
  readonly grantee: string;
  readonly calls_total: number;
  readonly calls_used: number;
  readonly calls_left: number;
  /** Unix nanoseconds, as a string. */
  readonly expires_at: string;
  readonly endpoints: string[];
  readonly status: "active" | "revoked" | "expired" | "used_up";
  readonly created_at: string;
  /** The lease this one was handed on from; null for a key owner's lease. */
  readonly parent: string | null;
  /** 0 for a key owner's lease, 1-3 for sub-leases. */
  readonly depth: number;
  /** Who created it: the key owner, or the holder of the parent lease. */
  readonly issuer: string;
  /** Highest nonce a signed call used; the next signed call uses this + 1. */
  readonly last_nonce: string;
}

export interface SubLeaseOptions {
  /** Who gets the sub-lease; a `.testnet` account. */
  readonly grantee: string;
  /** Calls it may make: at least 1, at most what the lease above has left. */
  readonly calls: number;
  /** When it ends: a Date or Unix ms, no later than this lease. Default: this lease's expiry. */
  readonly expiresAt?: Date | number;
  /** A subset of this lease's endpoints. Default: all of them. */
  readonly endpoints?: readonly string[];
  /** Storage deposit, refunded where unused. Default 0.05 NEAR. */
  readonly deposit?: bigint;
}

export interface TxReceipt {
  readonly tx: string;
  readonly url: string;
}

export interface SubLease {
  readonly leaseId: string;
  /** The new lease, on the same contract. Its holder is the grantee: sign as them to call it. */
  readonly lease: Lease;
  readonly receipt: TxReceipt;
}

/** The lease as a NEP-171 token (`nft_token`): `owner_id` is the holder. */
export interface KeyPass {
  readonly token_id: string;
  readonly owner_id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Lease {
  readonly contract: string;
  readonly leaseId: string;
  call(endpoint: string, body?: unknown, opts?: CallOptions): Promise<CallResult>;
  /** Would a call on `endpoint` pass right now? Free (a view). */
  check(endpoint: string): Promise<{ ok: boolean; reason: string | null; hint: string | null }>;
  status(): Promise<LeaseStatus | null>;
  /**
   * Hand on part of this lease (you must hold it). Limits only shrink: no more calls than are left, no
   * later expiry, a subset of the endpoints, at most 3 levels deep. Revoking this lease also refuses every
   * sub-lease below it. Checked here first (free), then by the contract.
   */
  subLease(o: SubLeaseOptions): Promise<SubLease>;
  /** The sub-leases handed on from this lease (one level). Free (a view). */
  subLeases(): Promise<LeaseStatus[]>;
  /**
   * Move this lease to `receiverId` (NEP-171 `nft_transfer`, 1 yoctoNEAR). Only the holder can, and only
   * when the key owner made it transferable. Afterwards this signer is refused `not_lease_holder`.
   */
  transfer(receiverId: string, opts?: { readonly memo?: string }): Promise<TxReceipt>;
  /** The lease's Key Pass token, or null. Free (a view). */
  keyPass(): Promise<KeyPass | null>;
}

export const explorer = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;

/** The call number from KeyLease's `call_authorized` event. */
export function callNumber(logs: readonly string[]): number | null {
  for (const log of logs) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    try {
      const ev = JSON.parse(log.slice("EVENT_JSON:".length)) as {
        standard?: string;
        event?: string;
        data?: { call?: number }[];
      };
      if (ev.standard === "keylease" && ev.event === "call_authorized") return ev.data?.[0]?.call ?? null;
    } catch {
      // not ours
    }
  }
  return null;
}

/** `<code>: <hint>` from a contract panic in a failure text. */
export function refusalIn(text: string): { code: string; hint: string } | null {
  const m = /panicked: ([a-z_]+): ([^"\\]+)/u.exec(text);
  return m?.[1] ? { code: m[1], hint: (m[2] ?? "").trim() } : null;
}

/** The contract's plain panic sentence (`require!`) from a failure text. */
export function panicIn(text: string): string | null {
  const m = /panicked: ([^"\\]+)/u.exec(text);
  return m?.[1] ? m[1].trim() : null;
}

/** A failed transaction as a KeyLeaseError: the refusal code if there is one, else `fallback` + the sentence. */
function failed(e: TxFailed, leaseId: string, fallback: string): KeyLeaseError {
  const receipt = { leaseId, call: null, tx: e.hash, url: explorer(e.hash) };
  const r = refusalIn(e.text);
  if (r) return new KeyLeaseError(r.code, r.hint, receipt);
  return new KeyLeaseError(fallback, panicIn(e.text) ?? e.text.slice(0, 300), receipt);
}

const STATUS_CODE: Readonly<Record<string, string>> = {
  revoked: "lease_revoked",
  expired: "lease_expired",
  used_up: "quota_used",
};

/** Refuse as the contract would when `me` cannot act on this lease (free: from the view, no transaction). */
function mustHold(l: LeaseStatus | null, me: string): LeaseStatus {
  const refuse = (code: string) => new KeyLeaseError(code, REFUSALS[code] ?? "", null);
  if (l === null) throw refuse("lease_not_found");
  if (l.grantee !== me) throw refuse("not_lease_holder");
  const code = STATUS_CODE[l.status];
  if (code) throw refuse(code);
  return l;
}

/** A grantee or receiver by the shared rule (name.testnet, 0x + 40 hex, 64 hex), normalised. */
function testnetAccount(id: string, what: string): string {
  const r = parseTestnetAccount(id);
  if ("error" in r) throw new Error(`KeyLease SDK: ${what}: ${r.error}`);
  return r.id;
}

const msToNs = (ms: number) => (BigInt(Math.trunc(ms)) * 1_000_000n).toString();

function decodeBody(body: string, encoding: unknown): unknown {
  if (encoding !== "utf8") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function env(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process.env[name];
}

export function lease(o: LeaseOptions): Lease {
  if (!o.contract.endsWith(".testnet"))
    throw new Error("KeyLease SDK: contract must be a .testnet account (testnet only)");
  if (!/^\d{1,20}$/u.test(o.leaseId)) throw new Error('KeyLease SDK: leaseId must be a number like "7"');
  const ttl = o.signatureTtlMs ?? SIGNATURE_TTL_MS;
  if (o.signer && !(Number.isInteger(ttl) && ttl >= 1000 && ttl <= MAX_SIGNATURE_TTL_MS))
    throw new Error("KeyLease SDK: signatureTtlMs must be 1000 to 3600000 (1 s to 1 h)");
  let transport: Promise<Transport> | null = o.transport ? Promise.resolve(o.transport) : null;
  const t = () => {
    transport ??= (() => {
      // With a holder signer the NEAR account only relays: its own env names make that plain.
      const [accountVar, keyVar] = o.signer
        ? ["KEYLEASE_RELAYER_ACCOUNT_ID", "KEYLEASE_RELAYER_PRIVATE_KEY"]
        : ["NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY"];
      const account = o.account ?? env(accountVar);
      const privateKey = o.privateKey ?? env(keyVar);
      if (!account || !privateKey)
        throw new Error(`KeyLease SDK: set ${accountVar} and ${keyVar} (env only)`);
      const rpc = o.rpc ?? env("NEAR_RPC_URL");
      return nearTransport({ account, privateKey, ...(rpc ? { rpc } : {}) });
    })();
    return transport;
  };

  /** The holder account the signer's key maps to, as the contract maps it (lowercase 0x…, base58 → hex). */
  let holderId: Promise<string> | null = null;
  const holder = async (tr: Transport): Promise<string> => {
    const sg = o.signer;
    if (!sg) return tr.account;
    holderId ??= tr.view<string>(
      o.contract,
      sg.kind === "evm" ? "evm_holder_account" : "solana_holder_account",
      { address: sg.address },
    );
    return holderId;
  };
  const notForSigners = () => {
    if (o.signer)
      throw new Error(
        "KeyLease SDK: sub-leases and transfers need the holder's own NEAR account; a signer can only call",
      );
  };

  /** One signed call: the contract's own text, signed by the holder, sent by the relayer. */
  async function sendSigned(
    tr: Transport,
    sg: HolderSigner,
    args: { lease_id: string; endpoint: string; method: string; body?: string },
    deposit: bigint,
  ) {
    const l = mustHold(
      await tr.view<LeaseStatus | null>(o.contract, "get_lease", { lease_id: o.leaseId }),
      await holder(tr),
    );
    const nonce = (BigInt(l.last_nonce) + 1n).toString();
    const validUntil = String((o.now ?? Date.now)() + ttl);
    // The signed text comes only from the contract; the SDK never builds it.
    const text = await tr.view<string>(o.contract, "signed_call_message", {
      lease_id: o.leaseId,
      nonce,
      valid_until_ms: validUntil,
      method: args.method,
      endpoint: args.endpoint,
      ...(args.body === undefined ? {} : { body: args.body }),
    });
    const signature = await sg.signMessage(text);
    const signer =
      sg.kind === "evm" ? { Evm: { signature } } : { Solana: { public_key: sg.address, signature } };
    return tr.call(
      o.contract,
      "use_lease_signed",
      { ...args, nonce, valid_until_ms: validUntil, signer },
      deposit,
      CALL_TGAS,
    );
  }

  return {
    contract: o.contract,
    leaseId: o.leaseId,

    async call(endpoint, body, opts = {}) {
      const method = opts.method ?? (body === undefined ? "GET" : "POST");
      if (method === "GET" && body !== undefined)
        throw new Error("KeyLease SDK: a GET call cannot carry a body");
      const args = {
        lease_id: o.leaseId,
        endpoint,
        method,
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      };
      let sent;
      try {
        const tr = await t();
        const deposit = opts.deposit ?? CALL_DEPOSIT;
        sent = o.signer
          ? await sendSigned(tr, o.signer, args, deposit)
          : await tr.call(o.contract, "use_lease", args, deposit, CALL_TGAS);
      } catch (e) {
        if (e instanceof TxFailed) throw failed(e, o.leaseId, "call_failed");
        throw e;
      }
      const receipt: Receipt = {
        leaseId: o.leaseId,
        call: callNumber(sent.logs),
        tx: sent.hash,
        url: explorer(sent.hash),
      };
      const a = sent.value as {
        ok?: unknown;
        status?: unknown;
        body?: unknown;
        body_encoding?: unknown;
        body_sha256?: unknown;
        redacted?: unknown;
        error?: unknown;
        hint?: unknown;
      } | null;
      if (a === null || typeof a !== "object")
        throw new KeyLeaseError(
          "no_answer",
          "OutLayer returned no answer (the run failed or timed out); the call was still used.",
          receipt,
        );
      if (a.ok !== true) {
        const code = typeof a.error === "string" ? a.error : "proxy_error";
        const hint = REFUSALS[code] ?? PROXY_ERRORS[code] ?? (typeof a.hint === "string" ? a.hint : "");
        throw new KeyLeaseError(code, hint, receipt);
      }
      return {
        status: typeof a.status === "number" ? a.status : 0,
        data: decodeBody(typeof a.body === "string" ? a.body : "", a.body_encoding),
        redacted: a.redacted === true,
        bodySha256: typeof a.body_sha256 === "string" ? a.body_sha256 : "",
        receipt,
        attestation: null,
      };
    },

    async check(endpoint) {
      const tr = await t();
      const c = await tr.view<{ ok: boolean; reason?: string | null; hint?: string | null }>(
        o.contract,
        "check_call",
        {
          lease_id: o.leaseId,
          caller: await holder(tr),
          endpoint,
        },
      );
      return { ok: c.ok, reason: c.reason ?? null, hint: c.hint ?? null };
    },

    async status() {
      return (await t()).view<LeaseStatus | null>(o.contract, "get_lease", { lease_id: o.leaseId });
    },

    async subLease(s) {
      notForSigners();
      const grantee = testnetAccount(s.grantee, "the grantee");
      if (!Number.isInteger(s.calls) || s.calls < 1)
        throw new Error("KeyLease SDK: calls must be a whole number, at least 1");
      if (s.endpoints?.length === 0) throw new Error("KeyLease SDK: a sub-lease needs at least one endpoint");
      const tr = await t();
      const p = mustHold(
        await tr.view<LeaseStatus | null>(o.contract, "get_lease", { lease_id: o.leaseId }),
        tr.account,
      );
      if (p.depth >= MAX_SUB_LEASE_DEPTH)
        throw new Error(`KeyLease SDK: sub-leases go at most ${String(MAX_SUB_LEASE_DEPTH)} levels deep`);
      if (s.calls > p.calls_left)
        throw new Error(
          `KeyLease SDK: the lease above has ${String(p.calls_left)} calls left; a sub-lease cannot have more`,
        );
      let expires = p.expires_at;
      if (s.expiresAt !== undefined) {
        const ms = s.expiresAt instanceof Date ? s.expiresAt.getTime() : s.expiresAt;
        if (!Number.isFinite(ms) || ms <= (o.now ?? Date.now)())
          throw new Error("KeyLease SDK: expiresAt must be in the future");
        expires = msToNs(ms);
        if (BigInt(expires) > BigInt(p.expires_at))
          throw new Error("KeyLease SDK: a sub-lease cannot outlive the lease above it");
      }
      const endpoints = [...(s.endpoints ?? p.endpoints)];
      if (!endpoints.every((e) => p.endpoints.includes(e)))
        throw new Error("KeyLease SDK: a sub-lease can only use endpoints of the lease above it");
      const args = { parent: o.leaseId, grantee, calls: s.calls, expires_at: expires, endpoints };
      let sent;
      try {
        sent = await tr.call(
          o.contract,
          "create_sub_lease",
          args,
          s.deposit ?? SUB_LEASE_DEPOSIT,
          SMALL_TGAS,
        );
      } catch (e) {
        if (e instanceof TxFailed) throw failed(e, o.leaseId, "sub_lease_refused");
        throw e;
      }
      const id = String(sent.value);
      return {
        leaseId: id,
        lease: lease({ ...o, leaseId: id, transport: tr }),
        receipt: { tx: sent.hash, url: explorer(sent.hash) },
      };
    },

    async subLeases() {
      return (await t()).view<LeaseStatus[]>(o.contract, "list_sub_leases", { lease_id: o.leaseId });
    },

    async transfer(receiverId, opts = {}) {
      notForSigners();
      const receiver = testnetAccount(receiverId, "the receiver");
      const tr = await t();
      mustHold(
        await tr.view<LeaseStatus | null>(o.contract, "get_lease", { lease_id: o.leaseId }),
        tr.account,
      );
      if (receiver === tr.account) throw new Error("KeyLease SDK: this account already holds the lease");
      const args = {
        receiver_id: receiver,
        token_id: o.leaseId,
        ...(opts.memo === undefined ? {} : { memo: opts.memo }),
      };
      try {
        const sent = await tr.call(o.contract, "nft_transfer", args, 1n, SMALL_TGAS);
        return { tx: sent.hash, url: explorer(sent.hash) };
      } catch (e) {
        if (e instanceof TxFailed) throw failed(e, o.leaseId, "transfer_refused");
        throw e;
      }
    },

    async keyPass() {
      return (await t()).view<KeyPass | null>(o.contract, "nft_token", { token_id: o.leaseId });
    },
  };
}

/** A lease from env: KEYLEASE_CONTRACT_ID, KEYLEASE_LEASE_ID (+ NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY). */
export function leaseFromEnv(overrides: Partial<LeaseOptions> = {}): Lease {
  const contract = overrides.contract ?? env("KEYLEASE_CONTRACT_ID");
  const leaseId = overrides.leaseId ?? env("KEYLEASE_LEASE_ID");
  if (!contract || !leaseId) throw new Error("KeyLease SDK: set KEYLEASE_CONTRACT_ID and KEYLEASE_LEASE_ID");
  return lease({ ...overrides, contract, leaseId });
}
