/** Default transport: near-api-js on NEAR testnet, the key from env or options, never printed. */
import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import { TxFailed, type Sent, type Transport } from "./transport.ts";

export const TESTNET_RPC = "https://rpc.testnet.near.org";

export interface NearOptions {
  readonly account: string;
  /** `ed25519:…`; read from env by the caller, never logged. */
  readonly privateKey: string;
  readonly rpc?: string;
}

function decode(b64: string): unknown {
  const text = Buffer.from(b64, "base64").toString("utf8");
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function nearTransport(o: NearOptions): Promise<Transport> {
  if (!o.account.endsWith(".testnet"))
    throw new Error("KeyLease SDK: the account must be a .testnet account");
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/u.test(o.privateKey))
    throw new Error("KeyLease SDK: NEAR_PRIVATE_KEY must be an ed25519:… key");
  const provider = new JsonRpcProvider({ url: o.rpc ?? TESTNET_RPC });
  if ((await provider.getNetworkId()) !== "testnet")
    throw new Error("KeyLease SDK: the RPC is not NEAR testnet");
  const me = new Account(o.account, provider, o.privateKey as KeyPairString);
  return {
    account: o.account,
    view: async <T>(contractId: string, method: string, args: object) =>
      (await provider.callFunction({ contractId, method, args: args as Record<string, unknown> })) as T,
    async call(receiverId, method, args, deposit, tgas): Promise<Sent> {
      const sent = await me.signAndSendTransaction({
        receiverId,
        actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
        waitUntil: "INCLUDED_FINAL",
        throwOnFailure: false,
      });
      const hash = sent.transaction.hash;
      // A leased call waits for OutLayer's yield/resume round trip; poll until it is final.
      for (let i = 0; i < 60; i += 1) {
        try {
          const st = await provider.viewTransactionStatusWithReceipts({
            txHash: hash,
            accountId: o.account,
            waitUntil: "FINAL",
          });
          const status = st.status as { SuccessValue?: string; Failure?: unknown };
          const logs = st.receipts_outcome.flatMap((r) => r.outcome.logs);
          if (status.SuccessValue !== undefined) return { hash, value: decode(status.SuccessValue), logs };
          if (status.Failure !== undefined) throw new TxFailed(hash, JSON.stringify(status.Failure));
        } catch (e) {
          if (e instanceof TxFailed) throw e;
          // not final yet, or an RPC timeout: keep polling
        }
        await new Promise((ok) => setTimeout(ok, 5000));
      }
      throw new Error(`KeyLease SDK: no final outcome for ${hash} within 5 minutes`);
    },
  };
}
