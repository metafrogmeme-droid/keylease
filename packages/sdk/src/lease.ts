/**
 * `lease({ contract, leaseId })` → `l.call(endpoint, body)`. The holder of a lease makes API calls through
 * the KeyLease contract and OutLayer's TEE; it never sees the key. Refusals throw `KeyLeaseError` with the
 * code and the sentence from docs/WORDING.md.
 */
import { nearTransport } from "./near.ts";
import { TxFailed, type Transport } from "./transport.ts";
import { PROXY_ERRORS, REFUSALS } from "./wording.ts";

/** Attached to each call: OutLayer's compute deposit plus the receipt; unused compute is refunded. */
export const CALL_DEPOSIT = 25_000_000_000_000_000_000_000n; // 0.025 NEAR
const CALL_TGAS = 300;

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

export interface LeaseStatus {
  readonly lease_id: string;
  readonly grantee: string;
  readonly calls_used: number;
  readonly calls_left: number;
  readonly expires_at: string;
  readonly endpoints: string[];
  readonly status: "active" | "revoked" | "expired" | "used_up";
}

export interface Lease {
  readonly contract: string;
  readonly leaseId: string;
  call(endpoint: string, body?: unknown, opts?: CallOptions): Promise<CallResult>;
  /** Would a call on `endpoint` pass right now? Free (a view). */
  check(endpoint: string): Promise<{ ok: boolean; reason: string | null; hint: string | null }>;
  status(): Promise<LeaseStatus | null>;
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
  let transport: Promise<Transport> | null = o.transport ? Promise.resolve(o.transport) : null;
  const t = () => {
    transport ??= (() => {
      const account = o.account ?? env("NEAR_ACCOUNT_ID");
      const privateKey = o.privateKey ?? env("NEAR_PRIVATE_KEY");
      if (!account || !privateKey)
        throw new Error("KeyLease SDK: set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (env only)");
      const rpc = o.rpc ?? env("NEAR_RPC_URL");
      return nearTransport({ account, privateKey, ...(rpc ? { rpc } : {}) });
    })();
    return transport;
  };

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
        sent = await (await t()).call(o.contract, "use_lease", args, opts.deposit ?? CALL_DEPOSIT, CALL_TGAS);
      } catch (e) {
        if (e instanceof TxFailed) {
          const r = refusalIn(e.text);
          const receipt = { leaseId: o.leaseId, call: null, tx: e.hash, url: explorer(e.hash) };
          if (r) throw new KeyLeaseError(r.code, r.hint, receipt);
          throw new KeyLeaseError("call_failed", e.text.slice(0, 300), receipt);
        }
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
          caller: tr.account,
          endpoint,
        },
      );
      return { ok: c.ok, reason: c.reason ?? null, hint: c.hint ?? null };
    },

    async status() {
      return (await t()).view<LeaseStatus | null>(o.contract, "get_lease", { lease_id: o.leaseId });
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
