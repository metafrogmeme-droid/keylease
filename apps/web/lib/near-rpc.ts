/**
 * Read-only NEAR calls over JSON-RPC, testnet only: the testnet RPC first, FastNear's testnet RPC when it
 * fails for a passing reason (network error, 408/429/5xx, an RPC timeout). The CSP allows these two only.
 */
import { DEFAULT_RPC } from "./config.ts";

/** FastNear's public testnet RPC, used only when the primary fails transiently. */
export const FALLBACK_RPC = "https://test.rpc.fastnear.com";
export const RPC_URLS: readonly string[] = [DEFAULT_RPC, FALLBACK_RPC];

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CAUSES = new Set(["TIMEOUT_ERROR", "INTERNAL_ERROR"]);

/** Worth one more try on the other RPC? A real answer (UNKNOWN_ACCESS_KEY, a contract panic) is not. */
export async function isTransient(res: Response): Promise<boolean> {
  if (TRANSIENT_STATUS.has(res.status)) return true;
  if (!res.ok) return false;
  try {
    const body = (await res.clone().json()) as { error?: { name?: string; cause?: { name?: string } } };
    const e = body.error;
    return e !== undefined && (TRANSIENT_CAUSES.has(e.cause?.name ?? "") || e.name === "INTERNAL_ERROR");
  } catch {
    return false;
  }
}

/** POST to each URL in turn until one answers for real; the last answer (or error) is passed on. */
async function postWithFallback(
  urls: readonly string[],
  fetcher: Fetch,
  init: RequestInit,
): Promise<Response> {
  let last: unknown;
  for (const [i, url] of urls.entries()) {
    const final = i === urls.length - 1;
    try {
      const res = await fetcher(url, init);
      if (final || !(await isTransient(res))) return res;
      last = res;
    } catch (e) {
      if (final) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("no RPC answered");
}

/** True for a JSON-RPC `query` (view_access_key, call_function, view_account): read-only, so a retry changes nothing. */
function isQuery(body: unknown): boolean {
  if (typeof body !== "string") return false;
  try {
    return (JSON.parse(body) as { method?: unknown }).method === "query";
  } catch {
    return false;
  }
}

const RETRY = Symbol.for("keylease.rpcRetry");

/**
 * For the wallet modules' own NEAR calls (they build their own providers, e.g. MetaMask's view_access_key):
 * a read-only `query` POSTed to the testnet RPC that fails transiently is tried once more on the fallback.
 * Transactions and every other host pass through untouched. Installs once.
 */
export function installRpcRetry(win: { fetch: typeof fetch }): void {
  const current = win.fetch as typeof fetch & { [RETRY]?: true };
  if (current[RETRY]) return;
  const inner = current.bind(win) as Fetch;
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    if (!init || !url.startsWith(DEFAULT_RPC) || init.method !== "POST" || !isQuery(body))
      return current(input, init);
    return postWithFallback([url, FALLBACK_RPC], inner, init);
  }) as typeof fetch & { [RETRY]?: true };
  wrapped[RETRY] = true;
  win.fetch = wrapped;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function b64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export async function view<T>(
  rpc: string,
  contractId: string,
  method: string,
  args: object = {},
  fetcher: Fetch = fetch,
): Promise<T> {
  const res = await postWithFallback(rpc === DEFAULT_RPC ? RPC_URLS : [rpc], fetcher, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kl",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: b64(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC answered HTTP ${String(res.status)}`);
  const body = (await res.json()) as {
    result?: { result?: number[]; error?: string };
    error?: { cause?: { name?: string }; message?: string };
  };
  if (body.error)
    throw new Error(`${method}: ${body.error.cause?.name ?? body.error.message ?? "RPC error"}`);
  if (body.result?.error !== undefined) throw new Error(`${method}: ${body.result.error}`);
  const bytes = body.result?.result;
  if (!bytes) throw new Error(`${method}: empty answer`);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as T;
}
