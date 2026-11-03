/**
 * Content Security Policy for the static export (T8). A static host cannot be relied on for headers, so
 * the build writes a `<meta http-equiv>` policy into every page: scripts only from this origin plus the
 * sha256 of each inline script Next emits, no third-party scripts, connections only to the testnet RPC and
 * the OutLayer API. `frame-ancestors` cannot be set by a meta tag; the host adds it as a header (D3).
 */
import { createHash } from "node:crypto";

export const CONNECT_SRC = ["'self'", "https://rpc.testnet.near.org", "https://testnet-api.outlayer.ai"];

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

/** sha256 source expressions for every inline script in `html`, in order, without duplicates. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    const body = m[1] ?? "";
    if (body.trim() === "") continue;
    out.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...out];
}

export function policy(scriptHashes: readonly string[], connectSrc: readonly string[] = CONNECT_SRC): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trimEnd(),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** Insert the policy right after `<meta charset>` (or first in `<head>`). Fails if a policy is already there. */
export function withCsp(html: string, connectSrc?: readonly string[]): string {
  if (html.includes('http-equiv="Content-Security-Policy"')) throw new Error("page already has a CSP");
  const head = /<meta charset="utf-8"\/?>/i.exec(html) ?? /<head[^>]*>/.exec(html);
  if (!head) throw new Error("page has no <head>");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(inlineScriptHashes(html), connectSrc)}"/>`;
  const at = head.index + head[0].length;
  return html.slice(0, at) + meta + html.slice(at);
}
