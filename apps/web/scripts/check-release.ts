/** Fails if a build meant for release contains the test-only wallet (lib/test-wallet.ts). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "keylease-e2e-test-wallet";
const dir = process.argv[2] ?? "out";
const hits = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
  (f) => /\.(js|html|txt)$/u.test(f) && readFileSync(join(dir, f), "utf8").includes(MARKER),
);
if (hits.length > 0) throw new Error(`test wallet found in the build: ${hits.join(", ")}`);
console.warn(`release check: no test wallet in ${dir}`);
