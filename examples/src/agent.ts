#!/usr/bin/env node
/**
 * The smallest KeyLease agent: one chat call with a lease, then its receipt. It never sees the API key.
 * Env (or .env): KEYLEASE_CONTRACT_ID, KEYLEASE_LEASE_ID, NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY. Testnet only.
 *
 *   pnpm --filter @keylease/examples agent "What is NEAR?"
 */
import { KeyLeaseError, leaseFromEnv } from "@keylease/sdk";
import { loadDotEnv } from "./env.ts";

loadDotEnv();
const question = process.argv.slice(2).join(" ") || "Say hello in five words.";
const l = leaseFromEnv();
try {
  const { data, receipt } = await l.call("/v1/chat/completions", {
    model: "keylease-mock-1",
    messages: [{ role: "user", content: question }],
  });
  const answer = (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
  console.warn(`answer   ${answer ?? JSON.stringify(data).slice(0, 200)}`);
  console.warn(`receipt  call ${String(receipt.call)} ${receipt.url}`);
} catch (e) {
  if (e instanceof KeyLeaseError) {
    console.warn(`refused  ${e.code}: ${e.hint}`);
    process.exitCode = 2;
  } else throw e;
}
