/**
 * Build-time settings for the web app. Next inlines `process.env.NEXT_PUBLIC_*` at build, so each name is
 * read literally. The app is testnet only (T9): any other network fails the build.
 */

export interface WebConfig {
  readonly network: "testnet";
  readonly contractId: string;
  readonly rpcUrl: string;
  /** Same-origin relay for OutLayer's `/secrets/pubkey` (E-017): OutLayer's API refuses browsers (CORS). */
  readonly pubkeyRelay: string;
  /** Reown (WalletConnect) project id; null when not set, and the WalletConnect option says so. */
  readonly reownProjectId: string | null;
}

export const FAUCET_URL = "https://docs.near.org/tools/faucet";
export const DEFAULT_RPC = "https://rpc.testnet.near.org";
export const PUBKEY_RELAY = "/api";

export interface RawEnv {
  readonly network?: string | undefined;
  readonly contractId?: string | undefined;
  readonly reownProjectId?: string | undefined;
}

const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;

/** Check the raw build env; throws with the variable name on anything but testnet settings. */
export function parseConfig(raw: RawEnv): WebConfig {
  const network = raw.network?.trim() || "testnet";
  if (network !== "testnet") throw new Error(`NEXT_PUBLIC_NEAR_NETWORK must be testnet, got "${network}"`);
  // No fallback: a build without the contract id used to point at "keylease.testnet", which does not exist,
  // and the app only failed later with UNKNOWN_ACCOUNT on get_config (4 Nov). Fail the build instead.
  const contractId = raw.contractId?.trim() ?? "";
  if (contractId === "")
    throw new Error(
      "NEXT_PUBLIC_KEYLEASE_CONTRACT_ID is not set: set it (e.g. keylease.<you>.testnet) in the env of `next build` / `vercel build`",
    );
  if (!ACCOUNT.test(contractId) || !contractId.endsWith(".testnet"))
    throw new Error(`NEXT_PUBLIC_KEYLEASE_CONTRACT_ID must be a .testnet account, got "${contractId}"`);
  const reown = raw.reownProjectId?.trim() ?? "";
  if (reown !== "" && !/^[a-f\d]{32}$/.test(reown))
    throw new Error("NEXT_PUBLIC_REOWN_PROJECT_ID must be 32 hex chars (from cloud.reown.com) or empty");
  return {
    network,
    contractId,
    rpcUrl: DEFAULT_RPC,
    pubkeyRelay: PUBKEY_RELAY,
    reownProjectId: reown === "" ? null : reown,
  };
}

export const config: WebConfig = parseConfig({
  network: process.env["NEXT_PUBLIC_NEAR_NETWORK"],
  contractId: process.env["NEXT_PUBLIC_KEYLEASE_CONTRACT_ID"],
  reownProjectId: process.env["NEXT_PUBLIC_REOWN_PROJECT_ID"],
});
