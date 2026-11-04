/**
 * Test key: one live call through the proxy with the owner's own key. A one-call, ten-minute lease to the
 * owner on `/models` (lists models, uses no tokens), then `use_lease` on it, then a plain reading of the
 * answer. Same contract calls as `kl lease` + `kl call`.
 */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { leaseTx } from "./lease.ts";
import { PROXY_ERRORS, REFUSALS, refusalIn } from "./wording.ts";

const TGAS = 1_000_000_000_000n;
export const TEST_ENDPOINT = "/models";
export { LEASE_DEPOSIT } from "./lease.ts";
export const CALL_DEPOSIT = 25_000_000_000_000_000_000_000n; // 0.025 NEAR, unused compute refunded by OutLayer
export const TEST_LEASE_NS = 10n * 60n * 1_000_000_000n;

export function testLeaseTx(contractId: string, keyId: string, owner: string, nowMs: number): Tx {
  return leaseTx(contractId, keyId, owner, 1, BigInt(nowMs) * 1_000_000n + TEST_LEASE_NS, [TEST_ENDPOINT]);
}

export function testCallTx(contractId: string, leaseId: string): Tx {
  return {
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "use_lease",
        { lease_id: leaseId, endpoint: TEST_ENDPOINT, method: "GET" },
        300n * TGAS,
        CALL_DEPOSIT,
      ),
    ],
  };
}

/** Decodes a base64 `SuccessValue` (JSON), or null when empty. */
function decodeB64Json(v: string | undefined): unknown {
  if (v === undefined || v === "") return null;
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0))));
}

/**
 * The wallet contract on an eth-implicit (0x…) account answers every call with an `ExecuteResponse`
 * (`{ success, success_value: bytes, error }`) around the real return value (nearcore
 * runtime/near-wallet-contract, `rlp_execute_callback`). MetaMask and other EVM wallets land here.
 */
function isExecuteResponse(v: unknown): v is { success: boolean; success_value?: unknown; error?: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { success?: unknown }).success === "boolean" &&
    "success_value" in v &&
    "error" in v
  );
}

/** The last non-empty `SuccessValue` the contract itself returned in this transaction, if any. */
function contractValue(outcome: unknown, contractId: string): string | undefined {
  const receipts = (outcome as { receipts_outcome?: unknown } | undefined)?.receipts_outcome;
  if (!Array.isArray(receipts)) return undefined;
  for (const r of [...(receipts as unknown[])].reverse()) {
    const o = (r as { outcome?: { executor_id?: unknown; status?: { SuccessValue?: unknown } } }).outcome;
    const v = o?.status?.SuccessValue;
    if (o?.executor_id === contractId && typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

/**
 * The decoded return value of a final outcome (`SuccessValue`), or null. For an EVM wallet the
 * wallet contract's `ExecuteResponse` is unwrapped; a failed inner call throws its error. That
 * wrapper drops values over 16 KiB ("Result truncated"), so with `contractId` the value is read
 * from the contract's own receipt in the same transaction instead.
 */
export function returnValue(outcome: unknown, contractId?: string): unknown {
  const v = decodeB64Json(
    (outcome as { status?: { SuccessValue?: string } } | undefined)?.status?.SuccessValue,
  );
  if (!isExecuteResponse(v)) return v;
  if (!v.success)
    throw new Error(typeof v.error === "string" ? v.error : "The wallet contract reported a failed call.");
  const own = contractId === undefined ? undefined : contractValue(outcome, contractId);
  if (own !== undefined) return decodeB64Json(own);
  const bytes = v.success_value;
  if (!Array.isArray(bytes) || bytes.length === 0) return null;
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes as number[])));
}

export type Verdict = {
  readonly ok: boolean;
  readonly text: string;
  /** The proxy and the lease worked; the API itself said no to the request (a 4xx other than 401/403). */
  readonly apiRejected?: true;
};

/** ✓ for a working call, ⚠ when only the API said no, ✗ for everything else. */
export const verdictMark = (v: Verdict) => (v.ok ? "✓" : v.apiRejected ? "⚠" : "✗");

/** The API's own error sentence from a JSON error body (Anthropic and OpenAI shapes), if there is one. */
function apiMessage(body: unknown): string | null {
  if (typeof body !== "string") return null;
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    const e = j.error;
    const m =
      (typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : null) ??
      (typeof j.message === "string" ? j.message : null) ??
      (typeof e === "string" ? e : null);
    return m === null ? null : m.slice(0, 200);
  } catch {
    return null;
  }
}

/** One plain sentence for the proxy's answer (see contracts/keylease/src/run.rs `classify`). */
export function verdict(answer: unknown): Verdict {
  if (answer === null || typeof answer !== "object")
    return {
      ok: false,
      text: "OutLayer returned no answer (the run failed or timed out); the call was still used.",
    };
  const a = answer as {
    ok?: unknown;
    status?: unknown;
    error?: unknown;
    body?: unknown;
    body_encoding?: unknown;
  };
  if (a.ok === true) {
    const status = typeof a.status === "number" ? a.status : 0;
    if (status >= 200 && status < 300)
      return { ok: true, text: `The key works: the API answered HTTP ${String(status)} through the proxy.` };
    if (status === 401 || status === 403)
      return {
        ok: false,
        text: `The API refused the key (HTTP ${String(status)}); check the key or its base URL.`,
      };
    if (status >= 400 && status < 500) {
      const m = a.body_encoding === "utf8" ? apiMessage(a.body) : null;
      return {
        ok: false,
        apiRejected: true,
        text: m
          ? `The proxy works; the API rejected the request: ${m}`
          : `The proxy works; the API rejected the request (HTTP ${String(status)}).`,
      };
    }
    return { ok: false, text: `The proxy reached the API, which answered HTTP ${String(status)}.` };
  }
  const code = typeof a.error === "string" ? a.error : "";
  const hint = REFUSALS[code] ?? PROXY_ERRORS[code];
  return {
    ok: false,
    text: hint ? `${code}: ${hint}` : `The proxy answered with an error${code ? ` (${code})` : ""}.`,
  };
}

/** A wallet or chain error as one sentence, with the refusal code when there is one. */
export function failureText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const r = refusalIn(text);
  if (r) return `${r.code}: ${r.hint}`;
  if (/reject|cancel|closed/i.test(text)) return "The wallet declined the transaction.";
  // A contract limit (`require!`) is a plain sentence: show just that.
  const said = /panicked: ([^"\\]+)/u.exec(text)?.[1]?.trim();
  if (said) return said;
  return text.slice(0, 200);
}
