#!/usr/bin/env node
/** Start the KeyLease MCP server on stdio. Config from env only (see ENV); nothing secret is printed. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { leaseFromEnv } from "@keylease/sdk";
import { ENV, createServer } from "./server.ts";

const missing = ENV.filter((n) => !process.env[n]);
if (missing.length > 0) {
  console.error(`keylease-mcp: set ${missing.join(", ")} (env only; values are never printed)`);
  process.exit(1);
}
await createServer(leaseFromEnv()).connect(new StdioServerTransport());
