import { describe, expect, it } from "vitest";
import { isTestnetAccount, testnetAccountKind } from "../lib/account.ts";

const ETH = "0x020a4366595292aa16184536bab2e9949d0d925f";
const IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

describe("testnet account ids (T9, T22)", () => {
  it("accepts named .testnet, eth-implicit and NEAR implicit ids", () => {
    expect(testnetAccountKind("alice.testnet")).toBe("named");
    expect(testnetAccountKind("kl.alice-1_b.testnet")).toBe("named");
    expect(testnetAccountKind("keylease.keylease-spike-3298edc1.testnet")).toBe("named");
    expect(testnetAccountKind(ETH)).toBe("eth-implicit");
    expect(testnetAccountKind(IMPLICIT)).toBe("near-implicit");
  });

  it("refuses mainnet, uppercase, near-misses and non-strings", () => {
    const bad: unknown[] = [
      "alice.near",
      "testnet",
      ".testnet",
      "a..b.testnet",
      "-a.testnet",
      "a-.testnet",
      "Alice.testnet",
      "alice.testnet ",
      " alice.testnet",
      "alice.testnet\n",
      `${"a".repeat(57)}.testnet`, // 65 chars
      ETH.toUpperCase(),
      `0X${ETH.slice(2)}`,
      `0x${ETH.slice(2).toUpperCase()}`,
      ETH.slice(0, -1), // 39 hex
      `${ETH}0`, // 41 hex
      "0xg20a4366595292aa16184536bab2e9949d0d925f",
      IMPLICIT.toUpperCase(),
      IMPLICIT.slice(0, -1),
      `${IMPLICIT}0`,
      `${IMPLICIT.slice(0, -1)}g`,
      "",
      null,
      undefined,
      42,
      ["alice.testnet"],
      { toString: () => "alice.testnet" },
    ];
    for (const b of bad) {
      expect(testnetAccountKind(b), JSON.stringify(String(b))).toBeNull();
      expect(isTestnetAccount(b)).toBe(false);
    }
  });
});
