// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyList } from "../components/KeyList.tsx";
import { LeaseList } from "../components/LeaseList.tsx";
import { Receipts } from "../components/Receipts.tsx";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";
import { fakeRpc } from "./fake-rpc.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const soon = String(BigInt(Date.now() + 2 * 3_600_000) * 1_000_000n);
const recent = String(BigInt(Date.now() - 5 * 60_000) * 1_000_000n);
let status = "active";
const lease = () => ({
  lease_id: "7",
  key_id: "0",
  owner: "alice.testnet",
  grantee: "agent.testnet",
  calls_total: 10,
  calls_used: 3,
  calls_left: 7,
  expires_at: soon,
  endpoints: ["/chat/completions"],
  status,
});
const receipt = (call: number, outcome = "ok", code: string | null = null) => ({
  lease_id: "7",
  call,
  caller: "agent.testnet",
  endpoint: "/chat/completions",
  method: "POST",
  input_sha256: "c".repeat(64),
  output_sha256: null,
  outcome,
  code,
  http_status: outcome === "ok" ? 200 : null,
  at: recent,
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

describe("lease list", () => {
  it("shows plain status and the last call, and revokes in one click", async () => {
    status = "active";
    const rpc = fakeRpc({
      list_leases_by_owner: () => [lease()],
      list_receipts: () => [receipt(3, "refused", "endpoint_not_in_lease")],
    });
    vi.stubGlobal("fetch", rpc.fetcher);
    const send = vi.fn<WalletState["send"]>(() => {
      status = "revoked";
      return Promise.resolve([]);
    });
    render(
      <WalletContext value={wallet(send)}>
        <LeaseList />
      </WalletContext>,
    );
    const row = await screen.findByRole("listitem", { name: "Lease 7" });
    await waitFor(() => {
      expect(row.textContent).toContain("✗ endpoint_not_in_lease");
    });
    expect(row.textContent).toContain("3 used, 7 left · expires in 2 h");
    expect(row.textContent).toContain("last call 5 min ago");
    expect(rpc.calls.find((c) => c.method === "list_receipts")?.args).toEqual({
      lease_id: "7",
      from_call: 3,
      limit: 1,
    });

    fireEvent.click(within(row).getByRole("button", { name: "Revoke lease 7" }));
    await waitFor(() => {
      expect(screen.getByText(/Revoked. The next call is refused with lease_revoked/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(within(screen.getByRole("listitem", { name: "Lease 7" })).getByText("revoked")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Revoke lease 7" })).toBeNull();
  });

  it("revokes every lease on a key from the key row", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRpc({
        list_keys_by_owner: () => [
          { key_id: "0", provider: "OpenAiCompatible", base_url: "https://m.example", label: "demo" },
        ],
      }).fetcher,
    );
    const send = vi.fn<WalletState["send"]>().mockResolvedValue([]);
    render(
      <WalletContext value={wallet(send)}>
        <KeyList />
      </WalletContext>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Revoke all leases on key demo" }));
    await waitFor(() => {
      expect(screen.getByText(/Every lease on this key is revoked/)).toBeTruthy();
    });
    const f = (send.mock.calls[0]?.[0][0]?.actions[0] as { functionCall: { methodName: string } })
      .functionCall;
    expect(f.methodName).toBe("revoke_all");
  });
});

describe("receipts table", () => {
  it("lists calls newest first with ✓/✗ and the input hash, never a body", async () => {
    vi.stubGlobal(
      "fetch",
      fakeRpc({ list_receipts: () => [receipt(1), receipt(2, "tripwire", "tripwire")] }).fetcher,
    );
    render(<Receipts leaseId="7" used={2} />);
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("✗ tripwire");
    expect(rows[2]?.textContent).toContain("✓ HTTP 200");
    expect(screen.getByRole("table").textContent).toContain("never the body or the key");
  });

  it("says no calls yet without asking the chain", () => {
    const rpc = fakeRpc({});
    vi.stubGlobal("fetch", rpc.fetcher);
    render(<Receipts leaseId="7" used={0} />);
    expect(screen.getByText("No calls yet.")).toBeTruthy();
    expect(rpc.calls).toEqual([]);
  });
});
