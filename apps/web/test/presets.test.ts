import { describe, expect, it } from "vitest";
import { qrPath } from "../components/Qr.tsx";
import { leaseTx, LEASE_DEPOSIT } from "../lib/lease.ts";
import {
  parseEndpoints,
  defaultEndpoints,
  granteeId,
  leaseProblem,
  PRESETS,
  expiresAtNs,
} from "../lib/presets.ts";
import { cliSnippet, leaseLink, mcpSnippet, sdkSnippet } from "../lib/snippets.ts";

const OK = { grantee: "agent.testnet", calls: 100, hours: 24, endpoints: ["/chat/completions"] };

describe("presets (brief §4)", () => {
  it("are the three named presets", () => {
    expect(PRESETS.map((p) => [p.label, p.calls, p.hours])).toEqual([
      ["My agent, 1 day, 100 calls", 100, 24],
      ["Teammate, 7 days, 500 calls", 500, 168],
      ["Demo, 1 hour, 10 calls", 10, 1],
    ]);
    for (const p of PRESETS) expect(leaseProblem({ ...OK, calls: p.calls, hours: p.hours })).toBeNull();
  });

  it("pick endpoints by provider; Custom keys need them typed", () => {
    expect(defaultEndpoints("NearAiCloud")).toEqual(["/chat/completions"]);
    expect(defaultEndpoints("AnthropicCompatible")).toEqual(["/messages"]);
    expect(defaultEndpoints("Custom")).toEqual([]);
    expect(parseEndpoints(" /a, /b\n/c ")).toEqual(["/a", "/b", "/c"]);
  });

  it("take EVM (0x, any case) and 64-hex implicit grantees; the form sends the lowercase id", () => {
    const eth = "0x020a4366595292aa16184536bab2e9949d0d925f";
    expect(leaseProblem({ ...OK, grantee: eth })).toBeNull();
    expect(leaseProblem({ ...OK, grantee: "0x020A4366595292aa16184536BAB2e9949d0d925F" })).toBeNull();
    expect(granteeId(" 0x020A4366595292aa16184536BAB2e9949d0d925F ")).toBe(eth);
    expect(
      leaseProblem({ ...OK, grantee: "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de" }),
    ).toBeNull();
  });

  it("refuse what the contract refuses", () => {
    expect(leaseProblem({ ...OK, grantee: "agent.near" })).toMatch(/mainnet/i);
    expect(leaseProblem({ ...OK, grantee: "0xabc" })).toMatch(/0x and 40 hex/);
    expect(leaseProblem({ ...OK, grantee: "" })).toMatch(/Give an account/);
    expect(leaseProblem({ ...OK, calls: 0 })).toMatch(/Calls/);
    expect(leaseProblem({ ...OK, calls: 1.5 })).toMatch(/Calls/);
    expect(leaseProblem({ ...OK, calls: 1_000_001 })).toMatch(/Calls/);
    expect(leaseProblem({ ...OK, hours: 0 })).toMatch(/Expiry/);
    expect(leaseProblem({ ...OK, hours: 365 * 24 + 1 })).toMatch(/Expiry/);
    expect(leaseProblem({ ...OK, endpoints: [] })).toMatch(/endpoint/);
    expect(leaseProblem({ ...OK, endpoints: ["/a", "/a"] })).toMatch(/distinct/);
    expect(leaseProblem({ ...OK, endpoints: ["/a/../b"] })).toMatch(/plain path/);
    expect(leaseProblem({ ...OK, endpoints: ["chat"] })).toMatch(/plain path/);
    expect(
      leaseProblem({ ...OK, endpoints: Array.from({ length: 17 }, (_, i) => `/e${String(i)}`) }),
    ).toMatch(/16/);
  });

  it("builds create_lease with the expiry in nanoseconds", () => {
    expect(expiresAtNs(1_000, 1)).toBe(1_000n * 1_000_000n + 3_600n * 1_000_000_000n);
    const tx = leaseTx("keylease.alice.testnet", "2", "agent.testnet", 100, 5n, ["/chat/completions"]);
    const f = (tx.actions[0] as { functionCall: { methodName: string; args: Uint8Array; deposit: bigint } })
      .functionCall;
    expect(f.methodName).toBe("create_lease");
    expect(f.deposit).toBe(LEASE_DEPOSIT);
    expect(JSON.parse(new TextDecoder().decode(f.args))).toEqual({
      key_id: "2",
      grantee: "agent.testnet",
      calls: 100,
      expires_at: "5",
      endpoints: ["/chat/completions"],
    });
  });
});

describe("Share", () => {
  const info = {
    origin: "https://kl.example",
    contractId: "keylease.alice.testnet",
    leaseId: "7",
    grantee: "agent.testnet",
    endpoint: "/chat/completions",
  };

  it("every snippet names the contract and lease id and holds no key", () => {
    expect(leaseLink(info)).toBe("https://kl.example/lease/?id=7");
    for (const s of [sdkSnippet(info), cliSnippet(info), mcpSnippet(info)]) {
      expect(s).toContain("keylease.alice.testnet");
      expect(s).toContain("7");
      expect(s).not.toMatch(/sk-|Bearer|KL_API_KEY/u);
    }
    expect(cliSnippet(info)).toContain("attached-deposit '0.025 NEAR'");
    expect(cliSnippet(info)).toContain("sign-as agent.testnet network-config testnet");
    const mcp = JSON.parse(mcpSnippet(info)) as { mcpServers: { keylease: { env: Record<string, string> } } };
    expect(mcp.mcpServers.keylease.env["KEYLEASE_LEASE_ID"]).toBe("7");
    expect(mcp.mcpServers.keylease.env["NEAR_PRIVATE_KEY"]).toMatch(/^</u);
  });

  it("draws a QR code of the link", () => {
    const a = qrPath("https://kl.example/lease/?id=7");
    expect(a.size).toBeGreaterThanOrEqual(21);
    expect(a.d.startsWith("M")).toBe(true);
    expect(qrPath("https://kl.example/lease/?id=7")).toEqual(a);
    expect(qrPath("https://kl.example/lease/?id=8").d).not.toBe(a.d);
  });
});
