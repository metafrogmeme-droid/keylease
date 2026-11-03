// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateLease } from "../components/CreateLease.tsx";
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

const outcome = (v: unknown) => ({ status: { SuccessValue: btoa(JSON.stringify(v)) } });

function show(send: WalletState["send"]) {
  render(
    <WalletContext value={wallet(send)}>
      <CreateLease keyId="0" provider="OpenAiCompatible" />
    </WalletContext>,
  );
}

describe("create a lease from a preset and share it", () => {
  it("sends one create_lease and shows link, QR and copy buttons", async () => {
    const send = vi.fn<WalletState["send"]>().mockResolvedValue([outcome("7")]);
    show(send);
    fireEvent.change(screen.getByLabelText(/Grantee/), { target: { value: "agent.testnet" } });
    fireEvent.click(screen.getByLabelText("Demo, 1 hour, 10 calls"));
    fireEvent.click(screen.getByRole("button", { name: "Create lease and share" }));
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Share lease 7" })).toBeTruthy();
    });
    const call = send.mock.calls[0]?.[0][0];
    const f = (call?.actions[0] as { functionCall: { args: Uint8Array } }).functionCall;
    expect(JSON.parse(new TextDecoder().decode(f.args))).toMatchObject({
      key_id: "0",
      grantee: "agent.testnet",
      calls: 10,
      endpoints: ["/chat/completions"],
    });
    expect(screen.getByRole("img", { name: /QR code of the link to lease 7/ })).toBeTruthy();
    for (const n of ["Link", "SDK", "near CLI", "MCP"])
      expect(screen.getByRole("button", { name: `Copy ${n}` })).toBeTruthy();
    expect(screen.getByRole("link", { name: /\/lease\/\?id=7$/ })).toBeTruthy();
  });

  it("names the problem before any wallet opens", () => {
    const send = vi.fn<WalletState["send"]>();
    show(send);
    fireEvent.change(screen.getByLabelText(/Grantee/), { target: { value: "agent.near" } });
    fireEvent.click(screen.getByRole("button", { name: "Create lease and share" }));
    expect(screen.getByRole("alert").textContent).toMatch(/testnet/);
    expect(send).not.toHaveBeenCalled();
  });

  it("Custom opens calls and expiry fields", async () => {
    const send = vi.fn<WalletState["send"]>().mockResolvedValue([outcome("9")]);
    show(send);
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText(/Grantee/), { target: { value: "mate.testnet" } });
    fireEvent.change(screen.getByLabelText("Calls"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Expires in/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create lease and share" }));
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Share lease 9" })).toBeTruthy();
    });
    const f = (send.mock.calls[0]?.[0][0]?.actions[0] as { functionCall: { args: Uint8Array } }).functionCall;
    expect(JSON.parse(new TextDecoder().decode(f.args))).toMatchObject({ calls: 3, grantee: "mate.testnet" });
  });
});
