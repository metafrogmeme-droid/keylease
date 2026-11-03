"use client";
import { useCallback, useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { relative, type LeaseView } from "../lib/lease-view.ts";
import { view } from "../lib/near-rpc.ts";
import { revokeTx } from "../lib/receipts.ts";
import { failureText } from "../lib/testkey.ts";
import { loadTree, TREE_CAP, treeStatus, type TreeNode } from "../lib/tree.ts";
import { useWallet } from "./WalletProvider.tsx";

type State =
  { kind: "loading" } | { kind: "unsupported" } | { kind: "ready"; nodes: TreeNode[]; truncated: boolean };

/**
 * Every sub-lease handed on below a lease, nested. Revoking one refuses its whole branch in the same
 * call (nothing is written per child); the key owner can revoke any of them, an issuer the ones it made.
 */
export function SubLeaseTree({ lease }: { readonly lease: LeaseView }) {
  const w = useWallet();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const run = { live: true };
    const live = () => run.live;
    loadTree(
      (id) => view<LeaseView[]>(config.rpcUrl, config.contractId, "list_sub_leases", { lease_id: id }),
      lease.lease_id,
    ).then(
      (t) => {
        if (live()) setState({ kind: "ready", ...t });
      },
      () => {
        // A contract from before sub-leases has no list_sub_leases: show nothing.
        if (live()) setState({ kind: "unsupported" });
      },
    );
    return () => {
      run.live = false;
    };
  }, [lease.lease_id, tick]);

  const revoke = useCallback(
    async (id: string) => {
      setMsg(null);
      try {
        await w.send([revokeTx(config.contractId, id)]);
        setMsg({ ok: true, text: `✓ Revoked lease ${id} and every sub-lease below it.` });
        setTick((t) => t + 1);
      } catch (e) {
        setMsg({ ok: false, text: failureText(e) });
      }
    },
    [w],
  );

  if (state.kind !== "ready") return null;
  const mayRevoke = (l: LeaseView) =>
    w.accountId !== null && l.status === "active" && (w.accountId === l.owner || w.accountId === l.issuer);

  const items = (nodes: TreeNode[], aboveRevoked: boolean) =>
    nodes.map(({ lease: l, children }) => {
      const refused = aboveRevoked || l.status === "revoked";
      return (
        <li
          key={l.lease_id}
          role="treeitem"
          aria-selected={false}
          aria-label={`Lease ${l.lease_id} held by ${l.grantee}`}
        >
          <a href={`/lease/?id=${l.lease_id}`}>Lease {l.lease_id}</a> → <code>{l.grantee}</code> ·{" "}
          {treeStatus(l, aboveRevoked)} · {l.calls_used} used, {l.calls_left} left of {l.calls_total} ·
          expires {relative(l.expires_at, Date.now())} · from <code>{l.issuer}</code>{" "}
          {!aboveRevoked && mayRevoke(l) && (
            <button
              type="button"
              className="danger"
              aria-label={`Revoke lease ${l.lease_id} and everything below it`}
              onClick={() => {
                void revoke(l.lease_id);
              }}
            >
              Revoke
            </button>
          )}
          {children.length > 0 && <ul role="group">{items(children, refused)}</ul>}
        </li>
      );
    });

  return (
    <section aria-labelledby="subleases-title">
      <h2 id="subleases-title">Sub-leases</h2>
      {state.nodes.length === 0 ? (
        <p className="hint">
          No sub-leases. The holder can hand on part of this lease with the SDK&apos;s{" "}
          <code>lease.subLease()</code>: fewer calls, an earlier expiry, fewer endpoints, never more.
        </p>
      ) : (
        <ul role="tree" aria-label={`Sub-leases of lease ${lease.lease_id}`} className="tree">
          {items(state.nodes, lease.status === "revoked")}
        </ul>
      )}
      {state.truncated && <p className="hint">Only the first {TREE_CAP} sub-leases are shown.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </section>
  );
}
