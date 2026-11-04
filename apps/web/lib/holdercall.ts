/**
 * The lease holder's test call from the lease page (so a phone, with no SDK or CLI, can use a lease):
 * one `use_lease` on the lease's first endpoint, then a plain reading of the answer. The answer is read
 * the same way as Test key (#44, #45): the 0x wallet contract's envelope unwrapped, large answers taken
 * from the contract's own receipt.
 */
import { actionCreators } from "@near-wallet-selector/core";
import { outlayerRequestId } from "@keylease/outlayer/web";
import type { Tx } from "../components/WalletProvider.tsx";
import type { LeaseView } from "./lease-view.ts";
import { CALL_DEPOSIT, returnValue, verdict, type Verdict } from "./testkey.ts";

const TGAS = 1_000_000_000_000n;

/** A tiny prompt: chat-style APIs (OpenAI- or Anthropic-shaped) take it; it asks for 16 tokens at most. */
export const TEST_PROMPT = { max_tokens: 16, messages: [{ role: "user", content: "Say hi in two words." }] };

/**
 * A model to put in the test prompt, by the key's provider and base URL; the holder can change it on the
 * page. Empty where the app cannot know one (NEAR AI Cloud, other OpenAI-compatible hosts, Custom): then
 * the holder types it, or the request goes without one and the API says what it wants.
 */
export function suggestedModel(provider: string, baseUrl: string): string {
  if (provider === "AnthropicCompatible") return "claude-haiku-5-5"; // the current smallest Claude model
  if (provider === "OpenAiCompatible") {
    if (/\/mock(\/|$)/u.test(new URL(baseUrl).pathname)) return "keylease-mock-1"; // the demo API
    if (new URL(baseUrl).hostname === "api.openai.com") return "gpt-4o-mini";
  }
  return "";
}

/** `/models` (any prefix) is read with GET; every other endpoint gets the tiny prompt as POST. */
function isListing(endpoint: string): boolean {
  return /(^|\/)models$/u.test(endpoint);
}

/** Which endpoint the test call uses: a models listing when the lease has one (no tokens), else the first. */
export function testEndpoint(endpoints: readonly string[]): string {
  return endpoints.find(isListing) ?? endpoints[0] ?? "/";
}

/** Whether the test call sends a prompt (and so needs a model) rather than reading a models listing. */
export const sendsPrompt = (endpoints: readonly string[]) => !isListing(testEndpoint(endpoints));

export function holderCallTx(
  contractId: string,
  leaseId: string,
  endpoints: readonly string[],
  model: string,
): Tx {
  const endpoint = testEndpoint(endpoints);
  const m = model.trim();
  const prompt = m === "" ? TEST_PROMPT : { model: m, ...TEST_PROMPT };
  const args = isListing(endpoint)
    ? { lease_id: leaseId, endpoint, method: "GET" }
    : { lease_id: leaseId, endpoint, method: "POST", body: JSON.stringify(prompt) };
  return {
    receiverId: contractId,
    actions: [actionCreators.functionCall("use_lease", args, 300n * TGAS, CALL_DEPOSIT)],
  };
}

/** Why this account cannot make a call from this page, or null when it can. */
export function callBlocked(lease: LeaseView, account: string | null): string | null {
  if (account === null) return "Connect the holder's wallet to make a test call from this page.";
  if (account !== lease.grantee)
    return `Only the holder (${lease.grantee}) can make a call; this wallet is ${account}.`;
  if (lease.status === "revoked") return "This lease is revoked, so no calls can be made.";
  if (lease.status === "expired") return "This lease has expired, so no calls can be made.";
  if (lease.status === "used_up" || lease.calls_left <= 0) return "This lease has no calls left.";
  return null;
}

export interface CallResult {
  readonly verdict: Verdict;
  /** The API's HTTP status when the proxy reached it. */
  readonly status: number | null;
  readonly requestId: string | null;
  readonly tx: string | null;
}

function logsOf(outcome: unknown): string[] {
  const o = outcome as {
    transaction_outcome?: { outcome?: { logs?: unknown } };
    receipts_outcome?: { outcome?: { logs?: unknown } }[];
  };
  const all = [
    o.transaction_outcome?.outcome?.logs,
    ...(o.receipts_outcome ?? []).map((r) => r.outcome?.logs),
  ];
  return all.flatMap((l) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []));
}

/** Read one call's final outcome. Throws when the wallet contract reports a failed call. */
export function readCall(outcome: unknown, contractId: string): CallResult {
  const answer = returnValue(outcome, contractId);
  const status =
    answer !== null &&
    typeof answer === "object" &&
    typeof (answer as { status?: unknown }).status === "number"
      ? (answer as { status: number }).status
      : null;
  const id = (outcome as { transaction_outcome?: { id?: unknown } } | undefined)?.transaction_outcome?.id;
  return {
    verdict: verdict(answer),
    status,
    requestId: outlayerRequestId(logsOf(outcome)),
    tx: typeof id === "string" ? id : null,
  };
}
