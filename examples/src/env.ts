/** Reads the run's settings from env (or .env): names only are ever printed. Testnet only. */
import { existsSync, readFileSync } from "node:fs";

/** Load KEY=VALUE lines from the repo's .env without overriding the environment. Values are never echoed. */
export function loadDotEnv(path = new URL("../../.env", import.meta.url).pathname): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (m?.[1] && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2]?.replace(/^["']|["']$/gu, "") ?? "";
  }
}

export function need(names: readonly string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0)
    throw new Error(`set ${missing.join(", ")} (env or .env; values are never printed)`);
  return Object.fromEntries(names.map((n) => [n, process.env[n] ?? ""]));
}

export function testnetOnly(contract: string, account: string): void {
  if (!contract.endsWith(".testnet") || !account.endsWith(".testnet"))
    throw new Error("testnet only: KEYLEASE_CONTRACT_ID and NEAR_ACCOUNT_ID must be .testnet accounts");
}
