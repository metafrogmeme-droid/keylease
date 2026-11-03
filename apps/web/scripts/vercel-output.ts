/**
 * Writes Vercel's Build Output API v3 tree (`.vercel/output`) from the static export in `out/`: the pages
 * as static files; two edge functions, the OutLayer pubkey relay at `/api/secrets/pubkey` (E-017) and the
 * demo API at `/mock/*` (D3); and the response headers a meta CSP cannot set (T8).
 * Usage: node scripts/vercel-output.ts [out] [dest]
 * Spec: https://vercel.com/docs/build-output-api/v3
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

export const HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "x-frame-options": "DENY",
};

/** Edge functions: source in functions/, route in the output. */
export const FUNCTIONS: readonly (readonly [string, string])[] = [
  ["pubkey", "api/secrets/pubkey"],
  ["mock", "api/mock"],
];

export async function writeOutput(outDir: string, dest: string): Promise<void> {
  if (!existsSync(join(outDir, "index.html")))
    throw new Error(`no static export in ${outDir}; run next build first`);
  rmSync(dest, { recursive: true, force: true });
  cpSync(outDir, join(dest, "static"), { recursive: true });

  for (const [entry, route] of FUNCTIONS) {
    const fn = join(dest, "functions", `${route}.func`);
    mkdirSync(fn, { recursive: true });
    await build({
      entryPoints: [new URL(`../functions/${entry}.ts`, import.meta.url).pathname],
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      outfile: join(fn, "index.js"),
      legalComments: "none",
      logLevel: "warning",
    });
    writeFileSync(
      join(fn, ".vc-config.json"),
      JSON.stringify({ runtime: "edge", entrypoint: "index.js" }, null, 2),
    );
  }

  const config = {
    version: 3,
    routes: [
      { src: "/(.*)", headers: HEADERS, continue: true },
      // The demo API: /mock/<path> goes to the mock function (lib/mock-edge.ts reads either URL form).
      { src: "^/mock(?:/(.*))?$", dest: "/api/mock?path=$1" },
      { handle: "filesystem" },
      { handle: "error" },
      { status: 404, src: "/(.*)", dest: "/404.html" },
    ],
  };
  writeFileSync(join(dest, "config.json"), JSON.stringify(config, null, 2));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [out = "out", dest = ".vercel/output"] = process.argv.slice(2);
  await writeOutput(out, dest);
  console.warn(`vercel output: ${dest} (static + edge functions /api/secrets/pubkey, /mock/*)`);
}
