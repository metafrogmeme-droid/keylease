/**
 * Add key, in the browser: the same steps as `kl add-key`. The API key is sealed here to OutLayer's
 * keystore (ECIES, `@keylease/outlayer/web`) and only the envelope leaves the page; the request for the
 * keystore's public key carries env names only (T8).
 */
import { actionCreators } from "@near-wallet-selector/core";
import {
  fetchKeystorePubkey,
  leaseLock,
  pubkeyRequest,
  sealWeb,
  secretsJson,
  storeSecretsArgs,
} from "@keylease/outlayer/web";
import type { WebConfig } from "./config.ts";
import { view, type Fetch } from "./near-rpc.ts";
import { baseUrlProblem, labelProblem, newProfile, type ProviderId } from "./rules.ts";

const TGAS = 1_000_000_000_000n;
/** Covers add_key's storage; the contract refunds what it does not use. */
export const ADD_KEY_DEPOSIT = 50_000_000_000_000_000_000_000n; // 0.05 NEAR

export interface KeyForm {
  readonly provider: ProviderId;
  readonly baseUrl: string;
  readonly label: string;
}

export function formProblem(f: KeyForm, apiKey: string): string | null {
  if (apiKey.trim() === "") return "Paste the API key";
  return baseUrlProblem(f.baseUrl) ?? labelProblem(f.label);
}

/** Thrown when OutLayer's keystore cannot be reached from this page (CORS or network, Q-011). */
export class KeystoreUnreachable extends Error {}

export interface Deps {
  readonly fetcher?: Fetch;
  readonly seal?: typeof sealWeb;
  readonly profile?: () => string;
}

/**
 * Build the two transactions (store_secrets on OutLayer, add_key on KeyLease). `apiKey` is used once, to
 * seal; the caller clears its copy right after this returns.
 */
export async function keyTransactions(
  cfg: WebConfig,
  owner: string,
  form: KeyForm,
  apiKey: string,
  deps: Deps = {},
) {
  const problem = formProblem(form, apiKey);
  if (problem) throw new Error(problem);
  const fetcher = deps.fetcher ?? fetch;
  const profile = (deps.profile ?? newProfile)();
  const contract = await view<{ outlayer: string; proxy_hash: string }>(
    cfg.rpcUrl,
    cfg.contractId,
    "get_config",
    {},
    fetcher,
  );
  let pubkey: string;
  try {
    pubkey = await fetchKeystorePubkey(
      cfg.outlayerApi,
      pubkeyRequest(owner, profile, contract.proxy_hash),
      fetcher,
    );
  } catch (e) {
    if (e instanceof TypeError) throw new KeystoreUnreachable("OutLayer's keystore did not answer this page");
    throw e;
  }
  const envelope = (deps.seal ?? sealWeb)(pubkey, new TextEncoder().encode(secretsJson(apiKey)));
  const args = storeSecretsArgs(
    contract.proxy_hash,
    profile,
    envelope,
    leaseLock(cfg.contractId, contract.proxy_hash),
  );
  const quote = await view<string>(
    cfg.rpcUrl,
    contract.outlayer,
    "estimate_storage_cost",
    { ...args, owner },
    fetcher,
  );
  return {
    profile,
    transactions: [
      {
        receiverId: contract.outlayer,
        actions: [actionCreators.functionCall("store_secrets", args, 100n * TGAS, BigInt(quote))],
      },
      {
        receiverId: cfg.contractId,
        actions: [
          actionCreators.functionCall(
            "add_key",
            { provider: form.provider, base_url: form.baseUrl, secret_profile: profile, label: form.label },
            50n * TGAS,
            ADD_KEY_DEPOSIT,
          ),
        ],
      },
    ],
  };
}
