import { describe, expect, it } from "vitest";
import { view } from "../lib/near-rpc.ts";
import { baseUrlProblem, labelProblem, newProfile, PROVIDERS } from "../lib/rules.ts";

describe("form rules mirror crates/keylease-rules", () => {
  it("accepts https base URLs with a plain host and path", () => {
    for (const u of ["https://api.openai.com/v1", "https://mock.example", "https://h:8443/a/b-c_d.e~f"])
      expect(baseUrlProblem(u), u).toBeNull();
  });

  it("refuses what the contract refuses", () => {
    for (const u of [
      "http://api.example",
      "https://",
      "https://API.example",
      "https://a.example/",
      "https://a.example//v1",
      "https://a.example/../v1",
      "https://a.example/v1?x=1",
      "https://user@a.example",
      `https://a.example/${"x".repeat(200)}`,
    ])
      expect(baseUrlProblem(u), u).not.toBeNull();
  });

  it("presets have valid base URLs (Custom starts empty)", () => {
    for (const p of PROVIDERS) if (p.baseUrl !== "") expect(baseUrlProblem(p.baseUrl), p.id).toBeNull();
  });

  it("labels are 1-64 printable ASCII", () => {
    expect(labelProblem("demo key")).toBeNull();
    expect(labelProblem("")).not.toBeNull();
    expect(labelProblem("x".repeat(65))).not.toBeNull();
    expect(labelProblem("tab\there")).not.toBeNull();
  });

  it("makes a fresh OutLayer profile per key", () => {
    expect(newProfile(() => new Uint8Array([0, 1, 2, 171, 205, 239]))).toBe("kl-000102abcdef");
    expect(newProfile()).toMatch(/^kl-[0-9a-f]{12}$/);
    expect(newProfile()).not.toBe(newProfile());
  });
});

describe("RPC view", () => {
  it("decodes the result bytes and surfaces errors", async () => {
    const ok = () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: { result: [...new TextEncoder().encode('{"a":1}')] } })),
      );
    expect(await view("https://rpc", "c.testnet", "m", {}, ok)).toEqual({ a: 1 });
    const err = () =>
      Promise.resolve(new Response(JSON.stringify({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } })));
    await expect(view("https://rpc", "c.testnet", "m", {}, err)).rejects.toThrow(/UNKNOWN_ACCOUNT/);
    const http = () => Promise.resolve(new Response("", { status: 502 }));
    await expect(view("https://rpc", "c.testnet", "m", {}, http)).rejects.toThrow(/502/);
  });
});
