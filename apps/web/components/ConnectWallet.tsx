"use client";
import { useEffect, useId, useState } from "react";
import { walletOptions, type WalletOption } from "../lib/wallets.ts";
import { useWallet } from "./WalletProvider.tsx";

/** True once an EVM wallet has put `window.ethereum` on the page (MetaMask's in-app browser, the extension). */
function useInjectedEvm(): boolean {
  const [injected, setInjected] = useState(false);
  useEffect(() => {
    const look = () => {
      setInjected("ethereum" in window && Boolean((window as { ethereum?: unknown }).ethereum));
    };
    look();
    window.addEventListener("ethereum#initialized", look, { once: true });
    return () => {
      window.removeEventListener("ethereum#initialized", look);
    };
  }, []);
  return injected;
}

export function ConnectWallet({ reownProjectId }: { readonly reownProjectId: string | null }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const options = walletOptions({ reownProjectId }, { injected: useInjectedEvm() });

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
                {o.recommended && <span className="tag">recommended</span>}
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
