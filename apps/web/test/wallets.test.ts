import { describe, expect, it } from "vitest";
import { policy } from "../lib/csp.ts";
import { NETWORK, sources, walletOptions } from "../lib/wallets.ts";

const OFF = { reownProjectId: null };
const ON = { reownProjectId: "0123456789abcdef0123456789abcdef" };

describe("wallet options", () => {
  it("offers four NEAR wallets, WalletConnect and MetaMask, in that order", () => {
    expect(walletOptions(OFF).map((o) => o.name)).toEqual([
      "MyNearWallet",
      "Meteor",
      "HOT",
      "Intear",
      "WalletConnect",
      "MetaMask",
    ]);
  });

  it("marks WalletConnect not configured when the Reown project id is empty", () => {
    const wc = walletOptions(OFF).find((o) => o.id === "wallet-connect");
    expect(wc?.configured).toBe(false);
    expect(wc?.note).toContain("not configured");
    expect(walletOptions(ON).find((o) => o.id === "wallet-connect")?.configured).toBe(true);
  });

  it("runs MetaMask on NEAR testnet, chain 398", () => {
    expect(walletOptions(OFF).find((o) => o.id === "ethereum-wallets")?.note).toContain("398");
  });

  it("uses only the testnet RPC for wallet-selector", () => {
    expect(NETWORK.networkId).toBe("testnet");
    expect(NETWORK.nodeUrl).toBe("https://rpc.testnet.near.org");
  });
});

describe("CSP sources (T8)", () => {
  it("names each wallet bridge and nothing for WalletConnect when it is off", () => {
    const s = sources(OFF);
    expect(s.connect).toEqual([
      "'self'",
      "https://rpc.testnet.near.org",
      "https://eth-rpc.testnet.near.org",
      "https://h4n.app",
      "https://logout-bridge-service.intear.tech",
      "wss://logout-bridge-service.intear.tech",
    ]);
    expect(s.frame).toEqual([]);
    expect(s.img).toEqual([]);
    const p = policy([], s);
    expect(p).not.toContain("walletconnect");
    expect(p).not.toContain("frame-src");
  });

  it("adds the WalletConnect relay, verify frame and wallet images only when configured", () => {
    const p = policy([], sources(ON));
    expect(p).toContain("wss://relay.walletconnect.org");
    expect(p).toContain("frame-src https://verify.walletconnect.org https://verify.walletconnect.com");
    expect(p).toContain("img-src 'self' data: https://explorer-api.walletconnect.com");
    expect(p).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("never allows a wildcard host", () => {
    for (const cfg of [OFF, ON]) {
      const s = sources(cfg);
      for (const h of [...s.connect, ...s.frame, ...s.img]) expect(h).not.toContain("*");
    }
  });
});
