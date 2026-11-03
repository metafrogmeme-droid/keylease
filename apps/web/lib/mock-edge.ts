/**
 * The demo API (`mock-api`) on the web host, at `/mock/*` (D3). A mock: canned answers and echoes, a
 * low-value key from the host's env (`MOCK_API_KEY`), never a real provider. Same guards as the pubkey
 * relay (T22): bodies up to 2 KB, 20 requests per minute per IP, browsers from other sites refused; every
 * answer says it is a demo.
 */
import { handle } from "@keylease/mock-api";
import { Limiter, MAX_BODY, clientOf, json, sameOrigin } from "./relay.ts";

export const MOCK_PREFIX = "/mock";
export const DEMO_HEADER = "x-keylease-demo";
export const DEMO_NOTE = "mock API: canned answers, low-value demo key, no real provider";

const shared = new Limiter();

export interface MockDeps {
  readonly key: string | undefined;
  readonly limiter?: Limiter;
  readonly now?: () => number;
}

/**
 * The path under `/mock` the caller asked for. Vercel may hand the function either the original URL or
 * the rewritten one (`/api/mock?path=…`); both give the same path.
 */
export function mockPath(url: URL): string | null {
  if (url.pathname === MOCK_PREFIX || url.pathname.startsWith(`${MOCK_PREFIX}/`))
    return url.pathname.slice(MOCK_PREFIX.length) || "/";
  const p = url.searchParams.get("path");
  return p === null ? null : `/${p.replace(/^\/+/u, "")}`;
}

function mark(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(DEMO_HEADER, DEMO_NOTE);
  return new Response(res.body, { status: res.status, headers });
}

export async function serveMock(req: Request, deps: MockDeps): Promise<Response> {
  if (!sameOrigin(req))
    return mark(json(403, { error: "the demo API is for the KeyLease proxy, not browsers" }));
  if (!(deps.limiter ?? shared).allow(clientOf(req), (deps.now ?? Date.now)()))
    return mark(json(429, { error: "too many requests; try again in a minute" }));
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY)
    return mark(json(413, { error: "body too large" }));
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.text();
  if (body !== null && body.length > MAX_BODY) return mark(json(413, { error: "body too large" }));
  const url = new URL(req.url);
  const path = mockPath(url);
  if (path === null) return mark(json(404, { error: "not found" }));
  const inner = new Request(new URL(path, url.origin), { method: req.method, headers: req.headers, body });
  return mark(await handle(inner, { MOCK_API_KEY: deps.key }));
}
