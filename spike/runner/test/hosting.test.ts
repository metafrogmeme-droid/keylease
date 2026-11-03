import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkHosted, fetchLikeWorker, flag, urlProblem, type Fetcher } from "../src/hosting.ts";

const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
const SHA = createHash("sha256").update(WASM).digest("hex");

/** A fake web: url -> response. */
function web(routes: Record<string, () => Response>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (url: string) => {
    calls.push(url);
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
  };
  return Object.assign(f, { calls });
}

const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
const ok = (body: Uint8Array) => () => new Response(body, { status: 200 });

describe("URL rules (same as OutLayer's worker)", () => {
  it.each([
    ["https://files.example.org/a.wasm", undefined],
    ["http://files.example.org/a.wasm", "must be https://"],
    ["https://files.example.org:8443/a.wasm", "must use the default port (443)"],
    ["https://user:pw@files.example.org/a.wasm", "must not carry credentials"],
    ["not a url", "not a valid URL"],
  ])("%s", (url, problem) => {
    expect(urlProblem(url)).toBe(problem);
  });
});

describe("fetch like the worker", () => {
  it("follows up to 3 redirects, each checked", async () => {
    const f = web({
      "https://a.example/x": redirect("https://b.example/y"),
      "https://b.example/y": redirect("/z"),
      "https://b.example/z": ok(WASM),
    });
    expect(await fetchLikeWorker("https://a.example/x", f)).toEqual(WASM);
    expect(f.calls).toEqual(["https://a.example/x", "https://b.example/y", "https://b.example/z"]);
  });

  it("refuses a 4th redirect", async () => {
    const f = web({
      "https://a.example/0": redirect("https://a.example/1"),
      "https://a.example/1": redirect("https://a.example/2"),
      "https://a.example/2": redirect("https://a.example/3"),
      "https://a.example/3": redirect("https://a.example/4"),
    });
    await expect(fetchLikeWorker("https://a.example/0", f)).rejects.toThrow(/more than 3/u);
  });

  it("refuses a redirect to plain http", async () => {
    const f = web({ "https://a.example/x": redirect("http://a.example/x") });
    await expect(fetchLikeWorker("https://a.example/x", f)).rejects.toThrow(/https/u);
  });

  it("reports an HTTP error such as a private repo's 404", async () => {
    await expect(fetchLikeWorker("https://a.example/private.wasm", web({}))).rejects.toThrow(/HTTP 404/u);
  });
});

describe("preflight of a self-hosted build", () => {
  it("passes when the bytes match the local build", async () => {
    await checkHosted("https://a.example/p.wasm", SHA, web({ "https://a.example/p.wasm": ok(WASM) }));
  });

  it("fails when the host serves other bytes", async () => {
    const f = web({ "https://a.example/p.wasm": ok(new Uint8Array([1, 2, 3])) });
    await expect(checkHosted("https://a.example/p.wasm", SHA, f)).rejects.toThrow(/serves sha256/u);
  });
});

describe("flags", () => {
  it("reads --name value and --name=value", () => {
    expect(flag(["--apply", "--wasm-url-a", "https://x/a"], "--wasm-url-a")).toBe("https://x/a");
    expect(flag(["--wasm-url-b=https://x/b"], "--wasm-url-b")).toBe("https://x/b");
    expect(flag(["--apply"], "--wasm-url-a")).toBeUndefined();
  });
});
