"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { view } from "../lib/near-rpc.ts";
import { Receipts } from "./Receipts.tsx";
import { SharePanel } from "./SharePanel.tsx";

export interface LeaseView {
  readonly lease_id: string;
  readonly key_id: string;
  readonly owner: string;
  readonly grantee: string;
  readonly calls_total: number;
  readonly calls_used: number;
  readonly calls_left: number;
  readonly expires_at: string;
  readonly endpoints: string[];
  readonly status: "active" | "revoked" | "expired" | "used_up";
}

/** "in 3 h", "in 2 days", "5 min ago": plain time to or since a nanosecond timestamp. */
export function relative(ns: string, nowMs: number): string {
  const diff = Number(BigInt(ns) / 1_000_000n) - nowMs;
  const a = Math.abs(diff);
  const text =
    a < 3_600_000
      ? `${String(Math.max(1, Math.round(a / 60_000)))} min`
      : a < 172_800_000
        ? `${String(Math.round(a / 3_600_000))} h`
        : `${String(Math.round(a / 86_400_000))} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

const STATUS: Record<LeaseView["status"], string> = {
  active: "active",
  revoked: "revoked by the key owner",
  expired: "expired",
  used_up: "all calls used",
};

/** The page a lease link opens: what the lease allows, and how to use it. */
export function LeaseDetail() {
  const id = useSearchParams().get("id");
  const [lease, setLease] = useState<LeaseView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

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
      <h2>Calls</h2>
      <Receipts leaseId={lease.lease_id} used={lease.calls_used} />
    </section>
  );
}
