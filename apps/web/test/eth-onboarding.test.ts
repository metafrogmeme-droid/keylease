// @vitest-environment jsdom
/**
 * Drives the patched ethereum-wallets 10.1.4 sign-in (patches/@near-wallet-selector__ethereum-wallets@10.1.4.patch)
 * with a mock MetaMask and mocked RPCs, no network. Checks the free relayer-onboarding AddKey asks for an
 * unlimited key (allowance 0) and that a wallet/RPC failure shows its reason, escaped, in the modal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, type Hex } from "viem";

const RELAYER_HEX = "21dea25fbd244dca1f835a95f02a2e368f5a0dc9a935abd22462c4e9f8e5ecb0";
const ADDRESS = "0x5aac6335daf0d68098670e780357da7e91c45905";
const ABI = parseAbi([
  "function addKey(uint8 public_key_kind, bytes public_key, uint64 nonce, bool is_full_access, bool is_limited_allowance, uint128 allowance, string receiver_id, string[] method_names) external",
]);
const RPC_REASON = 'account is not onboarded or key was revoked; <b>"x"</b>';

function rpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json" },
  });
}

function mockFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as { id: unknown; method: string; params?: unknown };
    if (body.method === "near_getPublicKey")
      return Promise.resolve(rpcResult(body.id, { public_key: RELAYER_HEX }));
    if (body.method === "query")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              error: `access key ${ADDRESS} does not exist while viewing`,
              logs: [],
              block_height: 1,
              block_hash: "x",
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    return Promise.resolve(rpcResult(body.id, body.method === "eth_chainId" ? "0x18e" : null));
  });
}

function mockMetaMask(sent: Array<Record<string, string>>) {
  return {
    isMetaMask: true,
    on: () => undefined,
    removeListener: () => undefined,
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      await Promise.resolve();
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [ADDRESS];
        case "eth_chainId":
          return "0x18e";
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "eth_sendTransaction":
          sent.push(params?.[0] as Record<string, string>);
          throw Object.assign(new Error(RPC_REASON), { code: -32000 });
        case "wallet_sendTransaction": // MetaMask has no wallet_ namespace send
          throw Object.assign(new Error("method not found"), { code: -32601 });
        default:
          return null;
      }
    },
  };
}

async function until<T>(f: () => T | null | undefined, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ethereum-wallets onboarding (patched)", () => {
  it(
    "sends the relayer AddKey with allowance 0 and shows the escaped failure reason",
    { timeout: 20_000 },
    async () => {
      const sent: Array<Record<string, string>> = [];
      vi.stubGlobal("fetch", mockFetch());
      Object.assign(window, { ethereum: mockMetaMask(sent) });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const [core, eth, wagmi, chains] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/ethereum-wallets"),
        import("@wagmi/core"),
        import("viem/chains"),
      ]);
      const wagmiConfig = wagmi.createConfig({
        chains: [chains.nearTestnet],
        transports: { [chains.nearTestnet.id]: wagmi.http() },
        connectors: [wagmi.injected()],
      });
      const selector = await core.setupWalletSelector({
        network: "testnet",
        modules: [
          eth.setupEthereumWallets({
            wagmiConfig,
            wagmiCore: wagmi,
            chainId: 398,
            nearNodeUrl: { url: "https://rpc.testnet.near.org" } as unknown as string,
          }),
        ],
      });
      const wallet = await selector.wallet("ethereum-wallets");
      const signIn = wallet.signIn({ contractId: "keylease.testnet", methodNames: [], accounts: [] });
      signIn.catch(() => undefined);

      (await until(() => document.querySelector<HTMLButtonElement>("#confirm-btn-0"))).click();
      const shown = await until(() => document.querySelector(".ethereum-wallet-tx-error"));

      expect(sent).toHaveLength(1);
      const [tx] = sent;
      if (!tx) throw new Error("no eth_sendTransaction");
      expect(tx["gasPrice"]).toBe("0x1");
      const { functionName, args } = decodeFunctionData({ abi: ABI, data: tx["data"] as Hex });
      expect(functionName).toBe("addKey");
      expect(args[1]).toBe(`0x${RELAYER_HEX}`);
      expect(args[4]).toBe(false); // is_limited_allowance
      expect(args[5]).toBe(0n); // allowance: the relayer only takes the free tx for an unlimited key
      expect(args[6]).toBe(ADDRESS);
      expect(args[7]).toEqual(["rlp_execute"]);

      expect(shown.textContent).toContain("Transaction execution error.");
      expect(shown.textContent).toContain('account is not onboarded or key was revoked; <b>"x"</b>');
      expect(shown.innerHTML).not.toContain("<b>");
      expect(errors).toHaveBeenCalledWith(
        "[ethereum-wallets] transaction request failed:",
        expect.anything(),
      );

      document.querySelector<HTMLButtonElement>(".ethereum-wallet-btn-cancel")?.click();
      await expect(signIn).rejects.toBeDefined();
    },
  );
});
