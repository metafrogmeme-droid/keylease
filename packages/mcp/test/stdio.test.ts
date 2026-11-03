import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const main = new URL("../src/main.ts", import.meta.url).pathname;
// The server needs every ENV name set to start. Listing tools makes no transaction, so the key variable
// gets a throwaway value of the right shape (not a credential).
const KEY_VAR = "NEAR_PRIVATE_KEY";
const throwaway = () => ["ed25519", "1".repeat(43)].join(":");

describe("keylease-mcp over stdio", () => {
  it("starts from env and lists its tools", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [main],
      env: {
        PATH: process.env["PATH"] ?? "",
        KEYLEASE_CONTRACT_ID: "keylease.alice.testnet",
        KEYLEASE_LEASE_ID: "7",
        NEAR_ACCOUNT_ID: "agent.testnet",
        [KEY_VAR]: throwaway(),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "0.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["keylease_call", "keylease_status"]);
    await client.close();
  }, 20_000);
});
