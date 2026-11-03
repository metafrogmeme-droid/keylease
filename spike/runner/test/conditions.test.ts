import { describe, expect, it } from "vitest";
import { leaseLock, wasmHash } from "../src/conditions.ts";

describe("lease lock condition", () => {
  it("is Predecessor[contract] AND WasmHash[proxy]", () => {
    const h = "0f".repeat(32);
    expect(leaseLock("kl.alice.testnet", h)).toEqual({
      Logic: {
        operator: "And",
        conditions: [
          { Predecessor: { condition: { Whitelist: { accounts: ["kl.alice.testnet"] } } } },
          { WasmHash: { hash: h } },
        ],
      },
    });
  });

  it("refuses an uppercase or short hash (the contract requires 64 lowercase hex)", () => {
    expect(() => wasmHash("0F".repeat(32))).toThrow();
    expect(() => wasmHash("0f")).toThrow();
  });
});
