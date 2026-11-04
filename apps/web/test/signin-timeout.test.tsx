// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A wallet that never answers its sign-in (a closed popup, a stuck in-app browser).
const signIn = vi.fn(() => new Promise<never>(() => undefined));
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
      wallet: () => Promise.resolve({ signIn }),
    }),
}));
const { WalletProvider, useWallet, SIGN_IN_TIMEOUT_MS } = await import("../components/WalletProvider.tsx");

afterEach(cleanup);

function Probe() {
  const w = useWallet();
  return (
    <div>
      <button type="button" disabled={!w.ready || w.busy} onClick={() => void w.connect("meteor-wallet")}>
        connect
      </button>
      <p data-testid="busy">{String(w.busy)}</p>
      {w.error && <p role="alert">{w.error}</p>}
    </div>
  );
}

describe("wallet sign-in timeout", () => {
  it("is about 60 seconds", () => {
    expect(SIGN_IN_TIMEOUT_MS).toBe(60_000);
  });

  it("a wallet that never answers: a clear error after the timeout, and connecting is reset", async () => {
    render(
      <WalletProvider signInTimeoutMs={50}>
        <Probe />
      </WalletProvider>,
    );
    const button = await screen.findByRole<HTMLButtonElement>("button", { name: "connect" });
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.getByTestId("busy").textContent).toBe("true");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "The wallet did not answer within 60 seconds. Close its window or app and try again.",
      );
    });
    expect(screen.getByTestId("busy").textContent).toBe("false");
    expect(button.disabled).toBe(false);
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
