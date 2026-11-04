import { generateKeyPairSync } from "node:crypto";
import { leaseLock, open, rawPublic } from "@keylease/outlayer";
import { describe, expect, it } from "vitest";
import { ADD_KEY_DEPOSIT, KeystoreUnreachable, keyTransactions } from "../lib/addkey.ts";
import { parseConfig } from "../lib/config.ts";
import type { Fetch } from "../lib/near-rpc.ts";

const cfg = parseConfig({ contractId: "keylease.alice.testnet" });
const HASH = "95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970";
const KEY = ["demo", "key", "x".repeat(24)].join("-");
const FORM = { provider: "OpenAiCompatible", baseUrl: "https://mock.example/v1", label: "demo" } as const;

function keystore() {
  const pair = generateKeyPairSync("x25519");
  return {
    scalar: pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    pubHex: rawPublic(pair.publicKey).toString("hex"),
  };
}

const rpcAnswer = (value: unknown) =>
  new Response(JSON.stringify({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } }));

/** Fake RPC + OutLayer API that records every request body. */
function fakeNet(pubHex: string) {
  const sent: { url: string; body: string }[] = [];
  const fetcher: Fetch = (url, init) => {
    const body = typeof init.body === "string" ? init.body : "";
    sent.push({ url, body });
    if (url.endsWith("/secrets/pubkey"))
      return Promise.resolve(new Response(JSON.stringify({ pubkey: pubHex })));
    const params = (JSON.parse(body) as { params: { method_name: string } }).params;
    if (params.method_name === "get_config")
      return Promise.resolve(rpcAnswer({ outlayer: "outlayer.testnet", proxy_hash: HASH }));
    if (params.method_name === "estimate_storage_cost")
      return Promise.resolve(rpcAnswer("1230000000000000000000"));
    return Promise.reject(new Error(`unexpected ${params.method_name}`));
  };
  return { sent, fetcher };
}

function fnCall(a: unknown) {
  const f = (a as { functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } })
    .functionCall;
  return { ...f, json: JSON.parse(new TextDecoder().decode(f.args)) as Record<string, unknown> };
}

describe("Add key in the browser (T8)", () => {
  it("seals the key so only the keystore opens it, and the key never travels unencrypted", async () => {
    const ks = keystore();
    const net = fakeNet(ks.pubHex);
    const built = await keyTransactions(cfg, "alice.testnet", FORM, KEY, {
      fetcher: net.fetcher,
      profile: () => "kl-0a0b0c0d0e0f",
    });

    for (const r of net.sent) expect(r.body).not.toContain(KEY);
    const pubkeyReq = net.sent.find((r) => r.url === "/api/secrets/pubkey");
    expect(JSON.parse(pubkeyReq?.body ?? "{}")).toMatchObject({
      owner: "alice.testnet",
      profile: "kl-0a0b0c0d0e0f",
      secrets_json: '{"KL_API_KEY":""}',
    });

    const [store, add] = built.transactions;
    expect(store?.receiverId).toBe("outlayer.testnet");
    const s = fnCall(store?.actions[0]);
    expect(s.methodName).toBe("store_secrets");
    expect(s.deposit).toBe(1230000000000000000000n);
    expect(s.json["access"]).toEqual(leaseLock("keylease.alice.testnet", HASH));
    expect(s.json["accessor"]).toEqual({ WasmHash: { hash: HASH } });
    const opened = open(ks.scalar, s.json["encrypted_secrets_base64"] as string).toString("utf8");
    expect(JSON.parse(opened)).toEqual({ KL_API_KEY: KEY });

    expect(add?.receiverId).toBe("keylease.alice.testnet");
    const a = fnCall(add?.actions[0]);
    expect(a.methodName).toBe("add_key");
    expect(a.deposit).toBe(ADD_KEY_DEPOSIT);
    expect(a.json).toEqual({
      provider: "OpenAiCompatible",
      base_url: "https://mock.example/v1",
      secret_profile: "kl-0a0b0c0d0e0f",
      label: "demo",
    });
    expect(JSON.stringify(a.json)).not.toContain(KEY);
  });

  it("refuses a bad form before anything is sent", async () => {
    const net = fakeNet(keystore().pubHex);
    await expect(keyTransactions(cfg, "a.testnet", FORM, " ", { fetcher: net.fetcher })).rejects.toThrow(
      /Paste/,
    );
    await expect(
      keyTransactions(cfg, "a.testnet", { ...FORM, baseUrl: "http://x" }, KEY, { fetcher: net.fetcher }),
    ).rejects.toThrow(/https/);
    expect(net.sent).toEqual([]);
  });

  it("builds the same two transactions for a MetaMask (eth-implicit) owner, and refuses a bad owner first", async () => {
    const owner = "0x020a4366595292aa16184536bab2e9949d0d925f";
    const net = fakeNet(keystore().pubHex);
    const built = await keyTransactions(cfg, owner, FORM, KEY, { fetcher: net.fetcher });
    expect(built.transactions.map((t) => t.receiverId)).toEqual([
      "outlayer.testnet",
      "keylease.alice.testnet",
    ]);
    const pubkeyReq = net.sent.find((r) => r.url === "/api/secrets/pubkey");
    expect((JSON.parse(pubkeyReq?.body ?? "{}") as { owner: string }).owner).toBe(owner);
    const quote = net.sent.find((r) => r.body.includes("estimate_storage_cost"));
    expect(quote).toBeDefined();

    const quiet = fakeNet(keystore().pubHex);
    for (const bad of ["alice.near", owner.toUpperCase(), ""])
      await expect(keyTransactions(cfg, bad, FORM, KEY, { fetcher: quiet.fetcher })).rejects.toThrow(
        /testnet account/,
      );
    expect(quiet.sent).toEqual([]);
  });

  it("says plainly when the keystore cannot be reached from the page (CORS, Q-011)", async () => {
    const net = fakeNet(keystore().pubHex);
    const blocked: Fetch = (url, init) =>
      url.endsWith("/secrets/pubkey")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : net.fetcher(url, init);
    await expect(keyTransactions(cfg, "a.testnet", FORM, KEY, { fetcher: blocked })).rejects.toBeInstanceOf(
      KeystoreUnreachable,
    );
  });
});
