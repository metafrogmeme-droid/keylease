import { describe, expect, it } from "vitest";
import {
  CALL_DEPOSIT,
  LEASE_DEPOSIT,
  TEST_ENDPOINT,
  failureText,
  returnValue,
  testCallTx,
  testLeaseTx,
  verdict,
} from "../lib/testkey.ts";

function fnCall(tx: { actions: unknown[] }) {
  const f = (
    tx.actions[0] as { functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }
  ).functionCall;
  return { ...f, json: JSON.parse(new TextDecoder().decode(f.args)) as Record<string, unknown> };
}

const ok = (v: unknown) => ({ status: { SuccessValue: btoa(JSON.stringify(v)) } });

describe("Test key", () => {
  it("leases one call on /models to the owner for ten minutes", () => {
    const tx = testLeaseTx("keylease.alice.testnet", "3", "alice.testnet", 1_000);
    expect(tx.receiverId).toBe("keylease.alice.testnet");
    const f = fnCall(tx);
    expect(f.methodName).toBe("create_lease");
    expect(f.deposit).toBe(LEASE_DEPOSIT);
    expect(f.json).toEqual({
      key_id: "3",
      grantee: "alice.testnet",
      calls: 1,
      expires_at: (1_000n * 1_000_000n + 600n * 1_000_000_000n).toString(),
      endpoints: [TEST_ENDPOINT],
    });
  });

  it("calls the lease with GET /models and the 0.025 NEAR deposit", () => {
    const f = fnCall(testCallTx("keylease.alice.testnet", "7"));
    expect(f.methodName).toBe("use_lease");
    expect(f.deposit).toBe(CALL_DEPOSIT);
    expect(f.gas).toBe(300_000_000_000_000n);
    expect(f.json).toEqual({ lease_id: "7", endpoint: "/models", method: "GET" });
  });

  it("reads the return value of a final outcome", () => {
    expect(returnValue(ok("7"))).toBe("7");
    expect(returnValue({ status: { SuccessValue: "" } })).toBeNull();
    expect(returnValue(undefined)).toBeNull();
  });

  it("says in one sentence what the answer means", () => {
    expect(verdict({ ok: true, status: 200 })).toEqual({
      ok: true,
      text: "The key works: the API answered HTTP 200 through the proxy.",
    });
    expect(verdict({ ok: true, status: 401 }).text).toMatch(/refused the key/);
    expect(verdict({ ok: false, error: "key_unavailable" }).text).toBe(
      "key_unavailable: the sealed key could not be opened for this run; the key owner should check its lock.",
    );
    expect(verdict({ ok: false, error: "tripwire" }).text).toMatch(/^tripwire: The call looked like/);
    expect(verdict(null).text).toMatch(/no answer/);
  });

  it("names refusals from the chain", () => {
    expect(
      failureText(
        new Error(
          "Smart contract panicked: lease_expired: This lease has expired; ask the key owner for a new lease.",
        ),
      ),
    ).toBe("lease_expired: This lease has expired; ask the key owner for a new lease.");
    expect(failureText(new Error("User rejected the request"))).toMatch(/declined/);
  });
});
