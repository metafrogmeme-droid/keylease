/** The CLI commands. Each prints fixed `label  value` lines (docs/VERIFY.md lists what to expect). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Account, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import {
  checkHosted,
  fastfsPayload,
  fastfsUrl,
  FASTFS_METHOD,
  fetchKeystorePubkey,
  leaseLock,
  pubkeyRequest,
  seal,
  secretsJson,
  storeSecretsArgs,
} from "@keylease/outlayer";
import { durationNs, type Settings } from "./env.ts";
import { callNumber, line, refusal, short, txLink } from "./format.ts";
import { callAndWait, connect, exists, view, viewer, type Chain } from "./near.ts";

export type Opts = Readonly<Record<string, string | string[] | boolean | undefined>>;
const say = (label: string, value: string): void => {
  console.warn(line(label, value));
};
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function str(o: Opts, name: string, fallback?: string): string {
  const v = o[name] ?? fallback;
  if (typeof v !== "string" || v === "") throw new Error(`--${name} is required`);
  return v;
}

function contractOf(s: Settings): string {
  if (!s.contract) throw new Error("set KEYLEASE_CONTRACT_ID or NEAR_ACCOUNT_ID");
  return s.contract;
}

/** A NEAR amount from a flag, checked: `5`, `0.025`. */
function near(text: string): bigint {
  if (!/^\d+(\.\d+)?$/u.test(text)) throw new Error(`not a NEAR amount: "${text}"`);
  return nearToYocto(text as `${number}`);
}

/** `get_receipt` / `list_receipts` item (contracts/keylease/src/run.rs `Receipt`). */
interface ReceiptView {
  call: number;
  caller: string;
  endpoint: string;
  outcome: "ok" | "refused" | "tripwire" | "error" | "failed";
  code: string | null;
  http_status: number | null;
  input_sha256: string;
  output_sha256: string | null;
}

interface Config {
  admin: string;
  outlayer: string;
  proxy_url: string;
  proxy_hash: string;
}

/** Create the contract account, publish the proxy, deploy + init in one transaction. Idempotent. */
export async function deploy(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const id = contractOf(s);
  if (await exists(c.provider, id)) {
    const cfg = await view<Config>(c.provider, id, "get_config");
    say("contract", `${id} (already deployed)`);
    say("proxy", `sha256 ${cfg.proxy_hash}`);
    say("proxy url", cfg.proxy_url);
    return 0;
  }
  const code = readFileSync(str(o, "wasm", "target/near/keylease_contract/keylease_contract.wasm"));
  const proxy = readFileSync(str(o, "proxy", "target/proxy/keylease-proxy.wasm"));
  const proxyHash = sha256(proxy);
  const proxyUrl = await publishProxy(c, s, o, proxy, proxyHash);

  // The contract account gets the owner's public key, so the owner can upgrade it until code freeze
  // (then that key is removed, README "Upgrade policy").
  const ownerKey = KeyPair.fromString(s.privateKey as KeyPairString).getPublicKey();
  await c.me.createAccount({
    newAccountId: id,
    publicKey: ownerKey,
    nearToTransfer: near(str(o, "fund", "5")),
  });
  const kl = new Account(id, c.provider, s.privateKey as KeyPairString);
  const init = { admin: c.me.accountId, outlayer: s.outlayer, proxy_url: proxyUrl, proxy_hash: proxyHash };
  // Code and `new` in one transaction: `new` is private, and nobody can initialise in between.
  const tx = await kl.signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(code), actions.functionCall("new", init, teraToGas(100), 0n)],
  });
  say("contract", id);
  say("code", `sha256 ${sha256(code)}`);
  say("proxy", `sha256 ${proxyHash}`);
  say("proxy url", proxyUrl);
  say("admin", c.me.accountId);
  say("tx", txLink(tx.transaction.hash));
  return 0;
}

/** FastFS by default; `--proxy-url` for a self-hosted copy, checked like OutLayer's worker fetches it. */
async function publishProxy(c: Chain, s: Settings, o: Opts, proxy: Buffer, hash: string): Promise<string> {
  const hosted = o["proxy-url"];
  if (typeof hosted === "string") {
    await checkHosted(hosted, hash);
    return hosted;
  }
  await c.me.signAndSendTransaction({
    receiverId: s.outlayer,
    actions: [actions.functionCall(FASTFS_METHOD, fastfsPayload(hash, proxy), teraToGas(300), 0n)],
    throwOnFailure: false, // the call itself fails by design; FastFS indexes the data
  });
  const url = fastfsUrl(c.me.accountId, s.outlayer, hash);
  for (let i = 0; i < 75; i += 1) {
    const ok = await checkHosted(url, hash).then(
      () => true,
      () => false,
    );
    if (ok) return url;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(
    `FastFS did not serve ${url} within 5 minutes; host the file yourself and pass --proxy-url`,
  );
}

/** Seal the API key named by --key-env, locked to this contract + proxy build, then register it. */
export async function addKey(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const id = contractOf(s);
  const keyEnv = str(o, "key-env");
  const apiKey = process.env[keyEnv];
  if (!apiKey) throw new Error(`env ${keyEnv} is empty`);
  const profile = str(o, "profile", "main");
  const cfg = await view<Config>(c.provider, id, "get_config");
  const secrets = secretsJson(apiKey);
  const pubkey = await fetchKeystorePubkey(
    s.api,
    pubkeyRequest(c.me.accountId, profile, cfg.proxy_hash, secrets),
  );
  const lock = leaseLock(id, cfg.proxy_hash);
  const args = storeSecretsArgs(cfg.proxy_hash, profile, seal(pubkey, Buffer.from(secrets)), lock);
  const quote = await view<string>(c.provider, s.outlayer, "estimate_storage_cost", {
    ...args,
    owner: c.me.accountId,
  });
  const stored = await callAndWait(c, s.outlayer, "store_secrets", args, BigInt(quote), 100);
  if (!stored.ok) throw new Error(`store_secrets failed: ${short(stored.text)}`);
  const added = await callAndWait(
    c,
    id,
    "add_key",
    {
      provider: str(o, "provider", "Custom"),
      base_url: str(o, "base-url"),
      secret_profile: profile,
      label: str(o, "label", profile),
    },
    near("0.05"),
    50,
  );
  if (!added.ok) throw new Error(`add_key failed: ${short(added.text)}`);
  say(
    "sealed",
    `profile ${profile} under ${c.me.accountId}, lock Predecessor[${id}] AND WasmHash[${cfg.proxy_hash.slice(0, 12)}…]`,
  );
  say("key", JSON.parse(added.text) as string);
  say("tx", txLink(added.hash));
  return 0;
}

export async function lease(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const raw = o["endpoint"];
  const endpoints = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const expiresAt = BigInt(Date.now()) * 1_000_000n + durationNs(str(o, "for", "1h"));
  const out = await callAndWait(
    c,
    contractOf(s),
    "create_lease",
    {
      key_id: str(o, "key"),
      grantee: str(o, "grantee"),
      calls: Number(str(o, "calls", "10")),
      expires_at: expiresAt.toString(),
      endpoints,
    },
    near("0.05"),
    50,
  );
  if (!out.ok) throw new Error(`create_lease failed: ${short(out.text)}`);
  say("lease", JSON.parse(out.text) as string);
  say("expires", new Date(Number(expiresAt / 1_000_000n)).toISOString());
  say("tx", txLink(out.hash));
  return 0;
}

/** Make one leased call as NEAR_ACCOUNT_ID. Exit 0 on an answer, 2 on a refusal, 1 on an error. */
export async function call(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const id = contractOf(s);
  const leaseId = str(o, "lease");
  const body = typeof o["body"] === "string" ? o["body"] : undefined;
  const out = await callAndWait(
    c,
    id,
    "use_lease",
    { lease_id: leaseId, endpoint: str(o, "endpoint"), method: str(o, "method", "POST"), body },
    near(str(o, "deposit", "0.025")),
  );
  say("tx", txLink(out.hash));
  if (!out.ok) {
    const r = refusal(out.text);
    if (r) {
      say("refused", `${r.code}: ${r.hint}`);
      return 2;
    }
    throw new Error(`use_lease failed: ${short(out.text)}`);
  }
  const n = callNumber(out.logs);
  const r =
    n === undefined
      ? null
      : await view<ReceiptView | null>(c.provider, id, "get_receipt", { lease_id: leaseId, call: n });
  say("call", `${String(n ?? "?")} on lease ${leaseId}`);
  if (!r) throw new Error("no receipt found for this call");
  const extra = `${r.code ? ` (${r.code})` : ""}${r.http_status === null ? "" : ` http ${String(r.http_status)}`}`;
  say("outcome", `${r.outcome}${extra}`);
  say("answer", short(out.text));
  say("input", `sha256 ${r.input_sha256}`);
  say("output", `sha256 ${r.output_sha256 ?? "-"}`);
  return r.outcome === "ok" ? 0 : 2;
}

export async function receipts(s: Settings, o: Opts): Promise<number> {
  const p = await viewer(s);
  const list = await view<ReceiptView[]>(p, contractOf(s), "list_receipts", {
    lease_id: str(o, "lease"),
  });
  for (const r of list) {
    say(`call ${String(r.call)}`, `${r.outcome}${r.code ? ` ${r.code}` : ""} ${r.endpoint} by ${r.caller}`);
  }
  if (list.length === 0) say("receipts", "none yet");
  return 0;
}

export async function status(s: Settings, o: Opts): Promise<number> {
  const p = await viewer(s);
  const l = await view<Record<string, unknown> | null>(p, contractOf(s), "get_lease", {
    lease_id: str(o, "lease"),
  });
  if (!l) {
    say("lease", "not found");
    return 2;
  }
  say("lease", `${String(l["lease_id"])} on key ${String(l["key_id"])}, ${String(l["status"])}`);
  say("grantee", String(l["grantee"]));
  say("calls", `${String(l["calls_used"])} used, ${String(l["calls_left"])} left`);
  say("expires", new Date(Number(BigInt(String(l["expires_at"])) / 1_000_000n)).toISOString());
  say("endpoints", (l["endpoints"] as string[]).join(" "));
  return 0;
}

/** `--lease ID` one lease; `--key ID` every lease on a key; `--everything` the panic button. */
export async function revoke(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const id = contractOf(s);
  const [method, args, what] =
    o["everything"] === true
      ? (["revoke_all_owner", {}, `every lease of ${c.me.accountId}`] as const)
      : typeof o["key"] === "string"
        ? (["revoke_all", { key_id: o["key"] }, `every lease on key ${o["key"]}`] as const)
        : (["revoke", { lease_id: str(o, "lease") }, `lease ${str(o, "lease")}`] as const);
  const out = await callAndWait(c, id, method, args, 0n, 30);
  if (!out.ok) throw new Error(`${method} failed: ${short(out.text)}`);
  say("revoked", what);
  say("tx", txLink(out.hash));
  return 0;
}

/**
 * Point the contract at a new URL for the same proxy build (admin only), e.g. after a tunnel restart.
 * The URL must serve exactly the local build, checked like OutLayer's worker fetches it; the hash in the
 * keys' locks does not change, so no key needs re-sealing.
 */
export async function setProxy(s: Settings, o: Opts): Promise<number> {
  const c = await connect(s);
  const id = contractOf(s);
  const url = str(o, "proxy-url");
  const proxyHash = sha256(readFileSync(str(o, "proxy", "target/proxy/keylease-proxy.wasm")));
  const cfg = await view<Config>(c.provider, id, "get_config");
  if (cfg.proxy_hash !== proxyHash) {
    throw new Error(
      `local proxy build ${proxyHash.slice(0, 12)}… differs from the deployed ${cfg.proxy_hash.slice(0, 12)}…; owners would have to re-seal`,
    );
  }
  await checkHosted(url, proxyHash);
  const out = await callAndWait(c, id, "set_proxy", { proxy_url: url, proxy_hash: proxyHash }, 0n, 30);
  if (!out.ok) throw new Error(`set_proxy failed: ${short(out.text)}`);
  say("proxy", `sha256 ${proxyHash}`);
  say("proxy url", url);
  say("tx", txLink(out.hash));
  return 0;
}
