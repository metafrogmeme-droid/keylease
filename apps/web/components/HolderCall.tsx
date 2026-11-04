"use client";
import { useEffect, useState } from "react";
import { config } from "../lib/config.ts";
import {
  callBlocked,
  holderCallTx,
  readCall,
  sendsPrompt,
  suggestedModel,
  testEndpoint,
  type CallResult,
} from "../lib/holdercall.ts";
import type { LeaseView } from "../lib/lease-view.ts";
import { view } from "../lib/near-rpc.ts";
import { failureText, verdictMark } from "../lib/testkey.ts";
import { useWallet } from "./WalletProvider.tsx";

/**
 * "Make a test call" for the signed-in holder: one leased call from this page, then the answer's
 * HTTP status, OutLayer's request id, the tx and the calls left. `onCalled` reloads the lease.
 */
export function HolderCall({
  lease,
  onCalled,
}: {
  readonly lease: LeaseView;
  readonly onCalled: () => Promise<LeaseView | null>;
}) {
  const w = useWallet();
  const [state, setState] = useState<
    | { kind: "idle" | "working" }
    | { kind: "error"; text: string }
    | { kind: "done"; result: CallResult; left: number | null }
  >({ kind: "idle" });
  const blocked = callBlocked(lease, w.accountId);
  const endpoint = testEndpoint(lease.endpoints);
  const prompt = sendsPrompt(lease.endpoints);
  const [model, setModel] = useState("");

  // The model field starts from the key's provider (Anthropic-compatible keys need one).
  useEffect(() => {
    if (blocked !== null || !prompt) return;
    const run = { live: true };
    view<{ provider: string; base_url: string } | null>(config.rpcUrl, config.contractId, "get_key", {
      key_id: lease.key_id,
    }).then(
      (k) => {
        if (run.live && k) setModel((m) => (m === "" ? suggestedModel(k.provider, k.base_url) : m));
      },
      () => undefined,
    );
    return () => {
      run.live = false;
    };
  }, [blocked, prompt, lease.key_id]);

  async function call() {
    setState({ kind: "working" });
    try {
      const [out] = await w.send([holderCallTx(config.contractId, lease.lease_id, lease.endpoints, model)]);
      if (out === undefined) {
        setState({
          kind: "error",
          text: "The wallet left the page; the call shows under Calls once it is on chain.",
        });
        return;
      }
      const result = readCall(out, config.contractId);
      const fresh = await onCalled().catch(() => null);
      setState({ kind: "done", result, left: fresh?.calls_left ?? null });
    } catch (e) {
      setState({ kind: "error", text: failureText(e) });
    }
  }

  return (
    <section className="holder-call card" aria-labelledby="holder-call-title">
      <h2 id="holder-call-title">Make a call</h2>
      {blocked !== null && state.kind !== "done" ? (
        <p className="hint">{blocked}</p>
      ) : (
        <>
          <p className="hint">
            One call on {endpoint} through the proxy, as the holder: 0.025 NEAR attached, unused compute
            refunded, and it uses one of the lease&apos;s calls.
          </p>
          {blocked === null && prompt && (
            <label>
              Model (the API&apos;s model id; leave empty to send none)
              <input
                value={model}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setModel(e.target.value);
                }}
              />
            </label>
          )}
          {blocked === null && (
            <button
              type="button"
              className="primary"
              disabled={state.kind === "working"}
              onClick={() => void call()}
            >
              Make a test call
            </button>
          )}
        </>
      )}
      <p role="status">{state.kind === "working" ? "Confirm the call in your wallet…" : ""}</p>
      {state.kind === "error" && <p role="alert">{state.text}</p>}
      {state.kind === "done" && (
        <div role="status" aria-label="Test call result">
          <p className={state.result.verdict.ok ? "ok" : state.result.verdict.apiRejected ? "hint" : "bad"}>
            {verdictMark(state.result.verdict)} {state.result.verdict.text}
          </p>
          <ul>
            <li>HTTP {state.result.status === null ? "–" : String(state.result.status)}</li>
            <li>
              {state.result.requestId === null
                ? "OutLayer request id: see the tx (not in its logs)"
                : `OutLayer request ${state.result.requestId}`}
            </li>
            {state.result.tx && (
              <li>
                <a
                  href={`https://testnet.nearblocks.io/txns/${state.result.tx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  use_lease tx {state.result.tx}
                </a>
              </li>
            )}
            {state.left !== null && <li>{`${String(state.left)} calls left`}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
