import { describe, expect, it } from "vitest";
import { CALL_DEPOSIT, KeyLeaseError, lease, leaseFromEnv, REFUSALS } from "../src/index.ts";
import { TxFailed } from "../src/transport.ts";
import { authorized, fake, panic } from "./fake.ts";

const ok = (body: unknown, status = 200) => ({
  v: 1,
  ok: true,
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
  body_encoding: "utf8",
  body_sha256: "ab".repeat(32),
  redacted: false,
});

describe("lease().call", () => {
  it("sends use_lease with the body as a string, 0.025 NEAR and 300 Tgas, and returns data + receipt", async () => {
    const f = fake(() => ({
      hash: "Tx1",
      value: ok({ choices: [{ message: { content: "hi" } }] }),
      logs: [authorized(3)],
    }));
    const l = lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: f.transport });
    const r = await l.call("/chat/completions", { messages: [{ role: "user", content: "hello" }] });
    expect(f.calls[0]).toEqual({
      contract: "keylease.alice.testnet",
      method: "use_lease",
      args: {
        lease_id: "7",
        endpoint: "/chat/completions",
        method: "POST",
        body: '{"messages":[{"role":"user","content":"hello"}]}',
      },
      deposit: CALL_DEPOSIT,
      tgas: 300,
    });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ choices: [{ message: { content: "hi" } }] });
    expect(r.receipt).toEqual({
      leaseId: "7",
      call: 3,
      tx: "Tx1",
      url: "https://testnet.nearblocks.io/txns/Tx1",
    });
    expect(r.attestation).toBeNull();
  });

  it("GETs without a body and keeps non-JSON answers as text", async () => {
    const f = fake(() => ({ hash: "Tx2", value: ok("plain text"), logs: [] }));
    const r = await lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: f.transport }).call(
      "/models",
    );
    expect(f.calls[0]?.args).toEqual({ lease_id: "7", endpoint: "/models", method: "GET" });
    expect(r.data).toBe("plain text");
    expect(r.receipt.call).toBeNull();
    await expect(
      lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: f.transport }).call(
        "/x",
        {},
        { method: "GET" },
      ),
    ).rejects.toThrow(/GET call cannot carry a body/);
  });

  it("throws KeyLeaseError with the WORDING sentence when the contract refuses", async () => {
    const hint = REFUSALS["endpoint_not_in_lease"] ?? "";
    const f = fake(() => new TxFailed("Tx3", panic("endpoint_not_in_lease", hint)));
    const err = await lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: f.transport })
      .call("/admin", {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyLeaseError);
    expect(err).toMatchObject({ code: "endpoint_not_in_lease", hint, receipt: { tx: "Tx3" } });
    expect(String(err)).toContain("endpoint_not_in_lease: This endpoint is not in the lease");
  });

  it("throws on the proxy's own refusals and on no answer, with a receipt", async () => {
    const trip = fake(() => ({
      hash: "Tx4",
      value: { v: 1, ok: false, error: "tripwire", hint: "x" },
      logs: [authorized(4)],
    }));
    await expect(
      lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: trip.transport }).call(
        "/debug/headers",
      ),
    ).rejects.toMatchObject({
      code: "tripwire",
      hint: REFUSALS["tripwire"],
      receipt: { call: 4, tx: "Tx4" },
    });
    const none = fake(() => ({ hash: "Tx5", value: null, logs: [] }));
    await expect(
      lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: none.transport }).call("/models"),
    ).rejects.toMatchObject({ code: "no_answer" });
  });

  it("is testnet only and needs a numeric lease id", () => {
    expect(() => lease({ contract: "keylease.near", leaseId: "7" })).toThrow(/testnet/);
    expect(() => lease({ contract: "keylease.alice.testnet", leaseId: "seven" })).toThrow(/leaseId/);
  });
});

describe("check, status, env", () => {
  it("check asks check_call for the signing account; status reads get_lease", async () => {
    const f = fake(() => ({ hash: "", value: null, logs: [] }), {
      check_call: { ok: false, reason: "quota_used", hint: REFUSALS["quota_used"] },
      get_lease: { lease_id: "7", status: "used_up" },
    });
    const l = lease({ contract: "keylease.alice.testnet", leaseId: "7", transport: f.transport });
    expect(await l.check("/chat/completions")).toEqual({
      ok: false,
      reason: "quota_used",
      hint: REFUSALS["quota_used"],
    });
    expect(f.calls[0]).toMatchObject({
      method: "check_call",
      args: { lease_id: "7", caller: "agent.testnet", endpoint: "/chat/completions" },
    });
    expect(await l.status()).toMatchObject({ status: "used_up" });
  });

  it("leaseFromEnv reads the lease from env and asks for missing names, never echoing values", () => {
    const saved = { ...process.env };
    try {
      delete process.env["KEYLEASE_CONTRACT_ID"];
      expect(() => leaseFromEnv()).toThrow(/KEYLEASE_CONTRACT_ID and KEYLEASE_LEASE_ID/);
      process.env["KEYLEASE_CONTRACT_ID"] = "keylease.alice.testnet";
      process.env["KEYLEASE_LEASE_ID"] = "9";
      const l = leaseFromEnv();
      expect([l.contract, l.leaseId]).toEqual(["keylease.alice.testnet", "9"]);
    } finally {
      process.env = saved;
    }
  });

  it("without a transport and without env keys, the first call says which names to set", async () => {
    const saved = { ...process.env };
    try {
      delete process.env["NEAR_ACCOUNT_ID"];
      delete process.env["NEAR_PRIVATE_KEY"];
      await expect(
        lease({ contract: "keylease.alice.testnet", leaseId: "7" }).call("/models"),
      ).rejects.toThrow(/set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY/);
    } finally {
      process.env = saved;
    }
  });
});
