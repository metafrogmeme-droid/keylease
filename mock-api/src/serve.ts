#!/usr/bin/env node
// Local dev server for the mock API: `MOCK_API_KEY=… PORT=8787 node mock-api/src/serve.ts`.
import { createServer } from "node:http";
import { handle, headerObject } from "./handler.ts";

const port = Number(process.env["PORT"] ?? "8787");
createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const method = req.method ?? "GET";
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
