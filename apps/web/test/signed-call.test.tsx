// @vitest-environment jsdom
/**
 * PR 11c: a 0x holder signs a test call in MetaMask while another NEAR wallet sends `use_lease_signed`.
 * Offline: a mock MetaMask signs with a throwaway key made from fixed bytes (the same bytes as the
 * contract and SDK tests, never a wallet), and the NEAR RPC is faked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { evmKeySigner } from "@keylease/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";
import { testCallArgs } from "../lib/holdercall.ts";
import type { LeaseView } from "../lib/lease-view.ts";
import { SIGNATURE_TTL_MS, canSignInMetaMask, signedCallTx, utf8Hex } from "../lib/signedcall.ts";
import { fakeRpc } from "./fake-rpc.ts";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=7") }));
const { LeaseDetail } = await import("../components/LeaseDetail.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONTRACT = "keylease.testnet"; // apps/web/vitest.config.ts sets this contract id
const HOLDER_KEY = `0x${"01".repeat(32)}`;
const HOLDER = "0x1a642f0e3c3af545e7acbd38b07251b3990914f1"; // that key's address
const SENDER = "alice.testnet"; // the connected NEAR wallet: sends and pays, holds nothing
/** What the contract's view returns; the page must have MetaMask sign exactly this. */
const TEXT = "KeyLease signed call\n(from the signed_call_message view)";

const lease = (over: Record<string, unknown> = {}) => ({
  lease_id: "7",
  key_id: "2",
  owner: "bob.testnet",
  grantee: HOLDER,
  calls_total: 3,
  calls_used: 0,
  calls_left: 3,
  expires_at: String(BigInt(Date.now() + 3 * 3_600_000) * 1_000_000n),
  endpoints: ["/messages"],
  status: "active",
  parent: null,
  depth: 0,
  issuer: "bob.testnet",
  last_nonce: "4",
  ...over,
});

function chain(before: Record<string, unknown>, after: Record<string, unknown> = before) {
  let called = false;
  const rpc = fakeRpc({
    get_lease: () => (called ? after : before),
    list_receipts: () => [],
    get_key: () => ({
      key_id: "2",
      provider: "AnthropicCompatible",
      base_url: "https://api.anthropic.com/v1",
    }),
    // The contract's mapping: any letter case to the lowercase eth-implicit account.
    evm_holder_account: (a) => String(a["address"]).toLowerCase(),
    signed_call_message: () => TEXT,
  });
  vi.stubGlobal("fetch", rpc.fetcher);
  return {
    rpc,
    markCalled: () => {
      called = true;
    },
  };
}

/** A mock MetaMask (EIP-1193) on the page; `sign` can be swapped to decline. */
function metamask(key = HOLDER_KEY, sign?: () => Promise<unknown>) {
  const s = evmKeySigner(key);
  const request = vi.fn(({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_requestAccounts") return Promise.resolve([s.address]);
    if (method === "personal_sign") {
      if (sign) return sign();
      const hex = String(params?.[0]).slice(2);
      const bytes = Uint8Array.from(hex.match(/../gu) ?? [], (b) => parseInt(b, 16));
      return s.signMessage(new TextDecoder().decode(bytes));
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });
  vi.stubGlobal("ethereum", { request });
  return { request, signer: s };
}

function show(send: WalletState["send"], accountId: string | null = SENDER) {
  const w: WalletState = {
    ready: true,
    accountId,
    walletId: accountId ? "meteor-wallet" : null,
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    send,
  };
  render(
    <WalletContext value={w}>
      <LeaseDetail />
    </WalletContext>,
  );
}

const b64 = (v: unknown) => btoa(JSON.stringify(v));
const answer = {
  v: 1,
  ok: true,
  status: 200,
  body: "{}",
  body_encoding: "utf8",
  body_sha256: "ab".repeat(32),
};
const BUTTON = "Sign in MetaMask and call";

function sentCall(send: ReturnType<typeof vi.fn<WalletState["send"]>>) {
  const f = (
    send.mock.calls[0]?.[0][0]?.actions[0] as {
      functionCall: { methodName: string; args: Uint8Array; deposit: bigint; gas: bigint };
    }
  ).functionCall;
  return { ...f, args: JSON.parse(new TextDecoder().decode(f.args)) as Record<string, unknown> };
}

describe("the signed call (lib)", () => {
  it("is one use_lease_signed with the holder's signature; the sender pays 0.025 NEAR", () => {
    const args = testCallArgs("7", ["/messages"], "claude-haiku-5-5");
    const tx = signedCallTx(CONTRACT, args, {
      holder: HOLDER,
      nonce: "5",
      validUntilMs: "1800000300000",
      signature: `0x${"ab".repeat(65)}`,
    });
    expect(tx.receiverId).toBe(CONTRACT);
    const f = (
      tx.actions[0] as {
        functionCall: { methodName: string; args: Uint8Array; deposit: bigint; gas: bigint };
      }
    ).functionCall;
    expect(f.methodName).toBe("use_lease_signed");
    expect(JSON.parse(new TextDecoder().decode(f.args))).toEqual({
      ...args,
      nonce: "5",
      valid_until_ms: "1800000300000",
      signer: { Evm: { signature: `0x${"ab".repeat(65)}` } },
    });
    expect([f.deposit, f.gas]).toEqual([25_000_000_000_000_000_000_000n, 300_000_000_000_000n]);
  });

  it("personal_sign gets the text as UTF-8 hex, so MetaMask shows it as plain text", () => {
    expect(utf8Hex("Ke\nÿ")).toBe("0x4b650ac3bf");
  });

  it("only offered for a 0x holder, to another connected account, on a lease that takes calls", () => {
    const l = lease() as unknown as LeaseView;
    expect(canSignInMetaMask(l, SENDER)).toBe(true);
    expect(canSignInMetaMask(l, HOLDER)).toBe(false); // the holder's own wallet makes a plain call
    expect(canSignInMetaMask(l, null)).toBe(false); // someone has to send it
    expect(canSignInMetaMask({ ...l, grantee: "agent.testnet" }, SENDER)).toBe(false);
    expect(canSignInMetaMask({ ...l, status: "revoked" }, SENDER)).toBe(false);
    expect(canSignInMetaMask({ ...l, calls_left: 0 }, SENDER)).toBe(false);
  });
});

describe("lease page: a 0x holder signs in MetaMask, another wallet sends", () => {
  it("signs exactly the view's text with last_nonce + 1 and a valid-until, then sends use_lease_signed", async () => {
    const c = chain(lease(), lease({ calls_used: 1, calls_left: 2, last_nonce: "5" }));
    const mm = metamask();
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      c.markCalled();
      return Promise.resolve([
        {
          status: { SuccessValue: b64(answer) },
          transaction_outcome: { id: "TxSig", outcome: { logs: [] } },
        },
      ]);
    });
    show(send);
    expect(await screen.findByText(/the holder signs it in MetaMask, and this wallet/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/Model/).value).toBe("claude-haiku-5-5");
    });
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: BUTTON }));
    const box = await screen.findByRole("status", { name: "Test call result" });
    await waitFor(() => {
      expect(box.textContent).toMatch(/HTTP 200/);
    });
    expect(box.textContent).toMatch(/2 calls left/);
    expect(screen.getByRole("link", { name: /use_lease_signed tx TxSig/ }).getAttribute("href")).toBe(
      "https://testnet.nearblocks.io/txns/TxSig",
    );

    // The text came from the contract, for this request, nonce and valid-until.
    const asked = c.rpc.calls.find((x) => x.method === "signed_call_message")?.args;
    const args = testCallArgs("7", ["/messages"], "claude-haiku-5-5");
    expect(asked).toMatchObject({ ...args, nonce: "5" });
    const until = Number(asked?.["valid_until_ms"]);
    expect(until).toBeGreaterThanOrEqual(before + SIGNATURE_TTL_MS);
    expect(until).toBeLessThanOrEqual(Date.now() + SIGNATURE_TTL_MS);

    // MetaMask signed exactly that text with the account it gave, and nothing else.
    expect(mm.request.mock.calls.map(([r]) => r.method)).toEqual(["eth_requestAccounts", "personal_sign"]);
    expect(mm.request.mock.calls[1]?.[0].params).toEqual([utf8Hex(TEXT), mm.signer.address]);

    // The connected wallet sent it, once.
    expect(send).toHaveBeenCalledTimes(1);
    const f = sentCall(send);
    expect(f.methodName).toBe("use_lease_signed");
    expect(f.args).toEqual({
      ...args,
      nonce: "5",
      valid_until_ms: String(asked?.["valid_until_ms"]),
      signer: { Evm: { signature: await mm.signer.signMessage(TEXT) } },
    });
    expect(f.deposit).toBe(25_000_000_000_000_000_000_000n);
  });

  it("wrong MetaMask account: named, nothing signed or sent", async () => {
    chain(lease());
    const mm = metamask(`0x${"02".repeat(32)}`);
    const send = vi.fn<WalletState["send"]>();
    show(send);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        `The MetaMask account ${mm.signer.address} does not hold this lease; switch to ${HOLDER} in MetaMask.`,
      );
    });
    expect(mm.request.mock.calls.map(([r]) => r.method)).toEqual(["eth_requestAccounts"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("declined in MetaMask: nothing sent, and the button comes back", async () => {
    chain(lease());
    metamask(HOLDER_KEY, () => Promise.reject(Object.assign(new Error("User denied"), { code: 4001 })));
    const send = vi.fn<WalletState["send"]>();
    show(send);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("MetaMask declined; nothing was signed or sent.");
    });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: BUTTON }).disabled).toBe(false);
  });

  it("no MetaMask on the page: says where to open it, nothing sent", async () => {
    chain(lease());
    const send = vi.fn<WalletState["send"]>();
    show(send);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/MetaMask is not on this page/);
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("a signed-call refusal from the contract shows its code and sentence", async () => {
    chain(lease());
    metamask();
    const send = vi
      .fn<WalletState["send"]>()
      .mockRejectedValue(
        new Error(
          "Smart contract panicked: nonce_used: This signed call was already used; sign it again with a higher nonce.",
        ),
      );
    show(send);
    fireEvent.click(await screen.findByRole("button", { name: BUTTON }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/^nonce_used: /);
    });
  });

  it("a NEAR-account holder: another wallet still sees only why it cannot call", async () => {
    chain(lease({ grantee: "agent.testnet" }));
    metamask();
    show(vi.fn<WalletState["send"]>());
    expect(await screen.findByText(/Only the holder \(agent\.testnet\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("nobody connected: the hint names both ways to call", async () => {
    chain(lease());
    show(vi.fn<WalletState["send"]>(), null);
    expect(
      await screen.findByText(/or any NEAR wallet to send a call the holder signs in MetaMask/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
});
