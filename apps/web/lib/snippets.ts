/**
 * What a lease holder copies: a link, an SDK snippet, a `near` CLI command, an MCP config block. Each
 * names the contract and the lease id, never a key (brief §4).
 */
export interface ShareInfo {
  readonly origin: string;
  readonly contractId: string;
  readonly leaseId: string;
  readonly grantee: string;
  readonly endpoint: string;
}

export function leaseLink(s: ShareInfo): string {
  return `${s.origin}/lease/?id=${encodeURIComponent(s.leaseId)}`;
}

export function sdkSnippet(s: ShareInfo): string {
  return [
    "npm i @keylease/sdk",
    "",
    'import { lease } from "@keylease/sdk";',
    `const l = lease({ contract: "${s.contractId}", leaseId: "${s.leaseId}" }); // signs as ${s.grantee}`,
    `const { data, receipt } = await l.call("${s.endpoint}", { /* request body */ });`,
  ].join("\n");
}

export function cliSnippet(s: ShareInfo): string {
  const args = JSON.stringify({ lease_id: s.leaseId, endpoint: s.endpoint, method: "POST", body: "{}" });
  return [
    `near contract call-function as-transaction ${s.contractId} use_lease \\`,
    `  json-args '${args}' \\`,
    "  prepaid-gas '300 Tgas' attached-deposit '0.025 NEAR' \\",
    `  sign-as ${s.grantee} network-config testnet sign-with-keychain send`,
  ].join("\n");
}

export function mcpSnippet(s: ShareInfo): string {
  return JSON.stringify(
    {
      mcpServers: {
        keylease: {
          command: "npx",
          args: ["-y", "@keylease/mcp"],
          env: {
            KEYLEASE_CONTRACT_ID: s.contractId,
            KEYLEASE_LEASE_ID: s.leaseId,
            NEAR_ACCOUNT_ID: s.grantee,
            NEAR_PRIVATE_KEY: "<the agent account's own key, from your secret store>",
          },
        },
      },
    },
    null,
    2,
  );
}
