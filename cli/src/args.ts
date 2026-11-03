/** The CLI's flags (node:util parseArgs). `--endpoint` repeats for `kl lease`; `kl call` takes one. */
import { parseArgs } from "node:util";

const s = { type: "string" } as const;

export const OPTIONS = {
  fund: s,
  wasm: s,
  proxy: s,
  "proxy-url": s,
  "key-env": s,
  "base-url": s,
  provider: s,
  profile: s,
  label: s,
  key: s,
  grantee: s,
  calls: s,
  for: s,
  endpoint: { type: "string", multiple: true },
  lease: s,
  method: s,
  body: s,
  deposit: s,
  everything: { type: "boolean" },
} as const;

export function parse(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options: OPTIONS });
}
