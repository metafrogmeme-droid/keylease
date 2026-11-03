/**
 * KeyLease MCP server. Two tools for an agent: `keylease_call` (one leased API call) and `keylease_status`
 * (calls left, expiry, endpoints). The agent holds a lease id and its own NEAR account; the API key stays
 * sealed in OutLayer's TEE. Refusals come back as tool errors with the code and sentence from
 * docs/WORDING.md, so the agent can say what to do next.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KeyLeaseError, type Lease } from "@keylease/sdk";
import { z } from "zod";

/** What the server reads from env (names only; the MCP snippet in Share lists exactly these). */
export const ENV = [
  "KEYLEASE_CONTRACT_ID",
  "KEYLEASE_LEASE_ID",
  "NEAR_ACCOUNT_ID",
  "NEAR_PRIVATE_KEY",
] as const;
export const BIN = "keylease-mcp";
export const PACKAGE = "@keylease/mcp";
export const VERSION = "0.1.0";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function refused(e: unknown) {
  if (e instanceof KeyLeaseError)
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `${e.code}: ${e.hint}${e.receipt ? ` (receipt ${e.receipt.url})` : ""}`,
        },
      ],
    };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `call failed: ${e instanceof Error ? e.message : String(e)}` }],
  };
}

export function createServer(lease: Lease): McpServer {
  const server = new McpServer({ name: "keylease", version: VERSION });

  server.registerTool(
    "keylease_call",
    {
      title: "Leased API call",
      description:
        "Make one API call with the KeyLease lease. Only the lease's endpoints are allowed; each call uses one from the lease's quota. The API key is never visible to you.",
      inputSchema: {
        endpoint: z
          .string()
          .describe("Path on the key's base URL, one of the lease's endpoints, e.g. /chat/completions"),
        body: z.string().optional().describe("Request body as JSON text (POST). Omit for GET."),
        method: z.enum(["GET", "POST"]).optional(),
      },
    },
    async ({ endpoint, body, method }) => {
      try {
        const parsed: unknown = body === undefined ? undefined : (JSON.parse(body) as unknown);
        const r = await lease.call(endpoint, parsed, method ? { method } : {});
        return text({ status: r.status, data: r.data, redacted: r.redacted, receipt: r.receipt });
      } catch (e) {
        if (e instanceof SyntaxError) return refused(new Error("body must be JSON text"));
        return refused(e);
      }
    },
  );

  server.registerTool(
    "keylease_status",
    {
      title: "Lease status",
      description:
        "Calls used and left, expiry, endpoints and status of the KeyLease lease. Free: no transaction.",
    },
    async () => {
      try {
        const s = await lease.status();
        return s === null
          ? refused(
              new KeyLeaseError(
                "lease_not_found",
                "No lease has this id; check the lease id you were given.",
                null,
              ),
            )
          : text(s);
      } catch (e) {
        return refused(e);
      }
    },
  );

  return server;
}
