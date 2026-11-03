/** Post-build step: write the CSP meta tag into every exported HTML page. Usage: node scripts/csp.ts out */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
import { withCsp } from "../lib/csp.ts";
import { sources } from "../lib/wallets.ts";

// Same .env files and order as `next build`, so the policy matches what was inlined into the pages.
nextEnv.loadEnvConfig(process.cwd());
const { config } = await import("../lib/config.ts");
const src = sources(config);

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/csp.ts <export dir>");
const pages = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".html"));
if (pages.length === 0) throw new Error(`no .html pages in ${dir}`);
for (const page of pages) {
  const file = join(dir, page);
  writeFileSync(file, withCsp(readFileSync(file, "utf8"), src));
}
console.warn(
  `csp: ${String(pages.length)} pages, WalletConnect ${config.reownProjectId ? "on" : "not configured"}`,
);
