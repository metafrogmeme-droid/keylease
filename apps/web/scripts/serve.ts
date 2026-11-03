/** Serve the static export for the Playwright smoke: node scripts/serve.ts out 4173 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [dir = "out", port = "4173"] = process.argv.slice(2);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

createServer((req, res) => {
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
