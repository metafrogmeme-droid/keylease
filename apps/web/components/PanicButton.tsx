"use client";
import { useState } from "react";
import { config } from "../lib/config.ts";
import { revokeEverythingTx } from "../lib/receipts.ts";
import { failureText } from "../lib/testkey.ts";
import { useWallet } from "./WalletProvider.tsx";

/**
 * "Revoke everything": one `revoke_all_owner` transaction ends every lease of this account on every key;
 * the next call on any of them is refused with `lease_revoked`. Two clicks, so it cannot fire by accident.
 */
export function PanicButton({ onDone }: { readonly onDone?: () => void }) {
  const w = useWallet();
  const [state, setState] = useState<"idle" | "confirm" | "working" | "done" | { error: string }>("idle");
  if (w.accountId === null) return null;
  return (
    <section aria-labelledby="panic" className="card panic">
      <h2 id="panic">Panic button</h2>
      {state === "idle" && (
        <button
          type="button"
          className="danger"
          onClick={() => {
            setState("confirm");
          }}
        >
          Revoke everything
        </button>
      )}
      {state === "confirm" && (
        <p role="alertdialog" aria-label="Confirm revoke everything">
          Revoke every lease of <code>{w.accountId}</code> on every key?{" "}
          <button
            type="button"
            className="danger"
            onClick={() => {
              setState("working");
              w.send([revokeEverythingTx(config.contractId)]).then(
                () => {
                  setState("done");
                  onDone?.();
                },
                (e: unknown) => {
                  setState({ error: failureText(e) });
                },
              );
            }}
          >
            Yes, revoke everything
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              setState("idle");
            }}
          >
            Cancel
          </button>
        </p>
      )}
      <p role="status">
        {state === "working" && "Confirm in your wallet…"}
        {state === "done" &&
          "✓ Every lease of this account is revoked. The next call on any of them is refused (lease_revoked)."}
      </p>
      {typeof state === "object" && <p role="alert">✗ {state.error}</p>}
    </section>
  );
}
