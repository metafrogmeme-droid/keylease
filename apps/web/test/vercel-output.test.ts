import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEADERS, writeOutput } from "../scripts/vercel-output.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Vercel build output", () => {
  it("has the static pages, the headers, and a self-contained edge relay that works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kl-vercel-"));
    const out = join(dir, "out");
    mkdirSync(out);
    writeFileSync(join(out, "index.html"), "<html></html>");
    writeFileSync(join(out, "404.html"), "<html>404</html>");
    const dest = join(dir, "output");
    await writeOutput(out, dest);

    expect(readFileSync(join(dest, "static", "index.html"), "utf8")).toBe("<html></html>");
    const config = JSON.parse(readFileSync(join(dest, "config.json"), "utf8")) as {
      version: number;
      routes: { headers?: Record<string, string> }[];
    };
    expect(config.version).toBe(3);
    expect(config.routes[0]?.headers).toEqual(HEADERS);
    expect(HEADERS["content-security-policy"]).toBe("frame-ancestors 'none'");

    const fn = join(dest, "functions", "api", "secrets", "pubkey.func");
    expect(JSON.parse(readFileSync(join(fn, ".vc-config.json"), "utf8"))).toEqual({
      runtime: "edge",
      entrypoint: "index.js",
    });
    const code = readFileSync(join(fn, "index.js"), "utf8");
    expect(code).not.toMatch(/^import /mu); // bundled: no imports at run time
    expect(code).not.toContain("node:");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ pubkey: "cd".repeat(32) })))),
    );
    const mod = (await import(pathToFileURL(join(fn, "index.js")).href)) as {
      default: (r: Request) => Promise<Response>;
    };
    const res = await mod.default(
      new Request("https://kl.example/api/secrets/pubkey", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://kl.example" },
        body: JSON.stringify({
          accessor: { type: "WasmHash", hash: "ab".repeat(32) },
          owner: "alice.testnet",
          profile: "kl-000000000000",
          secrets_json: '{"KL_API_KEY":""}',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pubkey: "cd".repeat(32) });
  });

  it("refuses to run without a static export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kl-vercel-"));
    await expect(writeOutput(join(dir, "missing"), join(dir, "o"))).rejects.toThrow(/static export/);
  });
});
