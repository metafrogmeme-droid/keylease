/**
 * Optional public wasm files next to the mock API, so one tunnel can serve both (D3): `GET /wasm/<name>.wasm`
 * from `WASM_DIR`, no key needed, because OutLayer's worker fetches a `WasmUrl` without logging in and the
 * proxy wasm is open source. Only flat `*.wasm` names: no other files, no path segments.
 */
import { join } from "node:path";

const NAME = /^[A-Za-z0-9._-]+\.wasm$/u;

/** The file to serve for a request path, or undefined when the path is not a public wasm file. */
export function wasmFile(dir: string | undefined, pathname: string): string | undefined {
  if (!dir || !pathname.startsWith("/wasm/")) return undefined;
  const name = pathname.slice("/wasm/".length);
  if (!NAME.test(name) || name.startsWith(".")) return undefined;
  return join(dir, name);
}
