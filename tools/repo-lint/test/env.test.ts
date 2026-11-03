import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkEnvExample, checkTrackedEnvFiles } from "../src/env.ts";

describe(".env.example", () => {
  it("accepts names with empty values and comments", () => {
    expect(checkEnvExample("# NEAR\nNEAR_ACCOUNT_ID=\n\nOUTLAYER_PAYMENT_KEY=\n")).toEqual([]);
  });

  it("rejects any value", () => {
    expect(checkEnvExample("NEAR_ACCOUNT_ID=alice.testnet\n")[0]).toMatch(/has a value/u);
  });

  it("rejects duplicates, bad names and an empty file", () => {
    expect(checkEnvExample("A=\nA=\n")[0]).toMatch(/twice/u);
    expect(checkEnvExample("lower=\n")[0]).toMatch(/not NAME=/u);
    expect(checkEnvExample("# only a comment\n")[0]).toMatch(/no names/u);
  });

  it("the repo file passes", () => {
    expect(checkEnvExample(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"))).toEqual(
      [],
    );
  });
});

describe("tracked env files", () => {
  it("flags .env and .env.local but not .env.example", () => {
    expect(checkTrackedEnvFiles([".env", "apps/web/.env.local", ".env.example", "env.ts"])).toEqual([
      ".env is tracked; env files must stay local",
      "apps/web/.env.local is tracked; env files must stay local",
    ]);
  });
});
