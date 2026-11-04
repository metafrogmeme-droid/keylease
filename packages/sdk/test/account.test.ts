import { describe, expect, it } from "vitest";
import { isTestnetAccount, parseTestnetAccount, testnetAccountKind } from "../src/account.ts";

const ETH = "0x020a4366595292aa16184536bab2e9949d0d925f";
const IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
const ok = (raw: string) => {
  const r = parseTestnetAccount(raw);
  if (!("id" in r)) throw new Error(`refused ${raw}: ${r.error}`);
  return r.id;
};
const err = (raw: string) => {
  const r = parseTestnetAccount(raw);
  if ("id" in r) throw new Error(`accepted ${raw} as ${r.id}`);
  return r.error;
};

describe("parseTestnetAccount: one rule for grantees, Key Pass receivers and the CLI", () => {
  it("accepts named .testnet accounts as they are", () => {
    expect(ok("alice.testnet")).toBe("alice.testnet");
    expect(ok("kl.alice-1_b.testnet")).toBe("kl.alice-1_b.testnet");
  });

  it("accepts 0x eth-implicit accounts and normalises mixed case to lowercase", () => {
    expect(ok(ETH)).toBe(ETH);
    expect(ok("0x020A4366595292aa16184536BAB2e9949d0d925F")).toBe(ETH); // EIP-55 style
    expect(ok(`0x${ETH.slice(2).toUpperCase()}`)).toBe(ETH);
  });

  it("refuses 0x with the wrong length or non-hex digits, saying what an EVM address is", () => {
    for (const bad of [
      ETH.slice(0, -1),
      `${ETH}0`,
      "0xg20a4366595292aa16184536bab2e9949d0d925f",
      "0x",
      "0X" + ETH.slice(2),
    ])
      expect(err(bad)).toMatch(/0x and 40 hex digits/);
  });

  it("accepts 64-hex NEAR implicit accounts", () => {
    expect(ok(IMPLICIT)).toBe(IMPLICIT);
    expect(testnetAccountKind(IMPLICIT)).toBe("near-implicit");
  });

  it("refuses mainnet-style .near names", () => {
    expect(err("alice.near")).toMatch(/mainnet/i);
    expect(err("kl.alice.near")).toMatch(/mainnet/i);
  });

  it("refuses an empty string and whitespace; trims around a valid id", () => {
    expect(err("")).toMatch(/give an account/i);
    expect(err("   ")).toMatch(/give an account/i);
    expect(err("\t\n")).toMatch(/give an account/i);
    expect(err("alice .testnet")).toMatch(/not a NEAR testnet account/);
    expect(ok("  alice.testnet\n")).toBe("alice.testnet");
    expect(ok(` ${ETH.toUpperCase().replace("0X", "0x")} `)).toBe(ETH);
  });

  it("refuses everything else plainly: uppercase names, top-level names, near misses", () => {
    for (const bad of [
      "Alice.testnet",
      "testnet",
      "alice",
      "a..b.testnet",
      "-a.testnet",
      `${"a".repeat(57)}.testnet`,
      IMPLICIT.slice(0, -1),
      IMPLICIT.toUpperCase(),
    ])
      expect(err(bad)).toMatch(/not a NEAR testnet account/);
  });

  it("keeps the strict check for owners (no trimming, lowercase only)", () => {
    expect(isTestnetAccount(ETH)).toBe(true);
    expect(isTestnetAccount(ETH.toUpperCase())).toBe(false);
    expect(isTestnetAccount(" alice.testnet")).toBe(false);
  });
});
