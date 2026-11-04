// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";
import { receiverProblem, transferTx } from "../lib/keypass.ts";
import { failureText } from "../lib/testkey.ts";
import { fakeRpc } from "./fake-rpc.ts";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("id=7") }));
const { LeaseDetail } = await import("../components/LeaseDetail.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LEASE = {
  lease_id: "7",
  key_id: "0",
  owner: "alice.testnet",
  grantee: "agent.testnet",
  calls_total: 10,
  calls_used: 3,
  calls_left: 7,
  expires_at: String(BigInt(Date.now() + 3 * 3_600_000) * 1_000_000n),
  endpoints: ["/chat/completions"],
  status: "active",
  parent: null,
  depth: 0,
  issuer: "alice.testnet",
};

function wallet(accountId: string | null, send: WalletState["send"]): WalletState {
  return {
    ready: true,
    accountId,
    walletId: accountId ? "meteor-wallet" : null,
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    send,
  };
}

function show(accountId: string | null, send: WalletState["send"], lease: unknown = LEASE) {
  vi.stubGlobal("fetch", fakeRpc({ get_lease: () => lease, list_receipts: () => [] }).fetcher);
  render(
    <WalletContext value={wallet(accountId, send)}>
      <LeaseDetail />
    </WalletContext>,
  );
}

const args = (tx: ReturnType<typeof transferTx>) => {
  const f = (tx.actions[0] as { functionCall: { methodName: string; args: Uint8Array; deposit: bigint } })
    .functionCall;
  return {
    method: f.methodName,
    args: JSON.parse(new TextDecoder().decode(f.args)) as unknown,
    deposit: f.deposit,
  };
};

describe("Key Pass transfer", () => {
  it("is one nft_transfer with exactly 1 yoctoNEAR, token id = lease id", () => {
    expect(args(transferTx("keylease.alice.testnet", "7", "bob.testnet"))).toEqual({
      method: "nft_transfer",
      args: { receiver_id: "bob.testnet", token_id: "7" },
      deposit: 1n,
    });
  });

  it("checks the receiver before any wallet opens", () => {
    expect(receiverProblem("bob.testnet", "agent.testnet")).toBeNull();
    expect(receiverProblem("bob.near", "agent.testnet")).toMatch(/mainnet/i);
    expect(receiverProblem("Bob.testnet", "agent.testnet")).toMatch(/not a NEAR testnet account/);
    expect(receiverProblem("0x1234", "agent.testnet")).toMatch(/0x and 40 hex/);
    // An EVM holder (any letter case) and a 64-hex implicit account are fine new holders.
    expect(receiverProblem("0x020A4366595292aa16184536BAB2e9949d0d925F", "agent.testnet")).toBeNull();
    expect(
      receiverProblem("98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de", "agent.testnet"),
    ).toBeNull();
    expect(
      receiverProblem(
        "0x020A4366595292aa16184536BAB2e9949d0d925F",
        "0x020a4366595292aa16184536bab2e9949d0d925f",
      ),
    ).toMatch(/already holds/);
    expect(receiverProblem("agent.testnet", "agent.testnet")).toMatch(/already holds/);
  });

  it("the holder moves the lease: one transaction, then the page names the new holder", async () => {
    const send = vi
      .fn<WalletState["send"]>()
      .mockResolvedValue([{ status: { SuccessValue: "" }, transaction_outcome: { id: "TxK" } }]);
    show("agent.testnet", send);
    const box = await screen.findByRole("group", { name: "Transfer Key Pass 7" });
    expect(box.textContent).toMatch(/only if the key owner allowed it/);
    fireEvent.change(screen.getByLabelText(/New holder/), { target: { value: "bob.testnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer Key Pass" }));
    await waitFor(() => {
      expect(screen.getByText(/Key Pass 7 moved to bob\.testnet/)).toBeTruthy();
    });
    expect(send).toHaveBeenCalledTimes(1);
    const tx = send.mock.calls[0]?.[0][0];
    expect(tx && args(tx)).toEqual({
      method: "nft_transfer",
      args: { receiver_id: "bob.testnet", token_id: "7" },
      deposit: 1n,
    });
    expect(screen.getByRole("link", { name: /tx TxK/ }).getAttribute("href")).toBe(
      "https://testnet.nearblocks.io/txns/TxK",
    );
    // The holder line follows the transfer, and the form is gone (this wallet no longer holds it).
    expect(screen.getByText("bob.testnet", { selector: "dd code" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Transfer Key Pass 7" })).toBeNull();
  });

  it("a bad receiver is named and no wallet opens", async () => {
    const send = vi.fn<WalletState["send"]>();
    show("agent.testnet", send);
    await screen.findByRole("group", { name: "Transfer Key Pass 7" });
    fireEvent.change(screen.getByLabelText(/New holder/), { target: { value: "bob.near" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer Key Pass" }));
    expect(screen.getByRole("alert").textContent).toMatch(/mainnet/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("a non-transferable lease: the contract's sentence, plainly", async () => {
    const send = vi
      .fn<WalletState["send"]>()
      .mockRejectedValue(
        new Error('{"ExecutionError":"Smart contract panicked: this Key Pass is not transferable"}'),
      );
    show("agent.testnet", send);
    await screen.findByRole("group", { name: "Transfer Key Pass 7" });
    fireEvent.change(screen.getByLabelText(/New holder/), { target: { value: "bob.testnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer Key Pass" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "this Key Pass is not transferable: the key owner did not allow transfers for this lease.",
      );
    });
  });

  it("only the holder of an active lease sees it", async () => {
    for (const [who, lease] of [
      ["alice.testnet", LEASE], // the key owner cannot move it either
      [null, LEASE],
      ["agent.testnet", { ...LEASE, status: "revoked" }],
      ["agent.testnet", { ...LEASE, depth: 1, parent: "3", issuer: "mid.testnet" }], // sub-leases never move
    ] as const) {
      show(who, vi.fn<WalletState["send"]>(), lease);
      await screen.findByRole("heading", { name: "Lease 7" });
      expect(screen.queryByRole("group", { name: /Transfer Key Pass/ })).toBeNull();
      cleanup();
    }
  });

  it("failure text keeps refusal codes and shows a plain contract sentence", () => {
    expect(
      failureText(new Error("Smart contract panicked: lease_revoked: The key owner revoked this lease.")),
    ).toMatch(/^lease_revoked: /);
    expect(
      failureText(new Error('"Smart contract panicked: the receiver already holds this Key Pass"')),
    ).toBe("the receiver already holds this Key Pass");
  });
});
