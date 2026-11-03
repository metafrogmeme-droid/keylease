/**
 * Which wallets the app offers and which hosts they talk to. Pure: no wallet code is imported here, so
 * the build's CSP step and the tests can use it.
 */
import { DEFAULT_RPC, type WebConfig } from "./config.ts";

export type WalletId =
  "my-near-wallet" | "meteor-wallet" | "hot-wallet" | "intear-wallet" | "wallet-connect" | "ethereum-wallets";

export interface WalletOption {
  readonly id: WalletId;
  readonly name: string;
  readonly kind: "NEAR" | "WalletConnect" | "EVM";
  /** False when the build lacks what the wallet needs; `note` says what. */
  readonly configured: boolean;
  readonly note: string;
}

/** NEAR testnet chain id for EVM wallets (MetaMask). */
export const NEAR_TESTNET_EVM_CHAIN = 398;
export const NEAR_TESTNET_EVM_RPC = "https://eth-rpc.testnet.near.org";

/** wallet-selector network: only our RPC, so the CSP stays short. */
export const NETWORK = {
  networkId: "testnet",
  nodeUrl: DEFAULT_RPC,
  helperUrl: "https://helper.testnet.near.org",
  explorerUrl: "https://testnet.nearblocks.io",
  indexerUrl: "https://test.api.fastnear.com/v0",
} as const;

export function walletOptions(cfg: Pick<WebConfig, "reownProjectId">): WalletOption[] {
  const wc = cfg.reownProjectId !== null;
  return [
    { id: "my-near-wallet", name: "MyNearWallet", kind: "NEAR", configured: true, note: "opens in this tab" },
    { id: "meteor-wallet", name: "Meteor", kind: "NEAR", configured: true, note: "extension or web" },
    { id: "hot-wallet", name: "HOT", kind: "NEAR", configured: true, note: "extension or Telegram" },
    { id: "intear-wallet", name: "Intear", kind: "NEAR", configured: true, note: "web popup" },
    {
      id: "wallet-connect",
      name: "WalletConnect",
      kind: "WalletConnect",
      configured: wc,
      note: wc ? "scan with a phone wallet" : "not configured: NEXT_PUBLIC_REOWN_PROJECT_ID is empty",
    },
    {
      id: "ethereum-wallets",
      name: "MetaMask",
      kind: "EVM",
      configured: true,
      note: `EVM wallet on NEAR testnet (chain ${String(NEAR_TESTNET_EVM_CHAIN)})`,
    },
  ];
}

export interface Sources {
  readonly connect: readonly string[];
  readonly frame: readonly string[];
  readonly img: readonly string[];
}

/** Hosts the page may reach (CSP, T8). WalletConnect hosts only when it is configured. */
export function sources(cfg: Pick<WebConfig, "reownProjectId">): Sources {
  const connect = [
    "'self'",
    DEFAULT_RPC, // OutLayer's keystore goes through the same-origin relay ('self'), E-017
    NEAR_TESTNET_EVM_RPC, // MetaMask on chain 398
    "https://h4n.app", // HOT bridge
    "https://logout-bridge-service.intear.tech",
    "wss://logout-bridge-service.intear.tech",
  ];
  if (cfg.reownProjectId === null) return { connect, frame: [], img: [] };
  return {
    connect: [
      ...connect,
      "wss://relay.walletconnect.org",
      "wss://relay.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://verify.walletconnect.com",
      "https://explorer-api.walletconnect.com",
    ],
    frame: ["https://verify.walletconnect.org", "https://verify.walletconnect.com"],
    img: ["https://explorer-api.walletconnect.com"],
  };
}
