# @keylease/mcp

An MCP server that lets an agent (Claude, Cursor, any MCP client) make API calls with a KeyLease lease.
The agent gets two tools and a lease id; the API key stays sealed in OutLayer's TEE.

| Tool              | Input                                             | Result                                                                  |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `keylease_call`   | `endpoint`, optional `body` (JSON text), `method` | `{ status, data, redacted, receipt }`, or a tool error `<code>: <hint>` |
| `keylease_status` | none                                              | calls used and left, expiry, endpoints, status (free, no transaction)   |

Config (the Share box on the lease page fills in the values):

```json
{
  "mcpServers": {
    "keylease": {
      "command": "npx",
      "args": ["-y", "@keylease/mcp"],
      "env": {
        "KEYLEASE_CONTRACT_ID": "keylease.<owner>.testnet",
        "KEYLEASE_LEASE_ID": "7",
        "NEAR_ACCOUNT_ID": "<agent>.testnet",
        "NEAR_PRIVATE_KEY": "<the agent account's own key, from your secret store>"
      }
    }
  }
}
```

`NEAR_PRIVATE_KEY` is the agent's own NEAR account key (it pays the 0.025 NEAR per call), not the API key.
Values come from env only and are never printed; a missing one stops the server with its name.

Until the package is on npm (docs/OPEN_QUESTIONS.md Q-012), run it from this repo:
`pnpm --filter @keylease/mcp build`, then use `"command": "node", "args": ["<repo>/packages/mcp/dist/keylease-mcp.mjs"]`.
Testnet only, like `@keylease/sdk`.
