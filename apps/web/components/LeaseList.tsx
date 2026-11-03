"use client";
import { useCallback, useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { view } from "../lib/near-rpc.ts";
import { outcomeText, revokeTx, type Receipt } from "../lib/receipts.ts";
import { failureText } from "../lib/testkey.ts";
import { relative, type LeaseView } from "./LeaseDetail.tsx";
import { useWallet } from "./WalletProvider.tsx";

const STATUS: Record<LeaseView["status"], string> = {
  active: "active",
  revoked: "revoked",
  expired: "expired",
  used_up: "all calls used",
};

/** The owner's leases with plain status, the last call, and one-click Revoke. */
export function LeaseList({ refresh = 0 }: { readonly refresh?: number }) {
  const w = useWallet();
  const [leases, setLeases] = useState<LeaseView[] | null>(null);
  const [last, setLast] = useState<Record<string, Receipt | undefined>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (w.accountId === null) return;
    const run = { live: true };
    const live = () => run.live; // read through a call: the flag changes while we await
    view<LeaseView[]>(config.rpcUrl, config.contractId, "list_leases_by_owner", { owner: w.accountId }).then(
      async (ls) => {
        if (!live()) return;
        setLeases(ls);
        const latest = await Promise.all(
          ls
            .filter((l) => l.calls_used > 0)
            .map((l) =>
              view<Receipt[]>(config.rpcUrl, config.contractId, "list_receipts", {
                lease_id: l.lease_id,
                from_call: l.calls_used,
                limit: 1,
              }).then(
                (r) => [l.lease_id, r[0]] as const,
                () => [l.lease_id, undefined] as const,
              ),
            ),
        );
        if (live()) setLast(Object.fromEntries(latest));
      },
      (e: unknown) => {
        if (live()) setError(`Could not read your leases: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      run.live = false;
    };
  }, [w.accountId, refresh, tick]);

  const revoke = useCallback(
    async (l: LeaseView) => {
      setMsg((m) => ({ ...m, [l.lease_id]: "Confirm the revoke in your wallet…" }));
      try {
        await w.send([revokeTx(config.contractId, l.lease_id)]);
        setMsg((m) => ({ ...m, [l.lease_id]: "✓ Revoked. The next call is refused with lease_revoked." }));
        setTick((t) => t + 1);
      } catch (e) {
        setMsg((m) => ({ ...m, [l.lease_id]: `✗ ${failureText(e)}` }));
      }
    },
    [w],
  );

  if (w.accountId === null) return null;
  return (
    <section aria-labelledby="your-leases" className="card">
      <h2 id="your-leases">Your leases</h2>
      {error && <p role="alert">{error}</p>}
      {leases === null && !error && <p className="hint">Loading…</p>}
      {leases?.length === 0 && <p className="hint">No leases yet. Share a key to create one.</p>}
      {leases && leases.length > 0 && (
        <ul className="keys">
          {leases.map((l) => {
            const r = last[l.lease_id];
            const o = r ? outcomeText(r) : null;
            return (
              <li key={l.lease_id} aria-label={`Lease ${l.lease_id}`}>
                <a href={`/lease/?id=${l.lease_id}`}>Lease {l.lease_id}</a> → <code>{l.grantee}</code>{" "}
                <span className="tag">{STATUS[l.status]}</span>
                <br />
                {l.calls_used} used, {l.calls_left} left · expires {relative(l.expires_at, Date.now())}
                {r && o && (
                  <>
                    {" "}
                    · last call {relative(r.at, Date.now())} <code>{r.endpoint}</code>{" "}
                    <span className={o.ok ? "ok" : "bad"}>
                      {o.ok ? "✓" : "✗"} {o.text}
                    </span>
                  </>
                )}{" "}
                {l.status === "active" && (
                  <button
                    type="button"
                    aria-label={`Revoke lease ${l.lease_id}`}
                    onClick={() => void revoke(l)}
                  >
                    Revoke
                  </button>
                )}
                <p role="status" className="hint">
                  {msg[l.lease_id] ?? ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
