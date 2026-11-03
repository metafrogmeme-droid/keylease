// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectWallet } from "../components/ConnectWallet.tsx";
import { WalletContext, connectError, type WalletState } from "../components/WalletProvider.tsx";
import { walletOptions } from "../lib/wallets.ts";

afterEach(cleanup);

function state(over: Partial<WalletState> = {}): WalletState {
  return {
    ready: true,
    accountId: null,
    walletId: null,
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

function show(s: WalletState, reown: string | null = null) {
  render(
    <WalletContext value={s}>
      <ConnectWallet options={walletOptions({ reownProjectId: reown })} />
    </WalletContext>,
  );
}

describe("wallet picker", () => {
  it("opens a list of six wallets and connects the one picked", () => {
    const s = state();
    show(s);
    const open = screen.getByRole("button", { name: "Connect wallet" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: "Wallets" });
    expect(within(list).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(within(list).getByRole("button", { name: /^Meteor/ }));
    expect(s.connect).toHaveBeenCalledWith("meteor-wallet");
  });

  it("shows WalletConnect as not configured and disabled without a Reown id", () => {
    show(state());
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const wc = screen.getByRole("button", { name: /^WalletConnect/ });
    expect((wc as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not configured: NEXT_PUBLIC_REOWN_PROJECT_ID is empty/)).toBeTruthy();
  });

  it("enables WalletConnect when a Reown id is set", () => {
    show(state(), "0123456789abcdef0123456789abcdef");
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^WalletConnect/ }).disabled).toBe(false);
  });

  it("keeps every wallet disabled until the wallet code has loaded", () => {
    show(state({ ready: false }));
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    for (const b of within(screen.getByRole("list", { name: "Wallets" })).getAllByRole("button"))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Loading wallets…")).toBeTruthy();
  });

  it("shows the connected account with a Disconnect button", () => {
    const s = state({ accountId: "alice.testnet", walletId: "my-near-wallet" });
    show(s);
    expect(screen.getByText("alice.testnet")).toBeTruthy();
    expect(screen.getByText(/MyNearWallet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(s.disconnect).toHaveBeenCalled();
  });

  it("announces errors", () => {
    show(state({ error: "The wallet closed or the request was declined. Try again." }));
    expect(screen.getByRole("alert").textContent).toContain("declined");
  });
});

describe("connectError", () => {
  it("turns wallet errors into one plain sentence", () => {
    expect(connectError(new Error("User rejected the request."))).toMatch(/declined/);
    expect(connectError(new Error("Failed to connect Ethereum wallet."))).toMatch(/No wallet answered/);
    expect(connectError("boom")).toBe("The wallet could not connect: boom");
    expect(connectError(new Error("x".repeat(500))).length).toBeLessThan(220);
  });
});
