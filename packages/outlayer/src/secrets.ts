/**
 * Sealing an API key in OutLayer Secrets, locked to the KeyLease contract and the proxy build
 * (OutLayer commit aaf60a2: `contract/src/secrets.rs` 277-296 `store_secrets`, `tests/lib/store_row_for_owner.py`
 * for the `/secrets/pubkey` request, `keystore-worker/src/api.rs` 868-889 for refused env names).
 */
import type { Condition } from "./conditions.ts";
import { wasmHash } from "./conditions.ts";
import type { Fetcher } from "./hosting.ts";

/** Env var the proxy reads the key from (wasm/keylease-proxy, `KEY_ENV`). */
export const PROXY_KEY_ENV = "KL_API_KEY";

/** The plaintext OutLayer encrypts: a JSON object of env vars. Holds the key: never log it. */
export function secretsJson(apiKey: string): string {
  if (apiKey.trim() === "") throw new Error("the API key is empty");
  return JSON.stringify({ [PROXY_KEY_ENV]: apiKey });
}

/**
 * Body of `POST <api>/secrets/pubkey` for a row under accessor `WasmHash[proxyHash]`. The keystore reads
 * only the names in `secrets_json` (it refuses reserved and `PROTECTED_` names; `keystore-worker/src/api.rs`
 * `pubkey_handler`), and the public key depends only on accessor, owner and profile. So the request carries
 * the env names with empty values: the API key itself never travels unencrypted (T8).
 */
export function pubkeyRequest(owner: string, profile: string, proxyHash: string, names = [PROXY_KEY_ENV]) {
  wasmHash(proxyHash);
  const secrets_json = JSON.stringify(Object.fromEntries(names.map((n) => [n, ""])));
  return { accessor: { type: "WasmHash", hash: proxyHash }, owner, profile, secrets_json };
}

/**
 * Ask the keystore for the public key to encrypt this row to. `userAgent`: OutLayer's own scripts note the
 * CDN in front of the API wants one from non-browser clients; browsers send their own, so the web app
 * passes none (a custom header would also widen the CORS preflight).
 */
export async function fetchKeystorePubkey(
  api: string,
  body: ReturnType<typeof pubkeyRequest>,
  fetcher: Fetcher = fetch,
  userAgent?: string,
): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userAgent !== undefined) headers["user-agent"] = userAgent;
  const res = await (fetcher as unknown as typeof fetch)(`${api}/secrets/pubkey`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      `/secrets/pubkey answered HTTP ${String(res.status)}: ${(await res.text()).slice(0, 300)}`,
    );
  const { pubkey } = (await res.json()) as { pubkey?: unknown };
  if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/iu.test(pubkey))
    throw new Error("no valid pubkey in the answer");
  return pubkey;
}

/** Arguments of `store_secrets` (and, with `owner`, of the `estimate_storage_cost` view). */
export function storeSecretsArgs(proxyHash: string, profile: string, envelope: string, access: Condition) {
  wasmHash(proxyHash);
  return {
    accessor: { WasmHash: { hash: proxyHash } },
    profile,
    encrypted_secrets_base64: envelope,
    access,
    vault_id: null,
  };
}
