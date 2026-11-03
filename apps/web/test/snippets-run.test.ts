/**
 * The Share snippets match the real packages: the SDK snippet runs as written against @keylease/sdk
 * (with a fake chain), and every name it imports exists.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as sdk from "@keylease/sdk";
import { sdkSnippet } from "../lib/snippets.ts";

const seen: { method: string; args: Record<string, unknown> }[] = [];

vi.mock("@keylease/sdk", async (original) => {
  const real = await original<typeof import("@keylease/sdk")>();
  const transport: import("@keylease/sdk").Transport = {
    account: "agent.testnet",
    view: () => Promise.reject(new Error("no views in this test")),
    call: (_c, method, args) => {
      seen.push({ method, args: args as Record<string, unknown> });
      return Promise.resolve({
        hash: "SnippetTx",
        value: {
          v: 1,
          ok: true,
          status: 200,
          body: '{"ok":1}',
          body_encoding: "utf8",
          body_sha256: "",
          redacted: false,
        },
        logs: [],
      });
    },
  };
  return { ...real, lease: (o: import("@keylease/sdk").LeaseOptions) => real.lease({ ...o, transport }) };
});

const info = {
  origin: "https://kl.example",
  contractId: "keylease.alice.testnet",
  leaseId: "7",
  grantee: "agent.testnet",
  endpoint: "/chat/completions",
};

describe("Share snippets match the real packages", () => {
  it("the SDK snippet imports only names @keylease/sdk exports", () => {
    const imported = /import \{ ([^}]+) \} from "@keylease\/sdk"/u
      .exec(sdkSnippet(info))?.[1]
      ?.split(",")
      .map((s) => s.trim());
    expect(imported?.length).toBeGreaterThan(0);
    for (const name of imported ?? []) expect(Object.keys(sdk), name).toContain(name);
  });

  it("the SDK snippet runs as written and makes one leased call", async () => {
    const code = sdkSnippet(info)
      .split("\n")
      .filter((l) => !l.startsWith("npm "))
      .join("\n")
      .replace("{ /* request body */ }", '{ messages: [{ role: "user", content: "hi" }] }');
    const dir = new URL("./.tmp/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    const file = new URL(`snippet-${String(Date.now())}.ts`, dir);
    writeFileSync(file, code);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await import(file.href);
    } finally {
      rmSync(file);
    }
    expect(seen).toEqual([
      {
        method: "use_lease",
        args: {
          lease_id: "7",
          endpoint: "/chat/completions",
          method: "POST",
          body: '{"messages":[{"role":"user","content":"hi"}]}',
        },
      },
    ]);
    expect(log).toHaveBeenCalledWith({ ok: 1 }, "https://testnet.nearblocks.io/txns/SnippetTx");
    log.mockRestore();
  });
});
