/**
 * Same-origin relay for OutLayer's `POST /secrets/pubkey` (E-017, T22). OutLayer's API sends no
 * `Access-Control-Allow-Origin`, so the browser cannot ask it directly (Q-011, 3 Nov).
 *
 * Not an open proxy: one fixed upstream URL, a strict request shape rebuilt field by field, env names with
 * empty values only (a key can never pass through), small bodies, same-origin callers, a per-IP limit,
 * and only `{pubkey}` back. Nothing from the request is logged. Web APIs only: runs on Vercel's edge
 * runtime and in scripts/serve.ts.
 */
export const UPSTREAM = "https://testnet-api.outlayer.ai/secrets/pubkey";
export const MAX_BODY = 2048;
export const LIMIT_PER_MINUTE = 20;
const TIMEOUT_MS = 10_000;

const HASH = /^[0-9a-f]{64}$/u;
const PROFILE = /^[A-Za-z0-9_-]{1,64}$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const TESTNET_ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.testnet$/u;

export interface PubkeyBody {
  readonly accessor: { readonly type: "WasmHash"; readonly hash: string };
  readonly owner: string;
  readonly profile: string;
  readonly secrets_json: string;
}

/** The request rebuilt from checked fields, or the reason it is refused. */
export function checkBody(raw: unknown): PubkeyBody | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "body must be a JSON object";
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !["accessor", "owner", "profile", "secrets_json"].includes(k));
  if (extra.length > 0) return `unexpected field ${extra[0] ?? ""}`;
  const acc = o["accessor"] as Record<string, unknown> | null | undefined;
  if (typeof acc !== "object" || acc === null || acc["type"] !== "WasmHash" || Object.keys(acc).length !== 2)
    return "accessor must be {type: WasmHash, hash}";
  const hash = acc["hash"];
  if (typeof hash !== "string" || !HASH.test(hash)) return "accessor.hash must be 64 lowercase hex";
  const owner = o["owner"];
  if (typeof owner !== "string" || !TESTNET_ACCOUNT.test(owner)) return "owner must be a .testnet account";
  const profile = o["profile"];
  if (typeof profile !== "string" || !PROFILE.test(profile))
    return "profile must be 1-64 letters, digits, - or _";
  const sj = o["secrets_json"];
  if (typeof sj !== "string") return "secrets_json must be a string";
  let names: unknown;
  try {
    names = JSON.parse(sj);
  } catch {
    return "secrets_json must be JSON";
  }
  if (typeof names !== "object" || names === null || Array.isArray(names))
    return "secrets_json must be an object";
  const entries = Object.entries(names as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) return "secrets_json must name 1-8 variables";
  for (const [k, v] of entries) {
    if (!ENV_NAME.test(k)) return "secrets_json names must be UPPER_SNAKE_CASE";
    if (v !== "") return "secrets_json values must be empty: the relay never carries a key";
  }
  return {
    accessor: { type: "WasmHash", hash },
    owner,
    profile,
    secrets_json: JSON.stringify(Object.fromEntries(entries.map(([k]) => [k, ""]))),
  };
}

/** Fixed-window counter per client, per process or edge isolate (best effort; T22). */
export class Limiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  constructor(max = LIMIT_PER_MINUTE, windowMs = 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }
  allow(client: string, now: number): boolean {
    const h = this.hits.get(client);
    if (!h || now - h.start >= this.windowMs) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(client, { start: now, n: 1 });
      return true;
    }
    h.n += 1;
    return h.n <= this.max;
  }
}

export interface RelayDeps {
  readonly fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  readonly limiter?: Limiter;
  readonly now?: () => number;
}

const shared = new Limiter();

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  return origin === null || origin === new URL(req.url).origin;
}

export async function relayPubkey(req: Request, deps: RelayDeps = {}): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!sameOrigin(req)) return json(403, { error: "same-origin only" });
  const client =
    req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (!(deps.limiter ?? shared).allow(client, (deps.now ?? Date.now)()))
    return json(429, { error: "too many requests; try again in a minute" });
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
    return json(415, { error: "content-type must be application/json" });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json(413, { error: "body too large" });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: "body too large" });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "body must be JSON" });
  }
  const body = checkBody(raw);
  if (typeof body === "string") return json(400, { error: body });

  let res: Response;
  try {
    res = await (deps.fetcher ?? fetch)(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "keylease-relay" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json(502, { error: "OutLayer did not answer" });
  }
  if (!res.ok) return json(502, { error: `OutLayer answered HTTP ${String(res.status)}` });
  const answer = (await res.json().catch(() => null)) as { pubkey?: unknown } | null;
  const pubkey = answer?.pubkey;
  if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/iu.test(pubkey))
    return json(502, { error: "OutLayer sent no valid pubkey" });
  return json(200, { pubkey });
}
