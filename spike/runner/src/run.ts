#!/usr/bin/env node
/**
 * PR 2 spike runner (owner-run, NEAR testnet only).
 *
 *   node spike/runner/src/run.ts            # dry run: prints the plan, sends nothing
 *   node spike/runner/src/run.ts --apply    # runs it; needs NEAR_ACCOUNT_ID + NEAR_PRIVATE_KEY in env
 *   node spike/runner/src/run.ts --apply --keep   # keep the sub-accounts and secret rows afterwards
 *
 * Seals a random canary under the owner's account with the KeyLease lock
 * (Predecessor[kl contract] AND WasmHash[proxy]) and checks who can open it. The canary value is never
 * printed or written: rows compare only the first 8 hex of its sha256, reported by the guest.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  actions,
  nearToYocto,
  teraToGas,
  type KeyPairString,
} from "near-api-js";
import { leaseLock, wasmHash, type Condition } from "./conditions.ts";
import { seal } from "./ecies.ts";
import { FASTFS_METHOD, fastfsPayload, fastfsUrl } from "./fastfs.ts";
import { completion } from "./outcome.ts";

const here = dirname(fileURLToPath(import.meta.url));
const spikeDir = join(here, "../..");
const APPLY = process.argv.includes("--apply");
const KEEP = process.argv.includes("--keep");

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`${name} is not set (see .env.example)`);
  return v;
};

const RPC = env("NEAR_RPC_URL", "https://rpc.testnet.near.org");
const OUTLAYER = env("OUTLAYER_CONTRACT_ID", "outlayer.testnet");
const API = env("OUTLAYER_API_BASE", "https://testnet-api.outlayer.ai");
const PROFILE = "spike";
const PAD = 8000;
const RUN_GAS = teraToGas(300);
const LIMITS = { max_instructions: 1_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 };

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const artefact = (p: string): Buffer => readFileSync(join(spikeDir, "artifacts", p));

interface Row {
  id: string;
  what: string;
  expect: "opens" | "refused";
  signer: string;
  observed?: "opens" | "refused" | "error";
  reason?: string | undefined;
  outputBytes?: number;
  pass?: boolean;
  tx?: string;
  logs?: string[];
}

async function main(): Promise<void> {
  const owner = env("NEAR_ACCOUNT_ID");
  if (!owner.endsWith(".testnet")) throw new Error("testnet accounts only");
  if (!OUTLAYER.endsWith(".testnet")) throw new Error("testnet OutLayer only");

  const proxyA = artefact("proxy-a.wasm");
  const proxyB = artefact("proxy-b.wasm");
  const caller = artefact("caller.wasm");
  const hA = sha256(proxyA);
  const hB = sha256(proxyB);
  if (hA === hB) throw new Error("proxy builds a and b must differ");
  const urlA = fastfsUrl(owner, OUTLAYER, hA);
  const urlB = fastfsUrl(owner, OUTLAYER, hB);

  const kl = `klspike.${owner}`;
  const decoy = `kldecoy.${owner}`;
  const agent = `klagent.${owner}`;

  const rows: Row[] = [
    { id: "S1", what: "agent -> kl contract -> OutLayer, pinned build", expect: "opens", signer: agent },
    { id: "S2", what: "agent -> decoy contract (same code) -> OutLayer", expect: "refused", signer: agent },
    { id: "S3", what: "owner -> OutLayer directly, same row", expect: "refused", signer: owner },
    {
      id: "S4",
      what: "agent -> kl contract, other build (row B locks build A)",
      expect: "refused",
      signer: agent,
    },
    {
      id: "S5",
      what: "owner -> kl contract (any signer passes; the contract is the gate)",
      expect: "opens",
      signer: owner,
    },
    {
      id: "S6",
      what: `agent -> kl contract, ${String(PAD)}-byte answer (does a multi-KB API answer come back on chain?)`,
      expect: "opens",
      signer: agent,
    },
  ];

  console.warn(`network ${RPC} | outlayer ${OUTLAYER} | owner ${owner}`);
  console.warn(`proxy A ${hA}\nproxy B ${hB}\ncaller  ${sha256(caller)}`);
  console.warn(`row A: WasmHash[A] lock ${JSON.stringify(leaseLock(kl, hA))}`);
  console.warn(`row B: WasmHash[B] lock ${JSON.stringify(leaseLock(kl, hA))} (names A on purpose)`);
  for (const r of rows) console.warn(`${r.id} expect ${r.expect.padEnd(7)} signer ${r.signer}  ${r.what}`);
  if (!APPLY) {
    console.warn("\ndry run: nothing sent. Re-run with --apply.");
    return;
  }

  const provider = new JsonRpcProvider({ url: RPC });
  if ((await provider.getNetworkId()) !== "testnet") throw new Error("RPC is not testnet");
  const ownerAcc = new Account(owner, provider, env("NEAR_PRIVATE_KEY") as KeyPairString);

  // Sub-accounts with fresh keys held in memory only; deleted at the end unless --keep.
  const accounts = new Map<string, Account>();
  for (const [id, near] of [
    [kl, "3"],
    [decoy, "3"],
    [agent, "1"],
  ] as const) {
    const kp = KeyPair.fromRandom("ed25519");
    await ownerAcc.createAccount({
      newAccountId: id,
      publicKey: kp.getPublicKey(),
      nearToTransfer: nearToYocto(near),
    });
    accounts.set(id, new Account(id, provider, kp.toString()));
  }
  const acc = (id: string): Account => {
    const a = accounts.get(id) ?? (id === owner ? ownerAcc : undefined);
    if (!a) throw new Error(`no account ${id}`);
    return a;
  };
  for (const id of [kl, decoy]) {
    await acc(id).deployContract(caller);
    await acc(id).callFunction({ contractId: id, methodName: "new", args: { outlayer: OUTLAYER } });
  }

  // Publish both builds on FastFS (the call itself fails on chain by design; the data is indexed).
  for (const [hash, wasm] of [
    [hA, proxyA],
    [hB, proxyB],
  ] as const) {
    await ownerAcc.signAndSendTransaction({
      receiverId: OUTLAYER,
      actions: [actions.functionCall(FASTFS_METHOD, fastfsPayload(hash, wasm), teraToGas(300), 0n)],
      throwOnFailure: false,
    });
  }
  await waitForUrl(urlA, hA);
  await waitForUrl(urlB, hB);

  // Seal the canary twice: row A (accessor A, lock A) and row B (accessor B, lock still names A).
  const canary = randomBytes(32).toString("hex");
  const canaryPrefix = sha256(Buffer.from(canary)).slice(0, 8);
  const secrets = JSON.stringify({ SPIKE_SECRET: canary });
  await storeRow(ownerAcc, owner, hA, secrets, leaseLock(kl, hA));
  await storeRow(ownerAcc, owner, hB, secrets, leaseLock(kl, hA));

  // U128 comes back as a JSON string of yoctoNEAR; attach twice the estimate (unused compute is refunded).
  const estimate = await provider.callFunction<string>({
    contractId: OUTLAYER,
    method: "estimate_execution_cost",
    args: { resource_limits: LIMITS },
  });
  if (typeof estimate !== "string" || !/^\d+$/u.test(estimate)) throw new Error("unexpected cost estimate");
  const attach = BigInt(estimate) * 2n;

  for (const r of rows) {
    const runArgs = (url: string, hash: string) => ({
      wasm_url: url,
      wasm_hash: hash,
      secret_owner: owner,
      profile: PROFILE,
      input: r.id === "S6" ? JSON.stringify({ pad: PAD }) : null,
    });
    const call =
      r.id === "S3"
        ? { contractId: OUTLAYER, methodName: "request_execution", args: directArgs(urlA, hA, owner) }
        : {
            contractId: r.id === "S2" ? decoy : kl,
            methodName: "run",
            args: r.id === "S4" ? runArgs(urlB, hB) : runArgs(urlA, hA),
          };
    const out = await sendAndWait(
      provider,
      acc(r.signer),
      call.contractId,
      call.methodName,
      call.args,
      attach,
    );
    r.tx = out.hash;
    if (out.text.includes(canary)) throw new Error("canary value came back in clear: stop and report");
    r.logs = out.logs;
    const done = completion(out.logs);
    const opened =
      done?.success === true &&
      out.text.includes(`"secret_sha256_prefix":"${canaryPrefix}"`) &&
      (r.id !== "S6" || out.text.length > PAD);
    r.outputBytes = out.text.length;
    // A refusal counts only when OutLayer accepted the request and reported the run as failed;
    // anything else (a panic before OutLayer, no completion event) is "error", never a pass.
    r.observed = opened ? "opens" : done?.success === false ? "refused" : "error";
    r.reason = done?.error_message ?? undefined;
    r.pass = r.observed === r.expect;
  }

  if (!KEEP) await cleanup(ownerAcc, owner, [hA, hB], [kl, decoy, agent].map(acc));

  const result = {
    at: new Date().toISOString(),
    rpc: RPC,
    outlayer: OUTLAYER,
    owner,
    contracts: { kl, decoy, agent },
    proxy: { a: hA, b: hB, urlA, urlB },
    canarySha256Prefix: canaryPrefix,
    rows: rows.map((r) => ({ ...r, link: r.tx ? `https://testnet.nearblocks.io/txns/${r.tx}` : undefined })),
  };
  mkdirSync(join(spikeDir, "results"), { recursive: true });
  const file = join(spikeDir, "results", `${result.at.replaceAll(":", "-")}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  for (const r of rows)
    console.warn(
      `${r.pass === true ? "PASS" : "FAIL"} ${r.id} expected ${r.expect}, observed ${r.observed ?? "-"}  ${r.tx ?? ""}`,
    );
  console.warn(`results: ${file}`);
  if (rows.some((r) => r.pass !== true)) process.exitCode = 1;
}

interface Sent {
  hash: string;
  text: string;
  logs: string[];
}

/** Send, then poll: the yield/resume round trip can outlast one RPC wait. */
async function sendAndWait(
  provider: JsonRpcProvider,
  signer: Account,
  receiverId: string,
  method: string,
  args: Record<string, unknown>,
  deposit: bigint,
): Promise<Sent> {
  const sent = await signer.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, RUN_GAS, deposit)],
    waitUntil: "INCLUDED_FINAL",
    throwOnFailure: false,
  });
  const hash = sent.transaction.hash;
  for (let i = 0; i < 60; i += 1) {
    try {
      const st = await provider.viewTransactionStatusWithReceipts({
        txHash: hash,
        accountId: signer.accountId,
        waitUntil: "FINAL",
      });
      const status = st.status as { SuccessValue?: string; Failure?: unknown };
      if (status.SuccessValue !== undefined || status.Failure !== undefined) {
        const text = status.SuccessValue
          ? Buffer.from(status.SuccessValue, "base64").toString("utf8")
          : JSON.stringify(status.Failure);
        return { hash, text, logs: st.receipts_outcome.flatMap((o) => o.outcome.logs) };
      }
    } catch {
      // timeout or not yet known: keep polling
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error(`no final outcome for ${hash} within 5 minutes`);
}

function directArgs(url: string, hash: string, owner: string): Record<string, unknown> {
  return {
    source: { WasmUrl: { url, hash, build_target: "wasm32-wasip2" } },
    resource_limits: LIMITS,
    input_data: '{"spike":true}',
    secrets_ref: { profile: PROFILE, account_id: owner },
    response_format: "Json",
  };
}

async function storeRow(
  owner: Account,
  ownerId: string,
  hash: string,
  secrets: string,
  access: Condition,
): Promise<void> {
  const res = await fetch(`${API}/secrets/pubkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "keylease-spike" },
    body: JSON.stringify({
      accessor: { type: "WasmHash", hash: wasmHashValue(hash) },
      owner: ownerId,
      profile: PROFILE,
      secrets_json: secrets,
    }),
  });
  if (!res.ok)
    throw new Error(`/secrets/pubkey answered ${String(res.status)}: ${(await res.text()).slice(0, 300)}`);
  const { pubkey } = (await res.json()) as { pubkey?: string };
  if (!pubkey) throw new Error("no pubkey in answer");
  await owner.callFunction({
    contractId: OUTLAYER,
    methodName: "store_secrets",
    args: {
      accessor: { WasmHash: { hash } },
      profile: PROFILE,
      encrypted_secrets_base64: seal(pubkey, Buffer.from(secrets)),
      access,
      vault_id: null,
    },
    deposit: nearToYocto("0.1"),
    gas: teraToGas(100),
  });
}

const wasmHashValue = (h: string): string => (wasmHash(h) as { WasmHash: { hash: string } }).WasmHash.hash;

async function waitForUrl(url: string, hash: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    const r = await fetch(url).catch(() => undefined);
    if (r?.ok && sha256(new Uint8Array(await r.arrayBuffer())) === hash) return;
    await new Promise((ok) => setTimeout(ok, 4000));
  }
  throw new Error(`FastFS did not serve ${url} with the right hash within 2 minutes`);
}

async function cleanup(owner: Account, ownerId: string, hashes: string[], subs: Account[]): Promise<void> {
  for (const hash of hashes) {
    await owner.callFunction({
      contractId: OUTLAYER,
      methodName: "delete_secrets",
      args: { accessor: { WasmHash: { hash } }, profile: PROFILE },
    });
  }
  for (const a of subs) await a.deleteAccount(ownerId);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
