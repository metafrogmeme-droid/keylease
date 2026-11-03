// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanicButton } from "../components/PanicButton.tsx";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";

afterEach(cleanup);

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

function show(send: WalletState["send"], onDone = vi.fn()) {
  render(
    <WalletContext value={wallet(send)}>
      <PanicButton onDone={onDone} />
    </WalletContext>,
  );
  return onDone;
}

describe("panic button", () => {
  it("asks once, then sends one revoke_all_owner and says what it did", async () => {
    const send = vi.fn<WalletState["send"]>().mockResolvedValue([]);
    const onDone = show(send);
    fireEvent.click(screen.getByRole("button", { name: "Revoke everything" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("alice.testnet");
    fireEvent.click(screen.getByRole("button", { name: "Yes, revoke everything" }));
    await waitFor(() => {
      expect(screen.getByText(/Every lease of this account is revoked/)).toBeTruthy();
    });
    const f = (
      send.mock.calls[0]?.[0][0]?.actions[0] as { functionCall: { methodName: string; deposit: bigint } }
    ).functionCall;
    expect(f.methodName).toBe("revoke_all_owner");
    expect(f.deposit).toBe(0n);
    expect(onDone).toHaveBeenCalled();
  });

  it("Cancel sends nothing", () => {
    const send = vi.fn<WalletState["send"]>();
    show(send);
    fireEvent.click(screen.getByRole("button", { name: "Revoke everything" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Revoke everything" })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the wallet's refusal plainly", async () => {
    show(vi.fn<WalletState["send"]>().mockRejectedValue(new Error("User rejected the request")));
    fireEvent.click(screen.getByRole("button", { name: "Revoke everything" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, revoke everything" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/declined/);
    });
  });
});
