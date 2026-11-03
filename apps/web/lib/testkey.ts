/**
 * Test key: one live call through the proxy with the owner's own key. A one-call, ten-minute lease to the
 * owner on `/models` (lists models, uses no tokens), then `use_lease` on it, then a plain reading of the
 * answer. Same contract calls as `kl lease` + `kl call`.
 */
import { actionCreators } from "@near-wallet-selector/core";
import type { Tx } from "../components/WalletProvider.tsx";
import { PROXY_ERRORS, REFUSALS, refusalIn } from "./wording.ts";

const TGAS = 1_000_000_000_000n;
export const TEST_ENDPOINT = "/models";
export const LEASE_DEPOSIT = 50_000_000_000_000_000_000_000n; // 0.05 NEAR, unused storage refunded
export const CALL_DEPOSIT = 25_000_000_000_000_000_000_000n; // 0.025 NEAR, unused compute refunded by OutLayer
export const TEST_LEASE_NS = 10n * 60n * 1_000_000_000n;

export function testLeaseTx(contractId: string, keyId: string, owner: string, nowMs: number): Tx {
  return {
    receiverId: contractId,
    actions: [
      actionCreators.functionCall(
        "create_lease",
        {
          key_id: keyId,
          grantee: owner,
          calls: 1,
          expires_at: (BigInt(nowMs) * 1_000_000n + TEST_LEASE_NS).toString(),
          endpoints: [TEST_ENDPOINT],
        },
        50n * TGAS,
        LEASE_DEPOSIT,
      ),
    ],
  };
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

/** The decoded return value of a final outcome (`SuccessValue`), or null. */
export function returnValue(outcome: unknown): unknown {
  const v = (outcome as { status?: { SuccessValue?: string } } | undefined)?.status?.SuccessValue;
  if (v === undefined || v === "") return null;
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0))));
}

export type Verdict = { readonly ok: boolean; readonly text: string };

/** One plain sentence for the proxy's answer (see contracts/keylease/src/run.rs `classify`). */
export function verdict(answer: unknown): Verdict {
  if (answer === null || typeof answer !== "object")
    return {
      ok: false,
      text: "OutLayer returned no answer (the run failed or timed out); the call was still used.",
    };
  const a = answer as { ok?: unknown; status?: unknown; error?: unknown };
  if (a.ok === true) {
    const status = typeof a.status === "number" ? a.status : 0;
    if (status >= 200 && status < 300)
      return { ok: true, text: `The key works: the API answered HTTP ${String(status)} through the proxy.` };
    if (status === 401 || status === 403)
      return {
        ok: false,
        text: `The API refused the key (HTTP ${String(status)}); check the key or its base URL.`,
      };
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
  return text.slice(0, 200);
}
