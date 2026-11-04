import { describe, expect, it, vi } from "vitest";
import { Limiter, MAX_BODY, UPSTREAM, checkBody, relayPubkey } from "../lib/relay.ts";

const HASH = "95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970";
const GOOD = {
  accessor: { type: "WasmHash", hash: HASH },
  owner: "alice.testnet",
  profile: "kl-0a0b0c0d0e0f",
  secrets_json: '{"KL_API_KEY":""}',
};
const PUB = "ab".repeat(32);

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://keylease.example/api/secrets/pubkey", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://keylease.example", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Fake OutLayer; a fresh Response per call (a body can be read once). */
function upstream(answer: () => Response = () => new Response(JSON.stringify({ pubkey: PUB }))) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(answer()));
}

const deps = (fetcher: ReturnType<typeof upstream>) => ({ fetcher, limiter: new Limiter() });

describe("pubkey relay (E-017, T22)", () => {
  it("forwards a valid request to the one fixed upstream and returns only {pubkey}", async () => {
    const f = upstream(() => new Response(JSON.stringify({ pubkey: PUB, extra: "dropped" })));
    const res = await relayPubkey(post(GOOD), deps(f));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pubkey: PUB });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(UPSTREAM);
    expect(JSON.parse(init?.body as string)).toEqual(GOOD);
    expect(new Headers(init?.headers).get("user-agent")).toBe("keylease-relay");
  });

  it("never carries a key: any non-empty secrets_json value is refused before upstream", async () => {
    const f = upstream();
    for (const sj of ['{"KL_API_KEY":"sk-live-123"}', '{"KL_API_KEY":0}', '{"A":"","B":"x"}']) {
      const res = await relayPubkey(post({ ...GOOD, secrets_json: sj }), deps(f));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).not.toContain("sk-live");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses everything outside the exact shape", () => {
    const bad: unknown[] = [
      null,
      [],
      { ...GOOD, vault_id: "v1" },
      { ...GOOD, accessor: { type: "Repo", hash: HASH } },
      { ...GOOD, accessor: { type: "WasmHash", hash: HASH.toUpperCase() } },
      { ...GOOD, accessor: { type: "WasmHash", hash: HASH, extra: 1 } },
      { ...GOOD, owner: "alice.near" },
      { ...GOOD, owner: "Alice.testnet" },
      { ...GOOD, owner: "0X020A4366595292AA16184536BAB2E9949D0D925F" },
      { ...GOOD, owner: "0x020a4366595292aa16184536bab2e9949d0d925" },
      { ...GOOD, owner: "AB".repeat(32) },
      { ...GOOD, owner: 7 },
      { ...GOOD, profile: "a/b" },
      { ...GOOD, secrets_json: "{}" },
      { ...GOOD, secrets_json: "[]" },
      { ...GOOD, secrets_json: '{"lower":""}' },
      { ...GOOD, secrets_json: "not json" },
    ];
    for (const b of bad) expect(typeof checkBody(b), JSON.stringify(b)).toBe("string");
    expect(checkBody(GOOD)).toEqual(GOOD);
  });

  it("accepts MetaMask (eth-implicit) and NEAR implicit owners and forwards them unchanged", async () => {
    for (const owner of ["0x020a4366595292aa16184536bab2e9949d0d925f", "ab".repeat(32)]) {
      const f = upstream();
      const res = await relayPubkey(post({ ...GOOD, owner }), deps(f));
      expect(res.status, owner).toBe(200);
      expect((JSON.parse(f.mock.calls[0]?.[1]?.body as string) as { owner: string }).owner).toBe(owner);
    }
  });

  it("is not an open proxy: method, origin, content type and size are checked", async () => {
    const f = upstream();
    const get = new Request("https://keylease.example/api/secrets/pubkey");
    expect((await relayPubkey(get, deps(f))).status).toBe(405);
    expect((await relayPubkey(post(GOOD, { origin: "https://evil.example" }), deps(f))).status).toBe(403);
    expect((await relayPubkey(post(GOOD, { "sec-fetch-site": "cross-site" }), deps(f))).status).toBe(403);
    expect((await relayPubkey(post(GOOD, { "content-type": "text/plain" }), deps(f))).status).toBe(415);
    const big = JSON.stringify({ ...GOOD, profile: "x".repeat(MAX_BODY) });
    expect((await relayPubkey(post(big), deps(f))).status).toBe(413);
    expect((await relayPubkey(post("{"), deps(f))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("limits each client per minute", async () => {
    const limiter = new Limiter(2, 60_000);
    let t = 0;
    const d = { fetcher: upstream(), limiter, now: () => t };
    const ip = { "x-real-ip": "203.0.113.7" };
    expect((await relayPubkey(post(GOOD, ip), d)).status).toBe(200);
    expect((await relayPubkey(post(GOOD, ip), d)).status).toBe(200);
    expect((await relayPubkey(post(GOOD, ip), d)).status).toBe(429);
    expect((await relayPubkey(post(GOOD, { "x-real-ip": "203.0.113.8" }), d)).status).toBe(200);
    t = 60_000;
    expect((await relayPubkey(post(GOOD, ip), d)).status).toBe(200);
  });

  it("reports upstream trouble without passing upstream bodies through", async () => {
    const down = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect((await relayPubkey(post(GOOD), { fetcher: down, limiter: new Limiter() })).status).toBe(502);
    const r422 = await relayPubkey(
      post(GOOD),
      deps(upstream(() => new Response("internal detail", { status: 422 }))),
    );
    expect(r422.status).toBe(502);
    expect(await r422.text()).not.toContain("internal detail");
    const junk = await relayPubkey(
      post(GOOD),
      deps(upstream(() => new Response(JSON.stringify({ pubkey: "zz" })))),
    );
    expect(junk.status).toBe(502);
  });
});
