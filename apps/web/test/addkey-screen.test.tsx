// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddKey, errorText } from "../components/AddKey.tsx";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KEY = ["sk", "test", "y".repeat(30)].join("-");

function wallet(over: Partial<WalletState> = {}): WalletState {
  return {
    ready: true,
    accountId: "alice.testnet",
    walletId: "my-near-wallet",
    error: null,
    busy: false,
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve(["9xHash"])),
    ...over,
  };
}

function show(w: WalletState) {
  render(
    <WalletContext value={w}>
      <AddKey />
    </WalletContext>,
  );
  return screen.getByLabelText<HTMLInputElement>("API key");
}

describe("Add key screen", () => {
  it("turns a network failure into one plain sentence", () => {
    expect(errorText(new TypeError("Failed to fetch"))).toMatch(/nothing was sent/);
    expect(errorText(new Error("User rejected"))).toMatch(/declined/);
  });

  it("says the key is encrypted in the browser and offers the four providers", () => {
    show(wallet());
    expect(screen.getByText(/encrypted in this browser/)).toBeTruthy();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "NEAR AI Cloud",
      "OpenAI-compatible",
      "Anthropic-compatible",
      "Custom base URL",
    ]);
  });

  it("clears the key field at once and never puts the key in the page or storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const w = wallet();
    const field = show(w);
    fireEvent.change(field, { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Seal and add key" }));
    expect(field.value).toBe("");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("nothing was sent");
    });
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(JSON.stringify(window.localStorage)).not.toContain(KEY);
    expect(w.send).not.toHaveBeenCalled();
  });

  it("is a password field with autocomplete off", () => {
    const field = show(wallet());
    expect(field.type).toBe("password");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  it("switching provider fills its base URL", () => {
    show(wallet());
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "AnthropicCompatible" } });
    expect(screen.getByLabelText<HTMLInputElement>("Base URL").value).toBe("https://api.anthropic.com/v1");
  });
});
