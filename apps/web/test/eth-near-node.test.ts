import { describe, expect, it } from "vitest";
import { ethNearNode } from "../lib/selector.ts";

describe("ethNearNode", () => {
  it("passes ethereum-wallets a { url } connection, not a bare string", () => {
    expect(ethNearNode("https://rpc.testnet.near.org")).toEqual({ url: "https://rpc.testnet.near.org" });
  });
});
