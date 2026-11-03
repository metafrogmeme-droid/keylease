import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestSelector } from "../lib/no-test-wallet.ts";
import { TEST_WALLET_MARKER, createTestSelector as realTestSelector } from "../lib/test-wallet.ts";

const script = new URL("../scripts/check-release.ts", import.meta.url).pathname;

function build(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "kl-release-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("the test wallet never ships", () => {
  it("release builds get a stub that refuses to run", () => {
    expect(() => createTestSelector()).toThrow(/not part of this build/);
  });

  it("check:release fails a build that contains the test wallet, passes one without", () => {
    const bad = build({
      "index.html": "<html></html>",
      "_next/static/chunks/a.js": `x="${TEST_WALLET_MARKER}"`,
    });
    expect(() => execFileSync("node", [script, bad], { stdio: "pipe" })).toThrow();
    const good = build({ "index.html": "<html></html>", "_next/static/chunks/a.js": "x=1" });
    expect(execFileSync("node", [script, good], { stdio: "pipe" }).toString()).toBe("");
  });

  it("the test wallet answers like the chain, signs nothing", async () => {
    const s = realTestSelector();
    const w = await s.wallet();
    const out = await w.signAndSendTransactions({
      transactions: [{ actions: [{ functionCall: { methodName: "create_lease" } }] }],
    });
    expect(atob(out[0]?.status.SuccessValue ?? "")).toBe('"0"');
  });
});
