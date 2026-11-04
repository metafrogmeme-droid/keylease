import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_RPC, installRpcRetry, isTransient, RPC_URLS, view, type Fetch } from "../lib/near-rpc.ts";

const PRIMARY = "https://rpc.testnet.near.org";
const result = (v: unknown) =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "kl",
      result: { result: [...new TextEncoder().encode(JSON.stringify(v))] },
    }),
  );
const rpcError = (cause: string) =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id: "kl", error: { name: "HANDLER_ERROR", cause: { name: cause } } }),
  );
const accessKey = { nonce: 7, permission: "FullAccess", block_height: 1, block_hash: "x" };
const query = (request_type: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: { request_type, finality: "final", account_id: "0xabc", public_key: "ed25519:x" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NEAR RPC: primary plus FastNear fallback", () => {
  it("lists the primary first, then the fallback", () => {
    expect(RPC_URLS).toEqual([PRIMARY, FALLBACK_RPC]);
    expect(FALLBACK_RPC).toBe("https://test.rpc.fastnear.com");
  });

  it("knows a transient failure from a real answer", async () => {
    expect(await isTransient(new Response("", { status: 503 }))).toBe(true);
    expect(await isTransient(new Response("", { status: 429 }))).toBe(true);
    expect(await isTransient(rpcError("TIMEOUT_ERROR"))).toBe(true);
    expect(await isTransient(rpcError("UNKNOWN_ACCESS_KEY"))).toBe(false);
    expect(await isTransient(rpcError("UNKNOWN_ACCOUNT"))).toBe(false);
    expect(await isTransient(result(1))).toBe(false);
    expect(await isTransient(new Response("", { status: 400 }))).toBe(false);
  });

  it("view(): one call to the primary when it answers", async () => {
    const f = vi.fn<Fetch>(() => Promise.resolve(result({ ok: 1 })));
    expect(await view(PRIMARY, "kl.testnet", "get_lease", {}, f)).toEqual({ ok: 1 });
    expect(f.mock.calls.map((c) => c[0])).toEqual([PRIMARY]);
  });

  it("view(): a transient failure on the primary is answered by the fallback, once", async () => {
    for (const fail of [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(new Response("", { status: 502 })),
      () => Promise.resolve(rpcError("TIMEOUT_ERROR")),
    ]) {
      const f = vi
        .fn<Fetch>()
        .mockImplementationOnce(fail)
        .mockImplementationOnce(() => Promise.resolve(result({ ok: 2 })));
      expect(await view(PRIMARY, "kl.testnet", "get_lease", {}, f)).toEqual({ ok: 2 });
      expect(f.mock.calls.map((c) => c[0])).toEqual([PRIMARY, FALLBACK_RPC]);
    }
  });

  it("view(): fails plainly when both are down, and does not retry a real error", async () => {
    const down = vi.fn<Fetch>(() => Promise.resolve(new Response("", { status: 503 })));
    await expect(view(PRIMARY, "kl.testnet", "get_lease", {}, down)).rejects.toThrow(/503/);
    expect(down).toHaveBeenCalledTimes(2);
    const real = vi.fn<Fetch>(() => Promise.resolve(rpcError("UNKNOWN_ACCOUNT")));
    await expect(view(PRIMARY, "kl.testnet", "get_lease", {}, real)).rejects.toThrow(/UNKNOWN_ACCOUNT/);
    expect(real).toHaveBeenCalledTimes(1);
  });
});

describe("wallet modules' RPC calls: view_access_key retried once on the fallback", () => {
  function install(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    const inner = vi.fn(impl);
    const win = { fetch: inner as unknown as typeof fetch };
    installRpcRetry(win);
    return { win, inner };
  }

  it("a transient failure of view_access_key is retried once against the fallback", async () => {
    const { win, inner } = install((url) =>
      Promise.resolve(
        url === PRIMARY
          ? new Response("", { status: 503 })
          : new Response(JSON.stringify({ result: accessKey })),
      ),
    );
    const res = await win.fetch(PRIMARY, { method: "POST", body: query("view_access_key") });
    expect(((await res.json()) as { result: unknown }).result).toEqual(accessKey);
    expect(inner.mock.calls.map((c) => c[0])).toEqual([PRIMARY, FALLBACK_RPC]);
  });

  it("a network error is retried too; a second failure is passed on (no loop)", async () => {
    const { win, inner } = install(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(win.fetch(PRIMARY, { method: "POST", body: query("view_access_key") })).rejects.toThrow(
      /Failed to fetch/,
    );
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("a real answer (UNKNOWN_ACCESS_KEY) and anything that is not a query are passed through untouched", async () => {
    const { win, inner } = install(() => Promise.resolve(rpcError("UNKNOWN_ACCESS_KEY")));
    await win.fetch(PRIMARY, { method: "POST", body: query("view_access_key") });
    expect(inner).toHaveBeenCalledTimes(1);
    const tx = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "broadcast_tx_commit", params: ["AAAA"] });
    const down = install(() => Promise.resolve(new Response("", { status: 503 })));
    await down.win.fetch(PRIMARY, { method: "POST", body: tx });
    expect(down.inner).toHaveBeenCalledTimes(1); // transactions are never re-sent
    await down.win.fetch("https://h4n.app/x", { method: "POST", body: query("view_access_key") });
    expect(down.inner.mock.calls.at(-1)?.[0]).toBe("https://h4n.app/x"); // other hosts untouched
  });

  it("installs once", () => {
    const inner = vi.fn<Fetch>(() => Promise.resolve(new Response("{}")));
    const win = { fetch: inner as unknown as typeof fetch };
    installRpcRetry(win);
    const first = win.fetch;
    installRpcRetry(win);
    expect(win.fetch).toBe(first);
  });
});
