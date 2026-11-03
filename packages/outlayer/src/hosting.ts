/**
 * Where OutLayer fetches the proxy builds from. Default: FastFS. Fallback: any public https URL you host
 * (`--wasm-url-a` / `--wasm-url-b`), checked here the way OutLayer's worker fetches a `WasmUrl`
 * (worker/src/compiler/mod.rs at OutLayer commit aaf60a2): https on the default port, no credentials,
 * at most 3 redirects, unauthenticated GET, at most 10 MB, sha256 equal to the source's hash.
 * A file in a private GitHub repo (release asset or raw URL) needs authentication, so the worker cannot
 * fetch it.
 */
import { createHash } from "node:crypto";

export const MAX_REDIRECTS = 3;
export const MAX_WASM_BYTES = 10 * 1024 * 1024;

/** Why OutLayer's worker would refuse this URL, or undefined when it is acceptable. */
export function urlProblem(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (u.protocol !== "https:") return "must be https://";
  if (u.port !== "") return "must use the default port (443)";
  if (u.username !== "" || u.password !== "") return "must not carry credentials";
  if (u.hostname === "") return "has no host";
  return undefined;
}

export type Fetcher = (url: string, init: { redirect: "manual" }) => Promise<Response>;

/** GET like the worker: follow at most 3 redirects, each URL checked; return the body bytes. */
export async function fetchLikeWorker(raw: string, fetcher: Fetcher = fetch): Promise<Uint8Array> {
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const problem = urlProblem(url);
    if (problem) throw new Error(`${url} ${problem}`);
    const res = await fetcher(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`${url} redirects without a location`);
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${url} answered HTTP ${String(res.status)}`);
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length > MAX_WASM_BYTES) throw new Error(`${url} is over 10 MB`);
    return body;
  }
  throw new Error(`${raw} redirects more than ${String(MAX_REDIRECTS)} times`);
}

/** Preflight for a self-hosted build: fetchable like the worker does it, and the exact bytes we built. */
export async function checkHosted(
  url: string,
  expectedSha256: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const body = await fetchLikeWorker(url, fetcher);
  const got = createHash("sha256").update(body).digest("hex");
  if (got !== expectedSha256) {
    throw new Error(
      `${url} serves sha256 ${got}, the local build is ${expectedSha256}: upload the file from spike/artifacts`,
    );
  }
}

/** The value of `--name <value>` or `--name=<value>` in argv, if given. */
export function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}
