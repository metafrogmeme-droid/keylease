import { describe, expect, it } from "vitest";
import { durationNs, settings } from "../src/env.ts";
import { callNumber, line, refusal, short, txLink } from "../src/format.ts";

describe("settings", () => {
  it("defaults to testnet and derives the contract id", () => {
    const s = settings({ NEAR_ACCOUNT_ID: "alice.testnet" });
    expect(s).toMatchObject({
      rpc: "https://rpc.testnet.near.org",
      outlayer: "outlayer.testnet",
      api: "https://testnet-api.outlayer.ai",
      contract: "keylease.alice.testnet",
    });
  });

  it.each([
    [{ NEAR_ACCOUNT_ID: "alice.near" }, /NEAR_ACCOUNT_ID/u],
    [{ OUTLAYER_CONTRACT_ID: "outlayer.near" }, /OUTLAYER_CONTRACT_ID/u],
    [{ NEAR_ACCOUNT_ID: "alice.testnet", KEYLEASE_CONTRACT_ID: "kl.near" }, /KEYLEASE_CONTRACT_ID/u],
  ])("refuses mainnet ids %#", (env, msg) => {
    expect(() => settings(env)).toThrow(msg);
  });
});

describe("durations", () => {
  it.each([
    ["30m", 1_800_000_000_000n],
    ["1h", 3_600_000_000_000n],
    ["7d", 604_800_000_000_000n],
  ])("%s", (text, ns) => {
    expect(durationNs(text)).toBe(ns);
  });

  it("refuses other shapes", () => {
    expect(() => durationNs("1 h")).toThrow();
    expect(() => durationNs("1w")).toThrow();
  });
});

describe("output", () => {
  it("prints fixed label columns and nearblocks links", () => {
    expect(line("lease", "7")).toBe("lease      7");
    expect(txLink("Abc")).toBe("https://testnet.nearblocks.io/txns/Abc");
  });

  it("reads a KeyLease refusal from a failed transaction", () => {
    const failure = JSON.stringify({
      ActionError: {
        kind: {
          FunctionCallError: {
            ExecutionError:
              "Smart contract panicked: quota_used: All calls in this lease are used; ask the key owner for more calls.",
          },
        },
      },
    });
    expect(refusal(failure)).toEqual({
      code: "quota_used",
      hint: "All calls in this lease are used; ask the key owner for more calls.",
    });
    expect(refusal("Smart contract panicked: attach at least 25 mNEAR")).toBeUndefined();
  });

  it("finds the call number in the call_authorized event", () => {
    const ev = (standard: string, event: string) =>
      `EVENT_JSON:${JSON.stringify({ standard, version: "0.1.0", event, data: [{ call: 3 }] })}`;
    expect(callNumber(["x", ev("near-outlayer", "call_authorized"), ev("keylease", "call_authorized")])).toBe(
      3,
    );
    expect(callNumber(["x"])).toBeUndefined();
  });

  it("shortens long answers to one line", () => {
    expect(short("a\n b", 10)).toBe("a b");
    expect(short("x".repeat(12), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
