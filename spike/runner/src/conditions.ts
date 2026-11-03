/** Access conditions for OutLayer secrets, in the contract's JSON shape. */
export type Condition =
  | { Logic: { operator: "And" | "Or"; conditions: Condition[] } }
  | { Predecessor: { condition: Condition } }
  | { Whitelist: { accounts: string[] } }
  | { WasmHash: { hash: string } }
  | "AllowAll";

const HASH = /^[0-9a-f]{64}$/u;

export function wasmHash(hash: string): Condition {
  if (!HASH.test(hash)) throw new Error("wasm hash must be 64 lowercase hex chars");
  return { WasmHash: { hash } };
}

/** The KeyLease lock: only `contractId` calling OutLayer, only this exact proxy build. */
export function leaseLock(contractId: string, proxyHash: string): Condition {
  return {
    Logic: {
      operator: "And",
      conditions: [
        { Predecessor: { condition: { Whitelist: { accounts: [contractId] } } } },
        wasmHash(proxyHash),
      ],
    },
  };
}
