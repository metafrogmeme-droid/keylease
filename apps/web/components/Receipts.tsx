"use client";
import { useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { view } from "../lib/near-rpc.ts";
import { outcomeText, type Receipt } from "../lib/receipts.ts";
import { relative } from "./LeaseDetail.tsx";

/** The calls of one lease, newest first: when, endpoint, ✓/✗ reason, and the hashes kept on chain. */
export function Receipts({ leaseId, used }: { readonly leaseId: string; readonly used: number }) {
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (used === 0) {
      setRows([]);
      return;
    }
    const from = Math.max(1, used - 99);
    view<Receipt[]>(config.rpcUrl, config.contractId, "list_receipts", {
      lease_id: leaseId,
      from_call: from,
      limit: 100,
    }).then(
      (r) => {
        setRows(Array.isArray(r) ? [...r].reverse() : []);
      },
      (e: unknown) => {
        setError(`Could not read receipts: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, [leaseId, used]);
  if (error) return <p role="alert">{error}</p>;
  if (rows === null) return <p className="hint">Loading receipts…</p>;
  if (rows.length === 0) return <p className="hint">No calls yet.</p>;
  return (
    <table className="receipts">
      <caption>Receipts (on chain: hashes and outcome, never the body or the key)</caption>
      <thead>
        <tr>
          <th scope="col">Call</th>
          <th scope="col">When</th>
          <th scope="col">Endpoint</th>
          <th scope="col">Result</th>
          <th scope="col">Input sha256</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const o = outcomeText(r);
          return (
            <tr key={r.call}>
              <td>{r.call}</td>
              <td>{relative(r.at, Date.now())}</td>
              <td>
                <code>
                  {r.method} {r.endpoint}
                </code>
              </td>
              <td className={o.ok ? "ok" : "bad"}>
                {o.ok ? "✓" : "✗"} {o.text}
              </td>
              <td>
                <code title={r.input_sha256}>{r.input_sha256.slice(0, 12)}…</code>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
