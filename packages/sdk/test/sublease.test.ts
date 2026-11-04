import { describe, expect, it } from "vitest";
import { KeyLeaseError, lease, SUB_LEASE_DEPOSIT, type LeaseStatus } from "../src/index.ts";
import { TxFailed } from "../src/transport.ts";
import { fake, panic } from "./fake.ts";

const C = "keylease.alice.testnet";
const HOUR_NS = 3_600_000_000_000n;
const now = 1_800_000_000_000; // ms, fixed clock for the tests
const parentExpiry = (BigInt(now) * 1_000_000n + 2n * HOUR_NS).toString();

/** The parent lease 7 as the contract's get_lease returns it: held by the fake's signer, agent.testnet. */
function parent(over: Partial<LeaseStatus> = {}): LeaseStatus {
  return {
    lease_id: "7",
    key_id: "0",
    owner: "alice.testnet",
    grantee: "agent.testnet",
    calls_total: 10,
    calls_used: 4,
    calls_left: 6,
    expires_at: parentExpiry,
    endpoints: ["/chat/completions", "/models"],
    status: "active",
    created_at: "0",
    parent: null,
    depth: 0,
    issuer: "alice.testnet",
    last_nonce: "0",
    ...over,
  };
}

const created = (id: string) => () => ({ hash: "TxS", value: id, logs: [] });

describe("lease().subLease", () => {
  it("hands on a slice: create_sub_lease with the parent's expiry and endpoints by default", async () => {
    const f = fake(created("12"), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
    const s = await l.subLease({ grantee: "helper.testnet", calls: 2 });
    expect(f.calls.map((c) => c.method)).toEqual(["get_lease", "create_sub_lease"]);
    expect(f.calls[1]).toEqual({
      contract: C,
      method: "create_sub_lease",
      args: {
        parent: "7",
        grantee: "helper.testnet",
        calls: 2,
        expires_at: parentExpiry,
        endpoints: ["/chat/completions", "/models"],
      },
      deposit: SUB_LEASE_DEPOSIT,
      tgas: 30,
    });
    expect(s.leaseId).toBe("12");
    expect(s.receipt).toEqual({ tx: "TxS", url: "https://testnet.nearblocks.io/txns/TxS" });
    // The child is a lease too, on the same contract (its holder is the grantee, not this signer).
    expect(s.lease.leaseId).toBe("12");
    expect(s.lease.contract).toBe(C);
  });

  it("narrows expiry (Date or ms) and endpoints", async () => {
    const f = fake(created("13"), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
    await l.subLease({
      grantee: "helper.testnet",
      calls: 1,
      expiresAt: new Date(now + 30 * 60_000),
      endpoints: ["/models"],
    });
    expect(f.calls[1]?.args).toMatchObject({
      expires_at: (BigInt(now + 30 * 60_000) * 1_000_000n).toString(),
      endpoints: ["/models"],
    });
  });

  it("a child can never outlive or exceed its parent: refused before any transaction", async () => {
    const f = fake(created("x"), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
    const late = new Date(now + 3 * 60 * 60_000);
    await expect(l.subLease({ grantee: "helper.testnet", calls: 1, expiresAt: late })).rejects.toThrow(
      /cannot outlive/,
    );
    await expect(l.subLease({ grantee: "helper.testnet", calls: 7 })).rejects.toThrow(/6 calls left/);
    await expect(
      l.subLease({ grantee: "helper.testnet", calls: 1, endpoints: ["/admin/keys"] }),
    ).rejects.toThrow(/endpoints of the lease above/);
    await expect(l.subLease({ grantee: "helper.testnet", calls: 0 })).rejects.toThrow(/whole number/);
    await expect(
      l.subLease({ grantee: "helper.testnet", calls: 1, expiresAt: new Date(now - 1) }),
    ).rejects.toThrow(/in the future/);
    await expect(l.subLease({ grantee: "helper.near", calls: 1 })).rejects.toThrow(/mainnet/i);
    await expect(l.subLease({ grantee: "helper.testnet", calls: 1, endpoints: [] })).rejects.toThrow(
      /at least one endpoint/,
    );
    expect(f.calls.filter((c) => c.method === "create_sub_lease")).toEqual([]);
  });

  it("hands on to an EVM holder: a mixed-case 0x address is sent as its lowercase account", async () => {
    const f = fake(created("14"), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
    await l.subLease({ grantee: "0x020A4366595292aa16184536BAB2e9949d0d925F", calls: 1 });
    expect(f.calls[1]?.args["grantee"]).toBe("0x020a4366595292aa16184536bab2e9949d0d925f");
    await expect(l.subLease({ grantee: "0x1234", calls: 1 })).rejects.toThrow(/0x and 40 hex/);
  });

  it("depth is at most three levels", async () => {
    const f = fake(created("x"), { get_lease: parent({ depth: 3, parent: "5" }) });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
    await expect(l.subLease({ grantee: "helper.testnet", calls: 1 })).rejects.toThrow(/3 levels/);
  });

  it("refuses with the contract's code when this signer cannot sub-lease", async () => {
    const cases: [Partial<LeaseStatus> | null, string][] = [
      [null, "lease_not_found"],
      [{ grantee: "someone.testnet" }, "not_lease_holder"],
      [{ status: "revoked" }, "lease_revoked"],
      [{ status: "expired" }, "lease_expired"],
      [{ status: "used_up" }, "quota_used"],
    ];
    for (const [over, code] of cases) {
      const f = fake(created("x"), { get_lease: over === null ? null : parent(over) });
      const l = lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now });
      const e = (await l
        .subLease({ grantee: "helper.testnet", calls: 1 })
        .catch((x: unknown) => x)) as KeyLeaseError;
      expect(e).toBeInstanceOf(KeyLeaseError);
      expect(e.code).toBe(code);
      expect(e.receipt).toBeNull();
    }
  });

  it("a chain refusal (a lease further up) comes back with its code; a limit panic with its sentence", async () => {
    const up = fake(
      () => new TxFailed("TxP", panic("parent_quota_used", "A lease above this one has no calls left.")),
      { get_lease: parent({ depth: 1, parent: "3" }) },
    );
    const e = (await lease({ contract: C, leaseId: "7", transport: up.transport, now: () => now })
      .subLease({ grantee: "helper.testnet", calls: 1 })
      .catch((x: unknown) => x)) as KeyLeaseError;
    expect(e.code).toBe("parent_quota_used");
    expect(e.receipt?.tx).toBe("TxP");

    const limit = JSON.stringify({
      ActionError: {
        kind: {
          FunctionCallError: {
            ExecutionError:
              "Smart contract panicked: a sub-lease cannot have more calls than every lease above it has left",
          },
        },
      },
    });
    const f = fake(() => new TxFailed("TxL", limit), { get_lease: parent({ depth: 1, parent: "3" }) });
    const e2 = (await lease({ contract: C, leaseId: "7", transport: f.transport, now: () => now })
      .subLease({ grantee: "helper.testnet", calls: 1 })
      .catch((x: unknown) => x)) as KeyLeaseError;
    expect(e2.code).toBe("sub_lease_refused");
    expect(e2.hint).toBe("a sub-lease cannot have more calls than every lease above it has left");
  });

  it("lists the sub-leases handed on from a lease", async () => {
    const kids = [parent({ lease_id: "12", parent: "7", depth: 1, issuer: "agent.testnet" })];
    const f = fake(created("x"), { list_sub_leases: kids });
    const out = await lease({ contract: C, leaseId: "7", transport: f.transport }).subLeases();
    expect(out).toEqual(kids);
    expect(f.calls[0]).toEqual({ contract: C, method: "list_sub_leases", args: { lease_id: "7" } });
  });
});

describe("lease().transfer (Key Pass, NEP-171)", () => {
  it("sends nft_transfer with exactly 1 yoctoNEAR, token id = lease id", async () => {
    const f = fake(() => ({ hash: "TxT", value: null, logs: [] }), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport });
    const r = await l.transfer("bob.testnet", { memo: "handover" });
    expect(f.calls[1]).toEqual({
      contract: C,
      method: "nft_transfer",
      args: { receiver_id: "bob.testnet", token_id: "7", memo: "handover" },
      deposit: 1n,
      tgas: 30,
    });
    expect(r).toEqual({ tx: "TxT", url: "https://testnet.nearblocks.io/txns/TxT" });
  });

  it("refuses before any transaction: not the holder, to self, not .testnet, revoked", async () => {
    const holder = fake(() => ({ hash: "x", value: null, logs: [] }), {
      get_lease: parent({ grantee: "someone.testnet" }),
    });
    const e = (await lease({ contract: C, leaseId: "7", transport: holder.transport })
      .transfer("bob.testnet")
      .catch((x: unknown) => x)) as KeyLeaseError;
    expect(e.code).toBe("not_lease_holder");

    const f = fake(() => ({ hash: "x", value: null, logs: [] }), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport });
    await expect(l.transfer("agent.testnet")).rejects.toThrow(/already holds/);
    await expect(l.transfer("bob.near")).rejects.toThrow(/mainnet/i);

    const rev = fake(() => ({ hash: "x", value: null, logs: [] }), {
      get_lease: parent({ status: "revoked" }),
    });
    const e2 = (await lease({ contract: C, leaseId: "7", transport: rev.transport })
      .transfer("bob.testnet")
      .catch((x: unknown) => x)) as KeyLeaseError;
    expect(e2.code).toBe("lease_revoked");
    expect([...f.calls, ...holder.calls, ...rev.calls].some((c) => c.method === "nft_transfer")).toBe(false);
  });

  it("moves the Key Pass to an EVM or implicit account, normalised", async () => {
    const f = fake(() => ({ hash: "TxT", value: null, logs: [] }), { get_lease: parent() });
    const l = lease({ contract: C, leaseId: "7", transport: f.transport });
    await l.transfer(" 0x020A4366595292aa16184536BAB2e9949d0d925F ");
    expect(f.calls[1]?.args["receiver_id"]).toBe("0x020a4366595292aa16184536bab2e9949d0d925f");
    const hex64 = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    await l.transfer(hex64);
    expect(f.calls[3]?.args["receiver_id"]).toBe(hex64);
  });

  it("a lease the owner made non-transferable comes back with the contract's sentence", async () => {
    const text = JSON.stringify({
      ActionError: {
        kind: {
          FunctionCallError: {
            ExecutionError: "Smart contract panicked: this Key Pass is not transferable",
          },
        },
      },
    });
    const f = fake(() => new TxFailed("TxN", text), { get_lease: parent() });
    const e = (await lease({ contract: C, leaseId: "7", transport: f.transport })
      .transfer("bob.testnet")
      .catch((x: unknown) => x)) as KeyLeaseError;
    expect(e.code).toBe("transfer_refused");
    expect(e.hint).toBe("this Key Pass is not transferable");
    expect(e.receipt?.tx).toBe("TxN");
  });

  it("reads the Key Pass (nft_token)", async () => {
    const pass = { token_id: "7", owner_id: "agent.testnet", metadata: { title: "Key Pass 7" } };
    const f = fake(() => ({ hash: "x", value: null, logs: [] }), { nft_token: pass });
    expect(await lease({ contract: C, leaseId: "7", transport: f.transport }).keyPass()).toEqual(pass);
    expect(f.calls[0]).toEqual({ contract: C, method: "nft_token", args: { token_id: "7" } });
  });
});
