"use client";
import { useRef, useState } from "react";
import { KeystoreUnreachable, keyTransactions, type KeyForm } from "../lib/addkey.ts";
import { config } from "../lib/config.ts";
import { PROVIDERS, type ProviderId } from "../lib/rules.ts";
import { SendTimeout, txHash, useWallet } from "./WalletProvider.tsx";

const CONFIRM_TWO = "Confirm the two transactions in your wallet…";

type Status =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; hashes: string[] }
  | { kind: "error"; text: string };

export function AddKey({ onAdded }: { readonly onAdded?: () => void }) {
  const w = useWallet();
  const [provider, setProvider] = useState<ProviderId>("NearAiCloud");
  const [baseUrl, setBaseUrl] = useState<string>(PROVIDERS[0].baseUrl);
  const [label, setLabel] = useState("my key");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The key lives only in the input element: never in React state, storage or logs (T8).
  const keyField = useRef<HTMLInputElement>(null);

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const field = keyField.current;
    if (!field || w.accountId === null) return;
    const form: KeyForm = { provider, baseUrl, label };
    // Read once, clear the field before anything else runs. (JS cannot wipe the string itself; T8.)
    const apiKey = field.value;
    field.value = "";
    try {
      setStatus({ kind: "working", step: "Sealing the key in this browser…" });
      const built = await keyTransactions(config, w.accountId, form, apiKey);
      setStatus({
        kind: "working",
        step:
          w.walletId === "ethereum-wallets"
            ? `${CONFIRM_TWO} In the box over this page, tap "Confirm transaction" for each, then approve it in MetaMask.`
            : CONFIRM_TWO,
      });
      const outcomes = await w.send(built.transactions);
      setStatus({ kind: "done", hashes: outcomes.map(txHash).filter((h): h is string => h !== null) });
      onAdded?.();
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
    }
  }

  const working = status.kind === "working";
  return (
    <section aria-labelledby="add-key" className="card">
      <h2 id="add-key">Add key</h2>
      <p className="hint">
        Your key is encrypted in this browser to OutLayer&apos;s keystore before it leaves the page; only the
        pinned proxy build, called by the KeyLease contract, can open it.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={working || w.accountId === null}>
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.id === e.target.value) ?? PROVIDERS[0];
                setProvider(p.id);
                setBaseUrl(p.baseUrl);
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL
            <input
              value={baseUrl}
              inputMode="url"
              placeholder="https://api.example.com/v1"
              onChange={(e) => {
                setBaseUrl(e.target.value);
              }}
            />
          </label>
          <label>
            API key
            <input
              ref={keyField}
              type="password"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              placeholder="paste once; cleared after sealing"
            />
          </label>
          <label>
            Label
            <input
              value={label}
              maxLength={64}
              onChange={(e) => {
                setLabel(e.target.value);
              }}
            />
          </label>
          <button type="submit" className="primary">
            Seal and add key
          </button>
        </fieldset>
      </form>
      <p role="status">{status.kind === "working" ? status.step : ""}</p>
      {status.kind === "done" && (
        <p>
          ✓ Key added.{" "}
          {status.hashes.map((h) => (
            <a
              key={h}
              href={`https://testnet.nearblocks.io/txns/${h}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              tx {h.slice(0, 8)}…{" "}
            </a>
          ))}
        </p>
      )}
      {status.kind === "error" && <p role="alert">{status.text}</p>}
    </section>
  );
}

export function errorText(err: unknown): string {
  if (err instanceof KeystoreUnreachable)
    return "OutLayer's keystore could not be reached from this page, so nothing was sent. Try again, or use `kl add-key` (docs/VERIFY.md step 4).";
  if (err instanceof SendTimeout) return err.message;
  if (err instanceof TypeError) return "The network did not answer, so nothing was sent. Try again.";
  const text = err instanceof Error ? err.message : String(err);
  if (/reject|cancel|closed/i.test(text)) return "The wallet declined the transactions. Nothing was added.";
  return text.slice(0, 200);
}
