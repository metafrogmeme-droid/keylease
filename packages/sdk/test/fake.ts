/** A fake NEAR for SDK tests: records calls, answers like the KeyLease contract would. */
import { TxFailed, type Sent, type Transport } from "../src/transport.ts";

export interface Recorded {
  readonly contract: string;
  readonly method: string;
  readonly args: Record<string, unknown>;
  readonly deposit?: bigint;
  readonly tgas?: number;
}

export function fake(answer: (r: Recorded) => Sent | TxFailed, views: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const transport: Transport = {
    account: "agent.testnet",
    view: <T>(contract: string, method: string, args: object) => {
      calls.push({ contract, method, args: args as Record<string, unknown> });
      return Promise.resolve(views[method] as T);
    },
    call: (contract, method, args, deposit, tgas) => {
      const r = { contract, method, args: args as Record<string, unknown>, deposit, tgas };
      calls.push(r);
      const out = answer(r);
      return out instanceof TxFailed ? Promise.reject(out) : Promise.resolve(out);
    },
  };
  return { transport, calls };
}

export const authorized = (call: number) =>
  `EVENT_JSON:${JSON.stringify({ standard: "keylease", version: "1.0.0", event: "call_authorized", data: [{ lease_id: "7", call }] })}`;

export const panic = (code: string, hint: string) =>
  JSON.stringify({
    ActionError: {
      kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${code}: ${hint}` } },
    },
  });
