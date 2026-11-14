/**
 * Serve the static export locally (Playwright smoke, VERIFY by hand), with the same OutLayer pubkey relay
 * as the hosted app at POST /api/secrets/pubkey. Usage: node scripts/serve.ts out 4173
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { relayPubkey } from "../lib/relay.ts";

const [dir = "out", port = "4173"] = process.argv.slice(2);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function relay(req: import("node:http").IncomingMessage): Promise<Response> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("x-real-ip", req.socket.remoteAddress ?? "?");
  const body = req.method === "GET" || req.method === "HEAD" ? null : Buffer.concat(chunks);
  return relayPubkey(
    new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      body,
    }),
  );
}

createServer((req, res) => {
  if ((req.url ?? "").split("?")[0] === "/api/secrets/pubkey") {
    void relay(req).then(async (r) => {
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
    });
    return;
  }
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const rel = normalize(path.endsWith("/") ? `${path}index.html` : path).replace(/^(\.\.[/\\])+/, "");
  readFile(join(dir, rel)).then(
    (body) => {
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    },
    () => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    },
  );
}).listen(Number(port), "127.0.0.1");
