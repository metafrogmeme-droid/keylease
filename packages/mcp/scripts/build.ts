/** Bundle the server into one runnable file for `npx @keylease/mcp` (dist/keylease-mcp.mjs). */
import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/main.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: new URL("../dist/keylease-mcp.mjs", import.meta.url).pathname,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "warning",
});
console.warn("built dist/keylease-mcp.mjs");
