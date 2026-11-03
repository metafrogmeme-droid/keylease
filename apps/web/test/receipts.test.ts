import { describe, expect, it } from "vitest";
import { outcomeText, revokeAllTx, revokeTx, type Receipt } from "../lib/receipts.ts";

const base: Receipt = {
  lease_id: "7",
  call: 1,
  caller: "agent.testnet",
  endpoint: "/chat/completions",
  method: "POST",
  input_sha256: "a".repeat(64),
  output_sha256: "b".repeat(64),
  outcome: "ok",
  code: null,
  http_status: 200,
  at: "0",
};

function fn(tx: { receiverId: string; actions: unknown[] }) {
  const f = (tx.actions[0] as { functionCall: { methodName: string; args: Uint8Array; deposit: bigint } })
    .functionCall;
  return {
    method: f.methodName,
    deposit: f.deposit,
    args: JSON.parse(new TextDecoder().decode(f.args)) as unknown,
  };
}

describe("receipts and revoke", () => {
  it("reads each outcome as ✓/✗ with one reason", () => {
    expect(outcomeText(base)).toEqual({ ok: true, text: "HTTP 200" });
    expect(outcomeText({ ...base, http_status: 401 })).toEqual({ ok: false, text: "HTTP 401" });
    expect(outcomeText({ ...base, outcome: "tripwire", code: "tripwire", http_status: null }).text).toMatch(
      /^tripwire: The call looked like/,
    );
    expect(
      outcomeText({ ...base, outcome: "error", code: "upstream_error", http_status: null }).text,
    ).toMatch(/^upstream_error: the API could not be reached/);
    expect(outcomeText({ ...base, outcome: "failed", code: null, http_status: null }).text).toMatch(
      /no answer/,
    );
  });

  it("revokes one lease, or every lease on a key, with no deposit", () => {
    expect(fn(revokeTx("keylease.a.testnet", "7"))).toEqual({
      method: "revoke",
      deposit: 0n,
      args: { lease_id: "7" },
    });
    expect(fn(revokeAllTx("keylease.a.testnet", "2"))).toEqual({
      method: "revoke_all",
      deposit: 0n,
      args: { key_id: "2" },
    });
  });
});
