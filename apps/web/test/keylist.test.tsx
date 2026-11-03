// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyList } from "../components/KeyList.tsx";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KEYS = [
  { key_id: "0", provider: "OpenAiCompatible", base_url: "https://mock.example/v1", label: "demo" },
];

function stubKeys() {
  const rpc = { result: { result: [...new TextEncoder().encode(JSON.stringify(KEYS))] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(rpc)))),
  );
}

const outcome = (v: unknown, id = "TxHash1") => ({
  status: { SuccessValue: btoa(JSON.stringify(v)) },
  transaction_outcome: { id },
});

function wallet(send: WalletState["send"]): WalletState {
  return {
    ready: true,
    accountId: "alice.testnet",
    walletId: "meteor-wallet",
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    send,
  };
}

function show(w: WalletState) {
  render(
    <WalletContext value={w}>
      <KeyList />
    </WalletContext>,
  );
}

describe("key list with Test key", () => {
  it("leases one call to yourself, calls it, and shows ✓ with a receipt link", async () => {
    stubKeys();
    const send = vi
      .fn<WalletState["send"]>()
      .mockResolvedValueOnce([outcome("5", "LeaseTx")])
      .mockResolvedValueOnce([outcome({ ok: true, status: 200 }, "CallTx")]);
    show(wallet(send));
    fireEvent.click(await screen.findByRole("button", { name: "Test key demo" }));
    await waitFor(() => {
      expect(screen.getByText(/The key works/)).toBeTruthy();
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "receipt tx" }).getAttribute("href")).toBe(
      "https://testnet.nearblocks.io/txns/CallTx",
    );
  });

  it("shows the refusal code and hint when the contract refuses", async () => {
    stubKeys();
    const send = vi
      .fn<WalletState["send"]>()
      .mockResolvedValueOnce([outcome("5")])
      .mockRejectedValueOnce(
        new Error(
          "Smart contract panicked: quota_used: All calls in this lease are used; ask the key owner for more calls.",
        ),
      );
    show(wallet(send));
    fireEvent.click(await screen.findByRole("button", { name: "Test key demo" }));
    await waitFor(() => {
      expect(screen.getByText(/✗ quota_used: All calls in this lease are used/)).toBeTruthy();
    });
  });

  it("explains that a redirecting wallet cannot finish the test on the page", async () => {
    stubKeys();
    show(wallet(vi.fn<WalletState["send"]>().mockResolvedValueOnce([])));
    fireEvent.click(await screen.findByRole("button", { name: "Test key demo" }));
    await waitFor(() => {
      expect(screen.getByText(/left the page/)).toBeTruthy();
    });
  });
});
