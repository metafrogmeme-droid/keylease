#!/usr/bin/env node
/**
 * KeyLease CLI (owner-run, NEAR testnet only). Keys come from env: NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, and
 * the API key named by --key-env. Nothing prints a key. Steps and expected output: docs/VERIFY.md.
 *
 *   kl deploy   [--fund 5] [--proxy-url https://…]        contract + proxy (FastFS, or self-hosted)
 *   kl add-key  --key-env NAME --base-url https://… [--provider Custom] [--profile main] [--label …]
 *   kl lease    --key ID --grantee ACCOUNT [--calls 10] [--for 1h] --endpoint /path [--endpoint …]
 *   kl call     --lease ID --endpoint /path [--method POST] [--body JSON] [--deposit 0.025]
 *   kl receipts --lease ID
 *   kl status   --lease ID
 *   kl revoke   --lease ID | --key ID | --everything
 *   kl set-proxy --proxy-url https://…                  same proxy build, new URL (admin)
 *
 * Exit codes: 0 done, 2 refused (a lease rule said no), 1 error.
 */
import { parse } from "./args.ts";
import { settings } from "./env.ts";
import { addKey, call, deploy, lease, receipts, revoke, setProxy, status, type Opts } from "./commands.ts";

const COMMANDS = {
  deploy,
  "add-key": addKey,
  lease,
  call,
  receipts,
  status,
  revoke,
  "set-proxy": setProxy,
} as const;

const { positionals, values } = parse(process.argv.slice(2));

const name = positionals[0] as keyof typeof COMMANDS | undefined;
const run = name ? COMMANDS[name] : undefined;
if (!run) {
  console.error(`usage: kl <${Object.keys(COMMANDS).join("|")}> [options]  (see docs/VERIFY.md)`);
  process.exit(1);
}
Promise.resolve()
  .then(() => run(settings(process.env), values as Opts))
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
      console.error(`error      ${e instanceof Error ? e.message : String(e)}${cause}`);
      process.exitCode = 1;
    },
  );
