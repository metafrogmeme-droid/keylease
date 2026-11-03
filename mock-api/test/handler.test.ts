import { describe, expect, it } from "vitest";
import { authorized, handle, MAX_BODY } from "../src/handler.ts";

/** A demo key built at run time (never key-shaped in the source). */
const KEY = ["mock", "-", "k".repeat(24)].join("");
const env = { MOCK_API_KEY: KEY };

function req(method: string, path: string, body?: unknown, key: string | null = KEY): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("authorization", `Bearer ${key}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://mock.example${path}`, init);
}

async function call(r: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handle(r, env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("auth", () => {
  it("refuses a missing or wrong key", async () => {
    expect((await call(req("GET", "/v1/models", undefined, null))).status).toBe(401);
    expect((await call(req("GET", "/v1/models", undefined, "wrong"))).status).toBe(401);
  });

  it("refuses everything when the server has no key", async () => {
    expect((await handle(req("GET", "/v1/models"), {})).status).toBe(500);
  });

  it("compares in constant time and only bearer tokens", () => {
    expect(authorized(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(authorized(KEY, KEY)).toBe(false);
    expect(authorized(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(authorized(`Bearer ${KEY}`, undefined)).toBe(false);
    expect(authorized(`Bearer ${KEY.slice(0, -1)}`, KEY)).toBe(false);
    expect(authorized("Bearer ", KEY)).toBe(false);
  });
});

describe("errors use the OpenAI error object", () => {
  it("has message, type, param and code", async () => {
    const { body } = await call(req("GET", "/v1/models", undefined, null));
    expect(body["error"]).toEqual({
      message: "Send Authorization: Bearer <key>.",
      type: "invalid_request_error",
      param: null,
      code: "unauthorized",
    });
  });
});

describe("routes", () => {
  it("lists one model", async () => {
    const { status, body } = await call(req("GET", "/v1/models"));
    expect(status).toBe(200);
    expect(body["object"]).toBe("list");
    expect(body["data"]).toEqual([
      {
        id: "keylease-mock-1",
        object: "model",
        created: expect.any(Number) as number,
        owned_by: "keylease-demo",
      },
    ]);
  });

  it("answers chat completions in OpenAI shape, echoing the last user message", async () => {
    const { status, body } = await call(
      req("POST", "/v1/chat/completions", {
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hello" },
        ],
      }),
    );
    expect(status).toBe(200);
    // Required fields of the OpenAI chat completion object.
    expect(body).toMatchObject({ object: "chat.completion", model: "keylease-mock-1" });
    expect(typeof body["id"]).toBe("string");
    expect(Number.isInteger(body["created"])).toBe(true);
    expect(body["usage"]).toMatchObject({ prompt_tokens: 5, total_tokens: expect.any(Number) as number });
    const choices = body["choices"] as {
      index: number;
      message: { role: string; content: string };
      finish_reason: string;
    }[];
    expect(choices[0]).toMatchObject({ index: 0, finish_reason: "stop", logprobs: null });
    expect(choices[0]?.message).toEqual({ role: "assistant", content: 'mock answer: you said "hello"' });
  });

  it("echoes a JSON body", async () => {
    expect((await call(req("POST", "/echo", { a: 1 }))).body).toEqual({ received: { a: 1 } });
  });

  it("mirrors headers, key included (the tripwire demo endpoint)", async () => {
    const { body } = await call(req("GET", "/debug/headers"));
    expect((body["headers"] as Record<string, string>)["authorization"]).toBe(`Bearer ${KEY}`);
  });

  it("answers HEAD like GET, headers only (curl -I)", async () => {
    const res = await handle(req("HEAD", "/v1/models"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.text()).toBe("");
    expect((await handle(req("HEAD", "/debug/headers"), env)).status).toBe(200);
    expect((await handle(req("HEAD", "/v1/models", undefined, null), env)).status).toBe(401);
    expect((await handle(req("HEAD", "/v1/keys"), env)).status).toBe(404);
    expect((await handle(req("HEAD", "/echo"), env)).status).toBe(404); // POST-only route
  });

  it("refuses unknown routes, bad JSON and large bodies", async () => {
    expect((await call(req("GET", "/v1/keys"))).status).toBe(404);
    expect((await call(req("DELETE", "/echo"))).status).toBe(404);
    expect((await call(req("POST", "/echo", "{not json"))).status).toBe(400);
    expect((await call(req("POST", "/echo", "x".repeat(MAX_BODY + 1)))).status).toBe(413);
  });
});
