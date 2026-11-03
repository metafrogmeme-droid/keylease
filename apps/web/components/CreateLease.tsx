"use client";
import { useState, type ChangeEvent } from "react";
import { config } from "../lib/config.ts";
import { leaseTx } from "../lib/lease.ts";
import {
  PRESETS,
  defaultEndpoints,
  expiresAtNs,
  leaseProblem,
  parseEndpoints,
  type LeaseForm,
} from "../lib/presets.ts";
import { failureText, returnValue } from "../lib/testkey.ts";
import type { ShareInfo } from "../lib/snippets.ts";
import { SharePanel } from "./SharePanel.tsx";
import { useWallet } from "./WalletProvider.tsx";

type Choice = (typeof PRESETS)[number]["id"] | "custom";

/** Presets instead of forms; "Custom" opens the full form. Ends in the Share panel. */
export function CreateLease({ keyId, provider }: { readonly keyId: string; readonly provider: string }) {
  const w = useWallet();
  const [choice, setChoice] = useState<Choice>("agent");
  const [grantee, setGrantee] = useState("");
  const [calls, setCalls] = useState("100");
  const [hours, setHours] = useState("24");
  const [endpoints, setEndpoints] = useState(defaultEndpoints(provider).join(", "));
  const [state, setState] = useState<
    { kind: "idle" | "working" } | { kind: "error"; text: string } | { kind: "done"; info: ShareInfo }
  >({
    kind: "idle",
  });

  const preset = PRESETS.find((p) => p.id === choice);
  const form: LeaseForm = preset
    ? {
        grantee: grantee.trim(),
        calls: preset.calls,
        hours: preset.hours,
        endpoints: parseEndpoints(endpoints),
      }
    : {
        grantee: grantee.trim(),
        calls: Number(calls),
        hours: Number(hours),
        endpoints: parseEndpoints(endpoints),
      };

  async function create() {
    const problem = leaseProblem(form);
    if (problem) {
      setState({ kind: "error", text: problem });
      return;
    }
    setState({ kind: "working" });
    try {
      const tx = leaseTx(
        config.contractId,
        keyId,
        form.grantee,
        form.calls,
        expiresAtNs(Date.now(), form.hours),
        form.endpoints,
      );
      const [out] = await w.send([tx]);
      const leaseId = returnValue(out);
      if (typeof leaseId !== "string") {
        setState({
          kind: "error",
          text: "The wallet left the page; the lease shows up under your leases once it is on chain.",
        });
        return;
      }
      setState({
        kind: "done",
        info: {
          origin: window.location.origin,
          contractId: config.contractId,
          leaseId,
          grantee: form.grantee,
          endpoint: form.endpoints[0] ?? "/",
        },
      });
    } catch (e) {
      setState({ kind: "error", text: failureText(e) });
    }
  }

  if (state.kind === "done") return <SharePanel info={state.info} />;
  const field = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
  };
  return (
    <form
      className="lease-form"
      aria-label={`New lease on key ${keyId}`}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <fieldset disabled={state.kind === "working"}>
        <label>
          Grantee (the agent&apos;s or teammate&apos;s account)
          <input
            value={grantee}
            placeholder="agent.testnet"
            onChange={field(setGrantee)}
            autoComplete="off"
          />
        </label>
        <div role="radiogroup" aria-label="Preset">
          {[...PRESETS.map((p) => [p.id, p.label] as const), ["custom", "Custom"] as const].map(
            ([id, label]) => (
              <label key={id} className="radio">
                <input
                  type="radio"
                  name={`preset-${keyId}`}
                  checked={choice === id}
                  onChange={() => {
                    setChoice(id);
                  }}
                />{" "}
                {label}
              </label>
            ),
          )}
        </div>
        {choice === "custom" && (
          <>
            <label>
              Calls
              <input inputMode="numeric" value={calls} onChange={field(setCalls)} />
            </label>
            <label>
              Expires in (hours)
              <input inputMode="decimal" value={hours} onChange={field(setHours)} />
            </label>
          </>
        )}
        <label>
          Endpoints (paths on the key&apos;s base URL)
          <input value={endpoints} onChange={field(setEndpoints)} placeholder="/chat/completions" />
        </label>
        <button type="submit" className="primary">
          Create lease and share
        </button>
      </fieldset>
      <p role="status">{state.kind === "working" ? "Confirm the lease in your wallet…" : ""}</p>
      {state.kind === "error" && <p role="alert">{state.text}</p>}
    </form>
  );
}
