import { describe, expect, it } from "vitest";
import { parseConfig } from "../lib/config.ts";

describe("parseConfig (T9: testnet only)", () => {
  it("defaults to testnet, WalletConnect not configured", () => {
    expect(parseConfig({ contractId: "keylease.demo-1.testnet" })).toEqual({
      network: "testnet",
      contractId: "keylease.demo-1.testnet",
      rpcUrl: "https://rpc.testnet.near.org",
      pubkeyRelay: "/api",
      reownProjectId: null,
    });
  });

  it("fails loudly when the contract id is missing (no silent keylease.testnet fallback)", () => {
    for (const contractId of [undefined, "", "   "])
      expect(() => parseConfig({ contractId })).toThrow(/NEXT_PUBLIC_KEYLEASE_CONTRACT_ID is not set/);
  });

  it("refuses any network but testnet", () => {
    expect(() => parseConfig({ network: "mainnet" })).toThrow(/NEXT_PUBLIC_NEAR_NETWORK must be testnet/);
  });

  it("refuses a contract that is not a .testnet account", () => {
    for (const contractId of ["keylease.near", "Keylease.testnet", "a..testnet", "x"]) {
      expect(() => parseConfig({ contractId })).toThrow(/NEXT_PUBLIC_KEYLEASE_CONTRACT_ID/);
    }
    expect(parseConfig({ contractId: "keylease.demo-1.testnet" }).contractId).toBe("keylease.demo-1.testnet");
  });

  it("treats an empty or blank Reown project id as not configured", () => {
    expect(
      parseConfig({ contractId: "keylease.demo-1.testnet", reownProjectId: "" }).reownProjectId,
    ).toBeNull();
    expect(
      parseConfig({ contractId: "keylease.demo-1.testnet", reownProjectId: "  " }).reownProjectId,
    ).toBeNull();
    const id = "0123456789abcdef0123456789abcdef";
    expect(parseConfig({ contractId: "keylease.demo-1.testnet", reownProjectId: id }).reownProjectId).toBe(
      id,
    );
    expect(() => parseConfig({ contractId: "keylease.demo-1.testnet", reownProjectId: "not-an-id" })).toThrow(
      /32 hex/,
    );
  });
});
