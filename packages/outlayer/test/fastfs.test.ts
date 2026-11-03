import { describe, expect, it } from "vitest";
import { fastfsPayload, fastfsUrl } from "../src/fastfs.ts";

describe("FastFS payload", () => {
  it("matches the Borsh layout of FastfsData::Simple", () => {
    const hash = "ab".repeat(32);
    const p = fastfsPayload(hash, new Uint8Array([0, 1, 2, 3]));
    expect(p[0]).toBe(0); // enum variant Simple
    const name = `${hash}.wasm`;
    expect(p.readUInt32LE(1)).toBe(name.length);
    expect(p.subarray(5, 5 + name.length).toString()).toBe(name);
    let o = 5 + name.length;
    expect(p[o]).toBe(1); // Some
    o += 1;
    expect(p.readUInt32LE(o)).toBe("application/wasm".length);
    o += 4 + "application/wasm".length;
    expect(p.readUInt32LE(o)).toBe(4);
    expect([...p.subarray(o + 4)]).toEqual([0, 1, 2, 3]);
  });

  it("builds the testnet URL", () => {
    expect(fastfsUrl("alice.testnet", "outlayer.testnet", "cd".repeat(32))).toBe(
      `https://test.fastfs.io/alice.testnet/outlayer.testnet/${"cd".repeat(32)}.wasm`,
    );
  });
});
