/**
 * KeyLease demo API. Low value on purpose: it answers only with canned text and echoes, so a judge can
 * run the whole loop without a real provider key. Plain Web `Request -> Response`, so it runs on Vercel,
 * a Cloudflare Worker or Node (src/serve.ts).
 *
 *   GET  /v1/models            OpenAI-shaped model list
 *   POST /v1/chat/completions  OpenAI-shaped answer echoing the last user message
 *   POST /echo                 returns the JSON body it got
 *   GET  /debug/headers        returns the request headers, key included: a deliberately leaky endpoint
 *                              that shows the proxy's tripwire withholding an answer that carries the key
 *
 * Every request needs `Authorization: Bearer <MOCK_API_KEY>`; the key comes from env only.
 *
 * Shapes follow the OpenAI API reference, as NEAR AI Cloud and the other OpenAI-compatible providers do:
 * - chat completion object: https://platform.openai.com/docs/api-reference/chat/object
 * - create chat completion: https://platform.openai.com/docs/api-reference/chat/create
 * - list models / model object: https://platform.openai.com/docs/api-reference/models/list
 * - error object `{ error: { message, type, param, code } }`: https://platform.openai.com/docs/guides/error-codes
 */
import { timingSafeEqual } from "node:crypto";

export interface Env {
  /** The demo key; requests without it are refused. */
  readonly MOCK_API_KEY?: string | undefined;
}

export const MAX_BODY = 64 * 1024;
const MODEL = "keylease-mock-1";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const ERROR_TYPE: Record<number, string> = {
  400: "invalid_request_error",
  401: "invalid_request_error",
  404: "invalid_request_error",
  413: "invalid_request_error",
  500: "server_error",
};

function error(status: number, code: string, message: string): Response {
  return json(status, {
    error: { message, type: ERROR_TYPE[status] ?? "invalid_request_error", param: null, code },
  });
}

/** Fixed creation time of the mock model (OpenAI `created`, unix seconds). */
const MODEL_CREATED = 1_762_128_000;

/** Headers as a plain object (lower-case names). */
export function headerObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/** Constant-time check of the bearer token. */
export function authorized(header: string | null, key: string | undefined): boolean {
  if (!key || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new RangeError("body over 64 KB");
  return text === "" ? null : (JSON.parse(text) as unknown);
}

function lastUserMessage(body: unknown): string {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (!env.MOCK_API_KEY) return error(500, "not_configured", "MOCK_API_KEY is not set on the server.");
  if (!authorized(req.headers.get("authorization"), env.MOCK_API_KEY)) {
    return error(401, "unauthorized", "Send Authorization: Bearer <key>.");
  }
  const { pathname } = new URL(req.url);
  const route = `${req.method} ${pathname}`;
  try {
    switch (route) {
      case "GET /v1/models":
        return json(200, {
          object: "list",
          data: [{ id: MODEL, object: "model", created: MODEL_CREATED, owned_by: "keylease-demo" }],
        });
      case "POST /v1/chat/completions": {
        const said = lastUserMessage(await readJson(req)).slice(0, 500);
        const content = said ? `mock answer: you said "${said}"` : "mock answer: no user message";
        return json(200, {
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            { index: 0, message: { role: "assistant", content }, logprobs: null, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: said.length,
            completion_tokens: content.length,
            total_tokens: said.length + content.length,
          },
        });
      }
      case "POST /echo":
        return json(200, { received: await readJson(req) });
      case "GET /debug/headers":
        return json(200, { headers: headerObject(req.headers) });
      default:
        return error(404, "not_found", `No route ${route}.`);
    }
  } catch (e) {
    if (e instanceof RangeError) return error(413, "too_large", "The request body is over 64 KB.");
    return error(400, "bad_json", "The request body is not valid JSON.");
  }
}
