#!/usr/bin/env node
// Local server for the mock API: `MOCK_API_KEY=… PORT=8787 [WASM_DIR=target/proxy] node mock-api/src/serve.ts`.
// With WASM_DIR set it also serves GET /wasm/<name>.wasm from that folder, publicly (see files.ts).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { wasmFile } from "./files.ts";
import { handle, headerObject } from "./handler.ts";

const port = Number(process.env["PORT"] ?? "8787");
createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const method = req.method ?? "GET";
    const file =
      method === "GET"
        ? wasmFile(process.env["WASM_DIR"], new URL(req.url ?? "/", "http://x").pathname)
        : undefined;
    if (file) {
      readFile(file).then(
        (bytes) => {
          res.writeHead(200, { "content-type": "application/wasm", "content-length": String(bytes.length) });
          res.end(bytes);
        },
        () => {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(
            '{"error":{"message":"No such wasm file.","type":"invalid_request_error","param":null,"code":"not_found"}}',
          );
        },
      );
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const body = method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks);
    const request = new Request(`http://localhost:${String(port)}${req.url ?? "/"}`, {
      method,
      headers,
      body,
    });
    void handle(request, { MOCK_API_KEY: process.env["MOCK_API_KEY"] }).then(async (r) => {
      res.writeHead(r.status, headerObject(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
}).listen(port, () => {
  console.warn(`mock API on http://localhost:${String(port)}`);
});
