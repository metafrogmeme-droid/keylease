import { describe, expect, it } from "vitest";
import { leaseLock } from "../src/conditions.ts";
import { fetchKeystorePubkey, pubkeyRequest, secretsJson, storeSecretsArgs } from "../src/secrets.ts";

const H = "95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970";
const KEY = ["demo", "-", "x".repeat(20)].join("");

describe("sealing a key", () => {
  it("puts the key under the env name the proxy reads", () => {
    expect(JSON.parse(secretsJson(KEY))).toEqual({ KL_API_KEY: KEY });
    expect(() => secretsJson(" ")).toThrow(/empty/u);
  });

  it("asks the keystore for the WasmHash row of the proxy build, sending env names only (T8)", () => {
    const req = pubkeyRequest("alice.testnet", "main", H);
    expect(req).toEqual({
      accessor: { type: "WasmHash", hash: H },
      owner: "alice.testnet",
      profile: "main",
      secrets_json: '{"KL_API_KEY":""}',
    });
    expect(JSON.stringify(req)).not.toContain(KEY);
    expect(pubkeyRequest("a", "p", H, ["A", "B"]).secrets_json).toBe('{"A":"","B":""}');
    expect(() => pubkeyRequest("a", "p", "AB".repeat(32))).toThrow();
  });

  it("stores under accessor WasmHash with the lease lock and vault_id null", () => {
    const lock = leaseLock("keylease.alice.testnet", H);
    expect(storeSecretsArgs(H, "main", "ENVELOPE", lock)).toEqual({
      accessor: { WasmHash: { hash: H } },
      profile: "main",
      encrypted_secrets_base64: "ENVELOPE",
      access: lock,
      vault_id: null,
    });
  });

  it("sends a User-Agent only when asked (CLI yes, browser no)", async () => {
    const seen: (string | null)[] = [];
    const spy = (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("user-agent"));
      return Promise.resolve(new Response(JSON.stringify({ pubkey: "ab".repeat(32) })));
    };
    await fetchKeystorePubkey("https://api.example", pubkeyRequest("a", "p", H), spy);
    await fetchKeystorePubkey("https://api.example", pubkeyRequest("a", "p", H), spy, "keylease-cli");
    expect(seen).toEqual([null, "keylease-cli"]);
  });

  it("reads and checks the keystore public key", async () => {
    const ok = () => Promise.resolve(new Response(JSON.stringify({ pubkey: "ab".repeat(32) })));
    expect(await fetchKeystorePubkey("https://api.example", pubkeyRequest("a", "p", H), ok)).toBe(
      "ab".repeat(32),
    );
    const bad = () => Promise.resolve(new Response(JSON.stringify({ pubkey: "zz" })));
    await expect(
      fetchKeystorePubkey("https://api.example", pubkeyRequest("a", "p", H), bad),
    ).rejects.toThrow();
    const err = () => Promise.resolve(new Response("nope", { status: 403 }));
    await expect(fetchKeystorePubkey("https://api.example", pubkeyRequest("a", "p", H), err)).rejects.toThrow(
      /403/u,
    );
  });
});
