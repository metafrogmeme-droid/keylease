import { describe, expect, it } from "vitest";
import { DEMO_HEADER, mockPath, serveMock } from "../lib/mock-edge.ts";
import { Limiter, MAX_BODY } from "../lib/relay.ts";

const KEY = ["demo", "only", "z".repeat(16)].join("-");
const auth = { authorization: `Bearer ${KEY}` };
const deps = () => ({ key: KEY, limiter: new Limiter() });

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://kl.example${path}`, init);
}

describe("demo API on the web host", () => {
  it("reads the path from the original or the rewritten URL", () => {
    expect(mockPath(new URL("https://h/mock/v1/models"))).toBe("/v1/models");
    expect(mockPath(new URL("https://h/mock"))).toBe("/");
    expect(mockPath(new URL("https://h/api/mock?path=v1/models"))).toBe("/v1/models");
    expect(mockPath(new URL("https://h/api/mock?path=/v1/models"))).toBe("/v1/models");
    expect(mockPath(new URL("https://h/api/mock"))).toBeNull();
  });

  it("serves the mock API under /mock with the key, marked as a demo", async () => {
    const res = await serveMock(req("/mock/v1/models", { headers: auth }), deps());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { id: string }[] }).data[0]?.id).toBe("keylease-mock-1");
    expect(res.headers.get(DEMO_HEADER)).toMatch(/mock API/);
    const rewritten = await serveMock(req("/api/mock?path=v1/models", { headers: auth }), deps());
    expect(rewritten.status).toBe(200);
  });

  it("answers HEAD /mock/v1/models like GET, marked as a demo (curl -I)", async () => {
    const res = await serveMock(req("/mock/v1/models", { method: "HEAD", headers: auth }), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get(DEMO_HEADER)).toMatch(/mock API/);
    expect(await res.text()).toBe("");
  });

  it("refuses without the key, and without a key configured on the host", async () => {
    expect((await serveMock(req("/mock/v1/models"), deps())).status).toBe(401);
    const unset = await serveMock(req("/mock/v1/models", { headers: auth }), {
      key: undefined,
      limiter: new Limiter(),
    });
    expect(unset.status).toBe(500);
    expect(unset.headers.get(DEMO_HEADER)).not.toBeNull();
  });

  it("has the relay's limits: 2 KB bodies, per-IP rate, no cross-site browsers", async () => {
    const big = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(MAX_BODY) }] });
    const post = { method: "POST", headers: { ...auth, "content-type": "application/json" } };
    expect((await serveMock(req("/mock/v1/chat/completions", { ...post, body: big }), deps())).status).toBe(
      413,
    );
    const small = JSON.stringify({ model: "keylease-mock-1", messages: [{ role: "user", content: "hi" }] });
    expect((await serveMock(req("/mock/v1/chat/completions", { ...post, body: small }), deps())).status).toBe(
      200,
    );
    const cross = req("/mock/v1/models", { headers: { ...auth, origin: "https://evil.example" } });
    expect((await serveMock(cross, deps())).status).toBe(403);
    const limited = { key: KEY, limiter: new Limiter(1, 60_000), now: () => 0 };
    const ip = { ...auth, "x-real-ip": "198.51.100.1" };
    expect((await serveMock(req("/mock/v1/models", { headers: ip }), limited)).status).toBe(200);
    expect((await serveMock(req("/mock/v1/models", { headers: ip }), limited)).status).toBe(429);
  });
});
