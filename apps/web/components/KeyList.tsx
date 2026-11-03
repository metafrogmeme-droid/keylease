"use client";
import { useCallback, useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import { view } from "../lib/near-rpc.ts";
import { failureText, returnValue, testCallTx, testLeaseTx, verdict, type Verdict } from "../lib/testkey.ts";
import { CreateLease } from "./CreateLease.tsx";
import { txHash, useWallet } from "./WalletProvider.tsx";

export interface KeyRow {
  readonly key_id: string;
  readonly provider: string;
  readonly base_url: string;
  readonly label: string;
}

type Test = { kind: "working"; step: string } | { kind: "done"; verdict: Verdict; tx: string | null };

/** The owner's keys, each with a Test key button. `refresh` changes when a key was added. */
export function KeyList({ refresh = 0 }: { readonly refresh?: number }) {
  const w = useWallet();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, Test>>({});
  const [sharing, setSharing] = useState<string | null>(null);

  useEffect(() => {
    if (w.accountId === null) return;
    let live = true;
    view<KeyRow[]>(config.rpcUrl, config.contractId, "list_keys_by_owner", { owner: w.accountId }).then(
      (k) => {
        if (live) setKeys(k);
      },
      (e: unknown) => {
        if (live) setError(`Could not read your keys: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [w.accountId, refresh]);

  const test = useCallback(
    async (key: KeyRow) => {
      const owner = w.accountId;
      if (owner === null) return;
      const set = (t: Test) => {
        setTests((all) => ({ ...all, [key.key_id]: t }));
      };
      try {
        set({ kind: "working", step: "1/2 Confirm a one-call test lease to yourself…" });
        const [leaseOut] = await w.send([testLeaseTx(config.contractId, key.key_id, owner, Date.now())]);
        const leaseId = returnValue(leaseOut);
        if (typeof leaseId !== "string") {
          set({
            kind: "done",
            tx: null,
            verdict: {
              ok: false,
              text: "This wallet left the page, so the test cannot finish here. Use Meteor, HOT, Intear or MetaMask, or `kl call`.",
            },
          });
          return;
        }
        set({ kind: "working", step: "2/2 Confirm the test call (0.025 NEAR, unused compute refunded)…" });
        const [callOut] = await w.send([testCallTx(config.contractId, leaseId)]);
        set({ kind: "done", verdict: verdict(returnValue(callOut)), tx: txHash(callOut) });
      } catch (e) {
        set({ kind: "done", tx: null, verdict: { ok: false, text: failureText(e) } });
      }
    },
    [w],
  );

  if (w.accountId === null) return null;
  return (
    <section aria-labelledby="your-keys" className="card">
      <h2 id="your-keys">Your keys</h2>
      {error && <p role="alert">{error}</p>}
      {keys === null && !error && <p className="hint">Loading…</p>}
      {keys?.length === 0 && <p className="hint">No keys yet.</p>}
      {keys && keys.length > 0 && (
        <ul className="keys">
          {keys.map((k) => {
            const t = tests[k.key_id];
            return (
              <li key={k.key_id}>
                <strong>{k.label}</strong> <span className="tag">{k.provider}</span> <code>{k.base_url}</code>{" "}
                <button
                  type="button"
                  disabled={t?.kind === "working"}
                  onClick={() => void test(k)}
                  aria-label={`Test key ${k.label}`}
                >
                  Test key
                </button>{" "}
                <button
                  type="button"
                  aria-expanded={sharing === k.key_id}
                  aria-label={`Share key ${k.label}`}
                  onClick={() => {
                    setSharing(sharing === k.key_id ? null : k.key_id);
                  }}
                >
                  Share
                </button>
                <p role="status" className={t?.kind === "done" ? (t.verdict.ok ? "ok" : "bad") : "hint"}>
                  {t?.kind === "working" && t.step}
                  {t?.kind === "done" && `${t.verdict.ok ? "✓" : "✗"} ${t.verdict.text}`}
                  {t?.kind === "done" && t.tx && (
                    <>
                      {" "}
                      <a
                        href={`https://testnet.nearblocks.io/txns/${t.tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        receipt tx
                      </a>
                    </>
                  )}
                </p>
                {sharing === k.key_id && <CreateLease keyId={k.key_id} provider={k.provider} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
