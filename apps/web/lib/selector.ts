/**
 * Builds the wallet-selector in the browser. Wallet code loads only here, after the page is up, so the
 * first paint stays small. No modal-ui: the app renders its own picker (components/ConnectWallet.tsx).
 */
import type { WalletModuleFactory, WalletSelector } from "@near-wallet-selector/core";
import type { WebConfig } from "./config.ts";
import { installRpcRetry, RPC_URLS } from "./near-rpc.ts";
import { NEAR_TESTNET_EVM_CHAIN, NETWORK } from "./wallets.ts";

export async function createSelector(cfg: WebConfig): Promise<WalletSelector> {
  // Timing-test builds only: next.config.ts points @keylease/test-wallet at a throwing stub otherwise.
  if (process.env["NEXT_PUBLIC_KL_E2E"] === "1")
    return (await import("@keylease/test-wallet")).createTestSelector() as unknown as WalletSelector;
  // Before any wallet code loads: their own read-only RPC queries (MetaMask's view_access_key) get one
  // retry on the fallback RPC after a transient failure.
  installRpcRetry(window);
  const [core, mnw, meteor, hot, intear, eth, wagmi, chains] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/my-near-wallet"),
    import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/hot-wallet"),
    import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/ethereum-wallets"),
    import("@wagmi/core"),
    import("viem/chains"),
  ]);
  // MetaMask and other injected EVM wallets, NEAR testnet only. No Reown AppKit: the injected connector
  // needs no project id and no third-party script.
  const wagmiConfig = wagmi.createConfig({
    chains: [chains.nearTestnet],
    transports: { [chains.nearTestnet.id]: wagmi.http() },
    connectors: [wagmi.injected()],
  });
  const modules: WalletModuleFactory[] = [
    mnw.setupMyNearWallet(),
    meteor.setupMeteorWallet(),
    hot.setupHotWallet(),
    intear.setupIntearWallet(),
    eth.setupEthereumWallets({
      wagmiConfig,
      wagmiCore: wagmi,
      chainId: NEAR_TESTNET_EVM_CHAIN,
      nearNodeUrl: cfg.rpcUrl,
    }),
  ];
  if (cfg.reownProjectId !== null) {
    const wc = await import("@near-wallet-selector/wallet-connect");
    modules.push(
      wc.setupWalletConnect({
        projectId: cfg.reownProjectId,
        chainId: "near:testnet",
        metadata: {
          name: "KeyLease (testnet)",
          description: "Lease API calls on NEAR testnet",
          url: window.location.origin,
          icons: [],
        },
      }),
    );
  }
  // The selector's own provider fails over between the two testnet RPCs.
  return core.setupWalletSelector({ network: NETWORK, modules, fallbackRpcUrls: [...RPC_URLS] });
}
