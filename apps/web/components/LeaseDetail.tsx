"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { STATUS, relative, type LeaseView } from "../lib/lease-view.ts";
import { view } from "../lib/near-rpc.ts";
import { KeyPassTransfer } from "./KeyPassTransfer.tsx";
import { Receipts } from "./Receipts.tsx";
import { SharePanel } from "./SharePanel.tsx";
import { SubLeaseTree } from "./SubLeaseTree.tsx";
import { useWallet } from "./WalletProvider.tsx";

export { relative, type LeaseView };

/** The page a lease link opens: what the lease allows, and how to use it. */
export function LeaseDetail() {
  const id = useSearchParams().get("id");
  const w = useWallet();
  const [lease, setLease] = useState<LeaseView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ to: string; tx: string | null } | null>(null);

  useEffect(() => {
    if (id === null || !/^\d{1,20}$/u.test(id)) return;
    view<LeaseView | null>(config.rpcUrl, config.contractId, "get_lease", { lease_id: id }).then(
      setLease,
      (e: unknown) => {
        setError(`Could not read the lease: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, [id]);

  if (id === null || !/^\d{1,20}$/u.test(id)) return <p role="alert">This link has no valid lease id.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (lease === undefined) return <p className="hint">Loading lease {id}…</p>;
  if (lease === null)
    return <p role="alert">lease_not_found: No lease has this id; check the lease id you were given.</p>;
  return (
    <section aria-labelledby="lease-title">
      <h1 id="lease-title">Lease {lease.lease_id}</h1>
      {lease.parent != null && (
        <p className="hint">
          A sub-lease, handed on from <a href={`/lease/?id=${lease.parent}`}>lease {lease.parent}</a> by{" "}
          {lease.issuer}. It can never outlive or exceed the leases above it, and revoking any of them refuses
          it.
        </p>
      )}
      <dl className="facts">
        <dt>Status</dt>
        <dd>{STATUS[lease.status]}</dd>
        <dt>Holder</dt>
        <dd>
          <code>{lease.grantee}</code>
        </dd>
        <dt>Calls</dt>
        <dd>
          {lease.calls_used} used, {lease.calls_left} left of {lease.calls_total}
        </dd>
        <dt>Expires</dt>
        <dd>{relative(lease.expires_at, Date.now())}</dd>
        <dt>Endpoints</dt>
        <dd>
          {lease.endpoints.map((e) => (
            <code key={e}>{e} </code>
          ))}
        </dd>
      </dl>
      {moved && (
        <p>
          ✓ Key Pass {lease.lease_id} moved to {moved.to}. Your account is refused on this lease from now on.{" "}
          {moved.tx && (
            <a
              href={`https://testnet.nearblocks.io/txns/${moved.tx}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              tx {moved.tx}
            </a>
          )}
        </p>
      )}
      {lease.status === "active" && w.accountId === lease.grantee && (lease.depth ?? 0) === 0 && (
        <KeyPassTransfer
          leaseId={lease.lease_id}
          holder={lease.grantee}
          onMoved={(to, tx) => {
            setMoved({ to, tx });
            setLease({ ...lease, grantee: to });
          }}
        />
      )}
      {lease.status === "active" && (
        <SharePanel
          info={{
            origin: window.location.origin,
            contractId: config.contractId,
            leaseId: lease.lease_id,
            grantee: lease.grantee,
            endpoint: lease.endpoints[0] ?? "/",
          }}
        />
      )}
      <SubLeaseTree lease={lease} />
      <h2>Calls</h2>
      <Receipts leaseId={lease.lease_id} used={lease.calls_used} />
    </section>
  );
}
