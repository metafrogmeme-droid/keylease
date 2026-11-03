import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { REFUSALS, TxFailed, lease, type Sent, type Transport } from "@keylease/sdk";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.ts";

function chain(
  answer: (method: string, args: Record<string, unknown>) => Sent | TxFailed,
  views: Record<string, unknown> = {},
) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const transport: Transport = {
    account: "agent.testnet",
    view: <T>(_c: string, method: string) => Promise.resolve(views[method] as T),
    call: (_c, method, args) => {
      calls.push({ method, args: args as Record<string, unknown> });
      const out = answer(method, args as Record<string, unknown>);
      return out instanceof TxFailed ? Promise.reject(out) : Promise.resolve(out);
    },
  };
  return { transport, calls };
}

async function connect(transport: Transport) {
  const server = createServer(lease({ contract: "keylease.alice.testnet", leaseId: "7", transport }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

describe("KeyLease MCP server", () => {
  it("offers keylease_call and keylease_status, and neither takes a key", async () => {
    const client = await connect(chain(() => ({ hash: "", value: null, logs: [] })).transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["keylease_call", "keylease_status"]);
    const call = tools.find((t) => t.name === "keylease_call");
    expect(Object.keys((call?.inputSchema as { properties: object }).properties).sort()).toEqual([
      "body",
      "endpoint",
      "method",
    ]);
    // No tool input can carry a key: the only inputs are the endpoint, a body and a method.
    for (const t of tools)
      expect(Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).join(",")).not.toMatch(
        /key|secret|private|token/iu,
      );
  });

  it("keylease_call makes one leased call and returns data and the receipt", async () => {
    const c = chain(() => ({
      hash: "McpTx",
      value: {
        v: 1,
        ok: true,
        status: 200,
        body: '{"answer":42}',
        body_encoding: "utf8",
        body_sha256: "",
        redacted: false,
      },
      logs: [],
    }));
    const client = await connect(c.transport);
    const r = await client.callTool({
      name: "keylease_call",
      arguments: { endpoint: "/chat/completions", body: '{"q":1}' },
    });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r))).toMatchObject({
      status: 200,
      data: { answer: 42 },
      receipt: { tx: "McpTx" },
    });
    expect(c.calls).toEqual([
      {
        method: "use_lease",
        args: { lease_id: "7", endpoint: "/chat/completions", method: "POST", body: '{"q":1}' },
      },
    ]);
  });

  it("a refusal comes back as a tool error with the code, the sentence and the receipt", async () => {
    const hint = REFUSALS["endpoint_not_in_lease"] ?? "";
    const panic = JSON.stringify({
      ExecutionError: `Smart contract panicked: endpoint_not_in_lease: ${hint}`,
    });
    const client = await connect(chain(() => new TxFailed("RefusedTx", panic)).transport);
    const r = await client.callTool({
      name: "keylease_call",
      arguments: { endpoint: "/admin/keys", body: "{}" },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe(
      `endpoint_not_in_lease: ${hint} (receipt https://testnet.nearblocks.io/txns/RefusedTx)`,
    );
  });

  it("refuses a body that is not JSON before any transaction", async () => {
    const c = chain(() => ({ hash: "", value: null, logs: [] }));
    const client = await connect(c.transport);
    const r = await client.callTool({
      name: "keylease_call",
      arguments: { endpoint: "/chat/completions", body: "not json" },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/body must be JSON/);
    expect(c.calls).toEqual([]);
  });

  it("keylease_status returns the lease, or lease_not_found", async () => {
    const lv = {
      lease_id: "7",
      grantee: "agent.testnet",
      calls_used: 1,
      calls_left: 9,
      expires_at: "1",
      endpoints: ["/chat/completions"],
      status: "active",
    };
    const ok = await connect(chain(() => ({ hash: "", value: null, logs: [] }), { get_lease: lv }).transport);
    expect(JSON.parse(textOf(await ok.callTool({ name: "keylease_status", arguments: {} })))).toEqual(lv);
    const none = await connect(
      chain(() => ({ hash: "", value: null, logs: [] }), { get_lease: null }).transport,
    );
    const r = await none.callTool({ name: "keylease_status", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^lease_not_found: /);
  });
});
