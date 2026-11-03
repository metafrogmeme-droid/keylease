/** NEAR access for the CLI: testnet-checked provider, the operator's account, and send-then-poll. */
import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import type { Settings } from "./env.ts";

export interface Chain {
  readonly provider: JsonRpcProvider;
  readonly me: Account;
}

export async function connect(s: Settings): Promise<Chain> {
  if (!s.account || !s.privateKey)
    throw new Error("set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (testnet, env only)");
  const provider = new JsonRpcProvider({ url: s.rpc });
  if ((await provider.getNetworkId()) !== "testnet") throw new Error(`${s.rpc} is not a testnet RPC`);
  return { provider, me: new Account(s.account, provider, s.privateKey as KeyPairString) };
}

/** A read-only provider (views need no key). */
export async function viewer(s: Settings): Promise<JsonRpcProvider> {
  const provider = new JsonRpcProvider({ url: s.rpc });
  if ((await provider.getNetworkId()) !== "testnet") throw new Error(`${s.rpc} is not a testnet RPC`);
  return provider;
}

export async function view<T>(p: JsonRpcProvider, contractId: string, method: string, args = {}): Promise<T> {
  return (await p.callFunction({ contractId, method, args })) as T;
}

export async function exists(p: JsonRpcProvider, accountId: string): Promise<boolean> {
  return p.viewAccount({ accountId }).then(
    () => true,
    () => false,
  );
}

export interface Outcome {
  readonly hash: string;
  readonly ok: boolean;
  /** Return value (decoded) on success, error JSON on failure. */
  readonly text: string;
  readonly logs: string[];
}

/**
 * Send one function call and poll until final: a leased call waits for OutLayer's yield/resume round
 * trip, which can outlast one RPC wait.
 */
export async function callAndWait(
  c: Chain,
  receiverId: string,
  method: string,
  args: Record<string, unknown>,
  deposit: bigint,
  tgas = 300,
): Promise<Outcome> {
  const sent = await c.me.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    waitUntil: "INCLUDED_FINAL",
    throwOnFailure: false,
  });
  const hash = sent.transaction.hash;
  for (let i = 0; i < 60; i += 1) {
    try {
      const st = await c.provider.viewTransactionStatusWithReceipts({
        txHash: hash,
        accountId: c.me.accountId,
        waitUntil: "FINAL",
      });
      const status = st.status as { SuccessValue?: string; Failure?: unknown };
      const logs = st.receipts_outcome.flatMap((o) => o.outcome.logs);
      if (status.SuccessValue !== undefined) {
        return { hash, ok: true, text: Buffer.from(status.SuccessValue, "base64").toString("utf8"), logs };
      }
      if (status.Failure !== undefined)
        return { hash, ok: false, text: JSON.stringify(status.Failure), logs };
    } catch {
      // not final yet, or an RPC timeout: keep polling
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error(`no final outcome for ${hash} within 5 minutes`);
}
