// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A wallet whose send never finishes (a confirm box nobody sees, a stuck in-app browser).
const signAndSendTransactions = vi.fn(() => new Promise<never>(() => undefined));
vi.mock("../lib/selector.ts", () => ({
  createSelector: () =>
    Promise.resolve({
      store: {
        observable: {
          subscribe: (cb: (s: unknown) => void) => {
            cb({ accounts: [], selectedWalletId: null });
            return { unsubscribe: () => undefined };
          },
        },
      },
      wallet: () => Promise.resolve({ signAndSendTransactions }),
    }),
}));
const { WalletProvider, useWallet, SEND_TIMEOUT_MS, SEND_TIMEOUT_TEXT, SendTimeout } =
  await import("../components/WalletProvider.tsx");
const { errorText } = await import("../components/AddKey.tsx");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Probe() {
  const w = useWallet();
  return (
    <button
      type="button"
      disabled={!w.ready}
      onClick={() => {
        w.send([{ receiverId: "x.testnet", actions: [] }]).catch((e: unknown) => {
          const p = document.createElement("p");
          p.setAttribute("role", "alert");
          p.textContent = errorText(e);
          document.body.appendChild(p);
        });
      }}
    >
      send
    </button>
  );
}

describe("wallet send timeout", () => {
  it("is 5 minutes", () => {
    expect(SEND_TIMEOUT_MS).toBe(300_000);
  });

  it("a send that never finishes: a clear error, and the wallet's confirm box is cancelled", async () => {
    // The library's confirm box, as ethereum-wallets renders it.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="ethereum-wallet-modal"><button class="ethereum-wallet-btn ethereum-wallet-btn-cancel">Cancel</button></div>',
    );
    const cancel = vi.fn();
    document.querySelector(".ethereum-wallet-btn-cancel")?.addEventListener("click", cancel);
    render(
      <WalletProvider sendTimeoutMs={50}>
        <Probe />
      </WalletProvider>,
    );
    const button = await screen.findByRole<HTMLButtonElement>("button", { name: "send" });
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    act(() => {
      button.click();
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(SEND_TIMEOUT_TEXT);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(signAndSendTransactions).toHaveBeenCalledTimes(1);
    expect(errorText(new SendTimeout(SEND_TIMEOUT_TEXT))).toBe(SEND_TIMEOUT_TEXT);
  });
});
