import { describe, expect, it } from "vitest";
import { policy } from "../lib/csp.ts";
import { RPC_URLS } from "../lib/near-rpc.ts";
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

  it("runs MetaMask on NEAR testnet, chain 398, where the browser has it", () => {
    const mm = walletOptions(OFF, { injected: true }).find((o) => o.id === "ethereum-wallets");
    expect(mm?.note).toContain("398");
    expect(mm?.configured).toBe(true);
  });

  it("MetaMask's own browser: WalletConnect hidden, MetaMask first and recommended", () => {
    const opts = walletOptions(ON, { injected: true });
    expect(opts.map((o) => o.id)).not.toContain("wallet-connect");
    expect(opts[0]?.id).toBe("ethereum-wallets");
    expect(opts[0]?.recommended).toBe(true);
    expect(opts.filter((o) => o.recommended)).toHaveLength(1);
  });

  it("no MetaMask in this browser: MetaMask greyed out, pointing at its app browser or WalletConnect", () => {
    const mm = walletOptions(ON).find((o) => o.id === "ethereum-wallets");
    expect(mm?.configured).toBe(false);
    expect(mm?.note).toBe("Open in MetaMask app browser, or use WalletConnect");
    expect(walletOptions(ON).map((o) => o.id)).toContain("wallet-connect");
  });

  it("uses the testnet RPC for wallet-selector, with FastNear's testnet RPC as the fallback", () => {
    expect(NETWORK.networkId).toBe("testnet");
    expect(NETWORK.nodeUrl).toBe("https://rpc.testnet.near.org");
    expect(RPC_URLS).toEqual(["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"]);
  });
});

describe("CSP sources (T8)", () => {
  it("names each wallet bridge and nothing for WalletConnect when it is off", () => {
    const s = sources(OFF);
    expect(s.connect).toEqual([
      "'self'",
      "https://rpc.testnet.near.org",
      "https://test.rpc.fastnear.com",
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
