// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletContext, type WalletState } from "../components/WalletProvider.tsx";
import type { LeaseView } from "../components/LeaseDetail.tsx";
import { loadTree, TREE_CAP } from "../lib/tree.ts";
import { fakeRpc } from "./fake-rpc.ts";

let query = "id=7";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
const { LeaseDetail } = await import("../components/LeaseDetail.tsx");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const inHours = (h: number) => String(BigInt(Date.now() + h * 3_600_000) * 1_000_000n);

function node(id: string, over: Partial<LeaseView> = {}): LeaseView {
  return {
    lease_id: id,
    key_id: "0",
    owner: "alice.testnet",
    grantee: `agent${id}.testnet`,
    calls_total: 4,
    calls_used: 1,
    calls_left: 3,
    expires_at: inHours(2),
    endpoints: ["/chat/completions"],
    status: "active",
    parent: "7",
    depth: 1,
    issuer: "lead.testnet",
    ...over,
  };
}

/** Lease 7 (the lead agent's), handed on to 12 and 13; 12 handed on to 20. */
function world(over: Record<string, Partial<LeaseView>> = {}) {
  const leases: Record<string, LeaseView> = {
    "7": node("7", {
      grantee: "lead.testnet",
      parent: null,
      depth: 0,
      issuer: "alice.testnet",
      calls_total: 10,
    }),
    "12": node("12"),
    "13": node("13", { calls_used: 0, calls_left: 2, calls_total: 2 }),
    "20": node("20", { parent: "12", depth: 2, issuer: "agent12.testnet" }),
  };
  for (const [id, o] of Object.entries(over)) leases[id] = { ...(leases[id] as LeaseView), ...o };
  const kids: Record<string, string[]> = { "7": ["12", "13"], "12": ["20"] };
  return fakeRpc({
    get_lease: (a) => leases[String(a["lease_id"])] ?? null,
    list_receipts: () => [],
    list_sub_leases: (a) => (kids[String(a["lease_id"])] ?? []).map((id) => leases[id]),
  });
}

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

function show(accountId: string | null, rpc = world(), send = vi.fn<WalletState["send"]>()) {
  vi.stubGlobal("fetch", rpc.fetcher);
  render(
    <WalletContext value={wallet(accountId, send)}>
      <LeaseDetail />
    </WalletContext>,
  );
  return { rpc, send };
}

const tree = () => screen.findByRole("tree", { name: "Sub-leases of lease 7" });
const item = (t: HTMLElement, id: string) =>
  within(t).getByRole("treeitem", { name: new RegExp(`^Lease ${id} `) });

describe("sub-lease tree on the lease page", () => {
  it("loads the whole tree, level by level, within a cap", async () => {
    const kids: Record<string, string[]> = { "1": ["2", "3"], "2": ["4"], "3": [], "4": [] };
    const got = await loadTree((id) => Promise.resolve((kids[id] ?? []).map((k) => node(k))), "1");
    expect(got.truncated).toBe(false);
    expect(got.nodes.map((n) => [n.lease.lease_id, n.children.map((c) => c.lease.lease_id)])).toEqual([
      ["2", ["4"]],
      ["3", []],
    ]);
    const wide = await loadTree(
      (id) =>
        Promise.resolve(
          id === "1"
            ? Array.from({ length: 10 }, (_, i) => node(String(i + 10)))
            : Array.from({ length: 10 }, (_, i) => node(`${id}${String(i)}`)),
        ),
      "1",
    );
    expect(wide.truncated).toBe(true);
    const count = (ns: typeof wide.nodes): number => ns.reduce((a, n) => a + 1 + count(n.children), 0);
    expect(count(wide.nodes)).toBe(TREE_CAP);
  });

  it("shows each sub-lease with holder, calls, expiry and a link, nested under its parent", async () => {
    show(null);
    const t = await tree();
    const twelve = item(t, "12");
    expect(twelve.textContent).toMatch(/agent12\.testnet/);
    expect(twelve.textContent).toMatch(/1 used, 3 left of 4/);
    expect(twelve.textContent).toMatch(/in 2 h/);
    expect(within(twelve).getByRole("link", { name: "Lease 12" }).getAttribute("href")).toBe("/lease/?id=12");
    // 20 sits inside 12, not beside it
    expect(within(twelve).getByRole("treeitem", { name: /^Lease 20 / })).toBeTruthy();
    expect(within(item(t, "13")).queryByRole("treeitem")).toBeNull();
  });

  it("a revoked lease shows its whole subtree refused (the cascade)", async () => {
    show(null, world({ "12": { status: "revoked" }, "20": { status: "revoked" } }));
    const t = await tree();
    expect(item(t, "12").textContent).toMatch(/revoked/);
    expect(within(item(t, "12")).getByRole("treeitem", { name: /^Lease 20 / }).textContent).toMatch(
      /refused: a lease above was revoked/,
    );
    expect(item(t, "13").textContent).toMatch(/active/);
  });

  it("the key owner revokes a branch in one transaction; the page reloads it as refused", async () => {
    const rpc = world();
    const send = vi.fn<WalletState["send"]>().mockImplementation(() => {
      // what the chain answers after the revoke: 12 revoked, and 20 with it
      vi.stubGlobal("fetch", world({ "12": { status: "revoked" }, "20": { status: "revoked" } }).fetcher);
      return Promise.resolve([]);
    });
    show("alice.testnet", rpc, send);
    const t = await tree();
    fireEvent.click(
      within(item(t, "12")).getByRole("button", { name: "Revoke lease 12 and everything below it" }),
    );
    await waitFor(() => {
      expect(screen.getByText(/✓ Revoked lease 12 and every sub-lease below it/)).toBeTruthy();
    });
    const f = (
      send.mock.calls[0]?.[0][0]?.actions[0] as { functionCall: { methodName: string; args: Uint8Array } }
    ).functionCall;
    expect(f.methodName).toBe("revoke");
    expect(JSON.parse(new TextDecoder().decode(f.args))).toEqual({ lease_id: "12" });
    await waitFor(() => {
      expect(
        within(item(screen.getByRole("tree", { name: "Sub-leases of lease 7" }), "12")).getByRole(
          "treeitem",
          { name: /^Lease 20 / },
        ).textContent,
      ).toMatch(/refused: a lease above was revoked/);
    });
  });

  it("Revoke shows only to the key owner and to a sub-lease's issuer", async () => {
    show("lead.testnet"); // issued 12 and 13, not 20
    let t = await tree();
    expect(within(item(t, "13")).queryByRole("button", { name: /Revoke lease 13/ })).toBeTruthy();
    expect(within(item(t, "12")).queryByRole("button", { name: /Revoke lease 20/ })).toBeNull();
    cleanup();
    show("stranger.testnet");
    t = await tree();
    expect(within(t).queryAllByRole("button")).toEqual([]);
  });

  it("no sub-leases: says how to make one; a sub-lease's own page says where it came from", async () => {
    query = "id=13";
    show(null);
    expect(await screen.findByText(/No sub-leases/)).toBeTruthy();
    expect(screen.getByText(/lease\.subLease\(\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "lease 7" }).getAttribute("href")).toBe("/lease/?id=7");
    expect(screen.getByText(/by lead\.testnet/)).toBeTruthy();
    query = "id=7";
  });

  it("a contract from before sub-leases: no tree, no error", async () => {
    const old = fakeRpc({
      get_lease: () =>
        Object.fromEntries(
          Object.entries(node("7")).filter(([k]) => !["parent", "depth", "issuer"].includes(k)),
        ),
      list_receipts: () => [],
    });
    show(null, old);
    await screen.findByRole("heading", { name: "Lease 7" });
    await waitFor(() => {
      expect(old.calls.some((c) => c.method === "list_sub_leases")).toBe(true);
    });
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
