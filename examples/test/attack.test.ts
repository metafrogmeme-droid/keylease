import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTACKS, fakeBearer } from "../src/cases.ts";
import { logMarkdown, planMarkdown } from "../src/log.ts";
import { runAttacks } from "../src/run.ts";
import { fakeChain } from "./fake-chain.ts";

const cfg = (transport: ReturnType<typeof fakeChain>["transport"]) => ({
  contract: "keylease.demo.testnet",
  keyId: "0",
  transport,
  now: () => 0,
});

describe("prompt-injection attack run", () => {
  it("every attack gets the expected result on a chain that follows the rules", async () => {
    const chain = fakeChain();
    const { leaseId, rows } = await runAttacks(cfg(chain.transport));
    expect(leaseId).toBe("5");
    expect(rows.map((r) => [r.id, r.actual, r.pass])).toEqual([
      ["A1", "refused `endpoint_not_in_lease`", true],
      ["A2", "refused `endpoint_not_in_lease`", true],
      ["A3", "refused `endpoint_not_in_lease`", true],
      ["A4", "refused `tripwire`", true],
      ["A5", "answered HTTP 200, token redacted", true],
      ["A6", "answered HTTP 200", true],
      ["A7", "refused `quota_used`", true],
      ["A8", "refused `lease_revoked`", true],
    ]);
    // a fresh 3-call lease, revoke only before the last attack
    expect(chain.sent[0]).toBe("create_lease");
    expect(chain.sent.indexOf("revoke")).toBe(chain.sent.length - 2);
    expect(chain.lease.used).toBe(3);
  });

  it("a proxy that leaks the headers turns that row into a FAIL", async () => {
    const { rows } = await runAttacks(cfg(fakeChain({ leakHeaders: true }).transport));
    const a4 = rows.find((r) => r.id === "A4");
    expect(a4).toMatchObject({ pass: false, actual: "answered HTTP 200" });
  });

  it("the log has expected and actual per attack and never a body, a key or the bearer string", async () => {
    const { rows } = await runAttacks(cfg(fakeChain().transport));
    const md = logMarkdown(
      {
        when: "2026-11-03T00:00:00Z",
        contract: "keylease.demo.testnet",
        account: "demo.testnet",
        leaseId: "5",
        commit: "abc1234",
      },
      rows,
    );
    for (const a of ATTACKS) expect(md).toContain(`| ${a.id} |`);
    expect(md).toContain("**8/8 as expected.**");
    expect(md).toContain("[tx](https://testnet.nearblocks.io/txns/FakeTx");
    expect(md).not.toContain(fakeBearer());
    expect(md).not.toMatch(/ed25519:|"authorization"|\[redacted\]/u);
  });

  it("the committed log lists every attack with its expected result", () => {
    const doc = readFileSync(new URL("../../docs/ATTACK_LOG.md", import.meta.url), "utf8");
    for (const a of ATTACKS) expect(doc).toContain(`| ${a.id} |`);
    expect(planMarkdown()).toContain("Not run yet");
  });
});
