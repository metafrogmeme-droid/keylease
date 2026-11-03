// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let query = "id=7";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
const { LeaseDetail, relative } = await import("../components/LeaseDetail.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubLease(value: unknown) {
  const rpc = { result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(rpc)))),
  );
}

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
};

describe("lease page", () => {
  it("shows plain status and the share panel for an active lease", async () => {
    query = "id=7";
    stubLease(LEASE);
    render(<LeaseDetail />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Lease 7" })).toBeTruthy();
    });
    expect(screen.getByText("3 used, 7 left of 10")).toBeTruthy();
    expect(screen.getByText("in 3 h")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Share lease 7" })).toBeTruthy();
  });

  it("says revoked plainly and hides sharing", async () => {
    query = "id=7";
    stubLease({ ...LEASE, status: "revoked" });
    render(<LeaseDetail />);
    await waitFor(() => {
      expect(screen.getByText("revoked by the key owner")).toBeTruthy();
    });
    expect(screen.queryByRole("group", { name: /Share/ })).toBeNull();
  });

  it("uses the refusal wording for a missing lease and refuses a bad id", async () => {
    query = "id=99";
    stubLease(null);
    render(<LeaseDetail />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/^lease_not_found: /);
    });
    cleanup();
    query = "id=abc";
    render(<LeaseDetail />);
    expect(screen.getByRole("alert").textContent).toMatch(/no valid lease id/);
  });

  it("writes times plainly", () => {
    expect(relative(String(BigInt(10 * 60_000) * 1_000_000n), 0)).toBe("in 10 min");
    expect(relative(String(BigInt(5 * 86_400_000) * 1_000_000n), 0)).toBe("in 5 days");
    expect(relative("0", 2 * 3_600_000)).toBe("2 h ago");
  });
});
