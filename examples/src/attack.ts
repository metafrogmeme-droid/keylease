#!/usr/bin/env node
/**
 * Prompt-injection attack run (brief milestone 9). Testnet only, the low-value demo key on the mock API.
 *
 *   KEYLEASE_CONTRACT_ID  keylease.<you>.testnet
 *   KEYLEASE_KEY_ID       the demo key's id (docs/VERIFY.md step 4)
 *   NEAR_ACCOUNT_ID       the demo account (owner and lease holder: a lease to yourself)
 *   NEAR_PRIVATE_KEY      its key: env or .env only, never printed
 *
 * Writes docs/ATTACK_LOG.md. `--plan` writes the expected results only, with no network.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { nearTransport } from "@keylease/sdk";
import { loadDotEnv, need, testnetOnly } from "./env.ts";
import { logMarkdown, planMarkdown } from "./log.ts";
import { runAttacks } from "./run.ts";

const out = new URL("../../docs/ATTACK_LOG.md", import.meta.url).pathname;

if (process.argv.includes("--plan")) {
  writeFileSync(out, planMarkdown());
  console.warn(`wrote the plan to ${out}`);
} else {
  loadDotEnv();
  const env = need(["KEYLEASE_CONTRACT_ID", "KEYLEASE_KEY_ID", "NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY"]);
  const contract = env["KEYLEASE_CONTRACT_ID"] ?? "";
  const account = env["NEAR_ACCOUNT_ID"] ?? "";
  testnetOnly(contract, account);
  const rpc = process.env["NEAR_RPC_URL"];
  const transport = await nearTransport({
    account,
    privateKey: env["NEAR_PRIVATE_KEY"] ?? "",
    ...(rpc ? { rpc } : {}),
  });
  const { leaseId, rows } = await runAttacks({ contract, keyId: env["KEYLEASE_KEY_ID"] ?? "", transport });
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(
    out,
    logMarkdown({ when: new Date().toISOString(), contract, account, leaseId, commit }, rows),
  );
  for (const r of rows)
    console.warn(
      `${r.id} ${r.pass ? "PASS" : "FAIL"}  ${r.tried}  expected ${r.expected}  actual ${r.actual}`,
    );
  const failed = rows.filter((r) => !r.pass).length;
  console.warn(`${String(rows.length - failed)}/${String(rows.length)} as expected; log: ${out}`);
  process.exitCode = failed === 0 ? 0 : 1;
}
