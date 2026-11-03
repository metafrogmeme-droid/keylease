"use client";
import { useId, useState } from "react";
import type { WalletOption } from "../lib/wallets.ts";
import { useWallet } from "./WalletProvider.tsx";

export function ConnectWallet({ options }: { readonly options: readonly WalletOption[] }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (w.accountId !== null) {
    return (
      <div className="wallet">
        <p>
          Connected as <code>{w.accountId}</code>
          {w.walletId ? ` (${optionName(options, w.walletId)})` : ""}.{" "}
          <button type="button" onClick={() => void w.disconnect()}>
            Disconnect
          </button>
        </p>
        {w.error && <p role="alert">{w.error}</p>}
      </div>
    );
  }

  return (
    <div className="wallet">
      <button
        type="button"
        className="primary"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Connect wallet
      </button>
      {open && (
        <ul id={listId} className="wallets" aria-label="Wallets">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={!o.configured || !w.ready || w.busy}
                aria-describedby={`${listId}-${o.id}`}
                onClick={() => void w.connect(o.id)}
              >
                {o.name}
                {o.kind !== o.name && <span className="tag">{o.kind}</span>}
              </button>{" "}
              <span id={`${listId}-${o.id}`} className="hint">
                {o.note}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && !w.ready && !w.error && <p className="hint">Loading wallets…</p>}
      {w.error && <p role="alert">{w.error}</p>}
    </div>
  );
}

function optionName(options: readonly WalletOption[], id: string): string {
  return options.find((o) => o.id === id)?.name ?? id;
}
