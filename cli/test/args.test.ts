import { describe, expect, it } from "vitest";
import { parse } from "../src/args.ts";
import { one } from "../src/commands.ts";

describe("flags, parsed with the CLI's own option table", () => {
  it("kl call --endpoint X gives call() the one endpoint (regression: it said --endpoint is required)", () => {
    const { positionals, values } = parse(["call", "--lease", "1", "--endpoint", "/v1/chat/completions"]);
    expect(positionals).toEqual(["call"]);
    expect(one(values, "endpoint")).toBe("/v1/chat/completions");
    expect(one(values, "lease")).toBe("1");
  });

  it("kl call refuses a missing or a second --endpoint, plainly", () => {
    expect(() => one(parse(["call", "--lease", "1"]).values, "endpoint")).toThrow("--endpoint is required");
    expect(() => one(parse(["call", "--endpoint", "/a", "--endpoint", "/b"]).values, "endpoint")).toThrow(
      "give --endpoint once",
    );
  });

  it("kl lease still takes --endpoint more than once", () => {
    const { values } = parse(["lease", "--endpoint", "/a", "--endpoint", "/b"]);
    expect(values["endpoint"]).toEqual(["/a", "/b"]);
  });

  it("defaults apply and a string flag passes through", () => {
    const { values } = parse(["call", "--method", "GET"]);
    expect(one(values, "method", "POST")).toBe("GET");
    expect(one(values, "deposit", "0.025")).toBe("0.025");
  });
});

describe("kl lease --grantee, by the shared account rule", () => {
  it("takes name.testnet, a 0x address (lowercased) and a 64-hex implicit account", async () => {
    const { granteeOf } = await import("../src/commands.ts");
    expect(granteeOf(parse(["lease", "--grantee", "agent.testnet"]).values)).toBe("agent.testnet");
    expect(
      granteeOf(parse(["lease", "--grantee", "0x020A4366595292aa16184536BAB2e9949d0d925F"]).values),
    ).toBe("0x020a4366595292aa16184536bab2e9949d0d925f");
    const hex64 = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    expect(granteeOf(parse(["lease", "--grantee", hex64]).values)).toBe(hex64);
  });

  it("refuses mainnet, short 0x and a missing flag before any transaction", async () => {
    const { granteeOf } = await import("../src/commands.ts");
    expect(() => granteeOf(parse(["lease", "--grantee", "agent.near"]).values)).toThrow(/--grantee: Mainnet/);
    expect(() => granteeOf(parse(["lease", "--grantee", "0x1234"]).values)).toThrow(/0x and 40 hex/);
    expect(() => granteeOf(parse(["lease"]).values)).toThrow("--grantee is required");
  });
});
