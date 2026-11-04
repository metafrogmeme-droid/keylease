import { base58 } from "@scure/base";
import { describe, expect, it, vi } from "vitest";
import {
  CALL_DEPOSIT,
  KeyLeaseError,
  REFUSALS,
  SIGNATURE_TTL_MS,
  evmKeySigner,
  lease,
  solanaKeySigner,
  type HolderSigner,
} from "../src/index.ts";
import { TxFailed } from "../src/transport.ts";
import { authorized, fake, panic, type Recorded } from "./fake.ts";

const C = "keylease.alice.testnet";
const NOW = 1_800_000_000_000;
/** Throwaway test keys made from fixed bytes (never a wallet); the same bytes as the contract tests. */
const EVM_KEY = `0x${"01".repeat(32)}`;
const EVM_HOLDER = "0x1a642f0e3c3af545e7acbd38b07251b3990914f1";
const SOL_SEED = base58.encode(new Uint8Array(32).fill(5));
const SOL_ADDRESS = "8SFqwqnq4whPhs8icwHA2hQg3hUoN1qrCLK1SBx3WKwe";
const SOL_HOLDER = "6e7a1cdd29b0b78fd13af4c5598feff4ef2a97166e3ca6f2e4fbfccd80505bf1";
/** What the contract's view returns; the SDK must sign exactly this, never text of its own. */
const TEXT = "KeyLease signed call\n(from the signed_call_message view)";

const ok = {
  v: 1,
  ok: true,
  status: 200,
  body: '{"a":1}',
  body_encoding: "utf8",
  body_sha256: "ab".repeat(32),
};

function contract(over: { grantee?: string; last_nonce?: string; lease?: null } = {}) {
  const views = {
    get_lease:
      over.lease === null
        ? null
        : {
            lease_id: "7",
            grantee: over.grantee ?? EVM_HOLDER,
            last_nonce: over.last_nonce ?? "4",
            status: "active",
          },
    signed_call_message: TEXT,
    // The contract's own mapping (lowercase 0x…, base58 → hex).
    evm_holder_account: EVM_HOLDER,
    solana_holder_account: SOL_HOLDER,
  };
  return views;
}

function signedLease(
  signer: HolderSigner,
  views = contract(),
  answer: (r: Recorded) => unknown = () => ({ hash: "TxS", value: ok, logs: [authorized(5)] }),
) {
  const f = fake(answer as never, views);
  const l = lease({ contract: C, leaseId: "7", transport: f.transport, signer, now: () => NOW });
  return { f, l };
}

const sent = (calls: Recorded[]) => calls.find((c) => c.method === "use_lease_signed");
const viewed = (calls: Recorded[], method: string) => calls.find((c) => c.method === method)?.args;

describe("signers (same bytes as the contract's tests)", () => {
  it("EVM: the key's address, and an EIP-191 signature the contract recovers", async () => {
    const s = evmKeySigner(EVM_KEY);
    expect(s.address).toBe(EVM_HOLDER);
    expect(await s.signMessage("KeyLease signed call\nvector")).toBe(
      "0xbff49293c3c765e1cf2b7a0b3b7549a21129adb33e62cbedbc6d1a69937cb4f139c2811f2068593c6d05b3ae434d90f3e85e39b71048f0ae504f4c8c690ac5681b",
    );
  });

  it("Solana: the base58 address, and an ed25519 signature in base58", async () => {
    const s = solanaKeySigner(SOL_SEED);
    expect(s.address).toBe(SOL_ADDRESS);
    expect(await s.signMessage("KeyLease signed call\nvector")).toBe(
      "2qGjuubd3RqPnynVaveRc6GisJXmhbvRXMkTCer6tLdzy5JiWqRwFfMjnjZToWpsTRDMUwatfkM2U6g5vUnk8TUN",
    );
  });

  it("refuses keys that are not keys", () => {
    expect(() => evmKeySigner("0x1234")).toThrow(/32-byte/);
    expect(() => evmKeySigner("01".repeat(32))).toThrow(/0x/);
    expect(() => solanaKeySigner("not-base58-0OIl")).toThrow(/base58/);
  });
});

describe("lease().call with a holder signer: a relayer sends, the holder signs", () => {
  it("signs exactly the view's text, with last_nonce + 1 and a valid-until, then sends use_lease_signed", async () => {
    const signer = evmKeySigner(EVM_KEY);
    const spy = vi.spyOn(signer, "signMessage");
    const { f, l } = signedLease(signer);
    const r = await l.call("/chat/completions", { q: 1 });
    expect(r.status).toBe(200);
    expect(r.receipt.call).toBe(5);
    const until = String(NOW + SIGNATURE_TTL_MS);
    expect(viewed(f.calls, "signed_call_message")).toEqual({
      lease_id: "7",
      nonce: "5",
      valid_until_ms: until,
      method: "POST",
      endpoint: "/chat/completions",
      body: '{"q":1}',
    });
    expect(spy).toHaveBeenCalledWith(TEXT);
    const tx = sent(f.calls);
    expect(tx?.args).toEqual({
      lease_id: "7",
      endpoint: "/chat/completions",
      method: "POST",
      body: '{"q":1}',
      nonce: "5",
      valid_until_ms: until,
      signer: { Evm: { signature: await signer.signMessage(TEXT) } },
    });
    expect([tx?.deposit, tx?.tgas]).toEqual([CALL_DEPOSIT, 300]);
  });

  it("a Solana holder sends its base58 address with the signature", async () => {
    const signer = solanaKeySigner(SOL_SEED);
    const { f, l } = signedLease(signer, contract({ grantee: SOL_HOLDER }));
    await l.call("/models");
    expect(viewed(f.calls, "solana_holder_account")).toEqual({ address: SOL_ADDRESS });
    expect(sent(f.calls)?.args["signer"]).toEqual({
      Solana: { public_key: SOL_ADDRESS, signature: await signer.signMessage(TEXT) },
    });
    expect(viewed(f.calls, "signed_call_message")).toMatchObject({ method: "GET", nonce: "5" });
  });

  it("wrong signer: a key that does not hold the lease is refused before anything is signed or sent", async () => {
    const signer = evmKeySigner(`0x${"02".repeat(32)}`);
    const spy = vi.spyOn(signer, "signMessage");
    // The contract maps this key's address to its own account, not the holder's.
    const views = { ...contract(), evm_holder_account: signer.address };
    const { f, l } = signedLease(signer, views);
    const e = (await l.call("/chat/completions", {}).catch((x: unknown) => x)) as KeyLeaseError;
    expect(e).toBeInstanceOf(KeyLeaseError);
    expect([e.code, e.hint, e.receipt]).toEqual(["not_lease_holder", REFUSALS["not_lease_holder"], null]);
    expect(spy).not.toHaveBeenCalled();
    expect(sent(f.calls)).toBeUndefined();
  });

  it("mixed-case 0x: a checksummed wallet address resolves through the contract to the lowercase holder", async () => {
    const inner = evmKeySigner(EVM_KEY);
    const checksummed: HolderSigner = {
      kind: "evm",
      address: "0x1A642f0E3c3aF545E7AcBD38b07251B3990914F1",
      signMessage: (t) => inner.signMessage(t),
    };
    const { f, l } = signedLease(checksummed);
    await l.call("/chat/completions", {});
    expect(viewed(f.calls, "evm_holder_account")).toEqual({ address: checksummed.address });
    expect(sent(f.calls)).toBeDefined();
  });

  it("stale nonce: uses the lease's last_nonce + 1, and a nonce another call took first comes back as nonce_used", async () => {
    const { f, l } = signedLease(
      evmKeySigner(EVM_KEY),
      contract({ last_nonce: "41" }),
      () => new TxFailed("TxN", panic("nonce_used", REFUSALS["nonce_used"] ?? "")),
    );
    const e = (await l.call("/chat/completions", {}).catch((x: unknown) => x)) as KeyLeaseError;
    expect(viewed(f.calls, "signed_call_message")?.["nonce"]).toBe("42");
    expect([e.code, e.hint, e.receipt?.tx]).toEqual(["nonce_used", REFUSALS["nonce_used"], "TxN"]);
  });

  it("expired: the valid-until is now + the time to live, and a late signature comes back as signature_expired", async () => {
    const signer = evmKeySigner(EVM_KEY);
    const f = fake(
      () => new TxFailed("TxE", panic("signature_expired", REFUSALS["signature_expired"] ?? "")),
      contract(),
    );
    const l = lease({
      contract: C,
      leaseId: "7",
      transport: f.transport,
      signer,
      now: () => NOW,
      signatureTtlMs: 30_000,
    });
    const e = (await l.call("/chat/completions", {}).catch((x: unknown) => x)) as KeyLeaseError;
    expect(viewed(f.calls, "signed_call_message")?.["valid_until_ms"]).toBe(String(NOW + 30_000));
    expect(e.code).toBe("signature_expired");
    expect(() =>
      lease({ contract: C, leaseId: "7", transport: f.transport, signer, signatureTtlMs: 0 }),
    ).toThrow(/signatureTtlMs/);
    expect(() =>
      lease({ contract: C, leaseId: "7", transport: f.transport, signer, signatureTtlMs: 2 * 3_600_000 }),
    ).toThrow(/signatureTtlMs/);
  });

  it("no lease: lease_not_found, nothing signed", async () => {
    const { f, l } = signedLease(evmKeySigner(EVM_KEY), contract({ lease: null }));
    const e = (await l.call("/x").catch((x: unknown) => x)) as KeyLeaseError;
    expect(e.code).toBe("lease_not_found");
    expect(sent(f.calls)).toBeUndefined();
  });

  it("check() asks for the holder, not the relayer", async () => {
    const views = { ...contract(), check_call: { ok: true } };
    const { f, l } = signedLease(evmKeySigner(EVM_KEY), views);
    await l.check("/chat/completions");
    expect(viewed(f.calls, "check_call")).toEqual({
      lease_id: "7",
      caller: EVM_HOLDER,
      endpoint: "/chat/completions",
    });
  });

  it("sub-leases and transfers need the holder's own NEAR account", async () => {
    const { l } = signedLease(evmKeySigner(EVM_KEY));
    await expect(l.subLease({ grantee: "x.testnet", calls: 1 })).rejects.toThrow(/own NEAR account/);
    await expect(l.transfer("x.testnet")).rejects.toThrow(/own NEAR account/);
  });
});

describe("the relayer key", () => {
  it("comes from env (KEYLEASE_RELAYER_*), testnet only, and is never printed", async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    const err = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.stubEnv("KEYLEASE_RELAYER_ACCOUNT_ID", "");
    vi.stubEnv("KEYLEASE_RELAYER_PRIVATE_KEY", "");
    const l = lease({ contract: C, leaseId: "7", signer: evmKeySigner(EVM_KEY) });
    await expect(l.call("/x")).rejects.toThrow(
      /KEYLEASE_RELAYER_ACCOUNT_ID and KEYLEASE_RELAYER_PRIVATE_KEY/,
    );
    vi.stubEnv("KEYLEASE_RELAYER_ACCOUNT_ID", "relayer.near");
    // A throwaway made at run time: never key-shaped in the source, never printed.
    const throwaway = ["ed25519", base58.encode(crypto.getRandomValues(new Uint8Array(64)))].join(":");
    vi.stubEnv("KEYLEASE_RELAYER_PRIVATE_KEY", throwaway);
    await expect(
      lease({ contract: C, leaseId: "7", signer: evmKeySigner(EVM_KEY) }).call("/x"),
    ).rejects.toThrow(/\.testnet/);
    vi.unstubAllEnvs();
    expect(out.join("\n")).not.toContain(throwaway);
    expect(out.join("\n")).not.toMatch(/ed25519:/);
    log.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  });
});
