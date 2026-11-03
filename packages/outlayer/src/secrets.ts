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

/** Body of `POST <api>/secrets/pubkey` for a row under accessor `WasmHash[proxyHash]`. */
export function pubkeyRequest(owner: string, profile: string, proxyHash: string, secrets: string) {
  wasmHash(proxyHash);
  return { accessor: { type: "WasmHash", hash: proxyHash }, owner, profile, secrets_json: secrets };
}

/** Ask the keystore for the public key to encrypt this row to. */
export async function fetchKeystorePubkey(
  api: string,
  body: ReturnType<typeof pubkeyRequest>,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const res = await (fetcher as unknown as typeof fetch)(`${api}/secrets/pubkey`, {
    method: "POST",
    // OutLayer's own scripts note a User-Agent is required by the CDN in front of the API.
    headers: { "content-type": "application/json", "user-agent": "keylease-cli" },
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
