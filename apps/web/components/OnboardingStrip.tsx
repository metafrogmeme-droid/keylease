import { FAUCET_URL } from "../lib/config.ts";

export type StepState = "done" | "current" | "next";

export interface Progress {
  readonly connected: boolean;
  readonly hasKey: boolean;
  readonly hasLease: boolean;
}

export const STEPS = [
  { title: "Connect", text: "Connect a NEAR, WalletConnect or MetaMask wallet." },
  { title: "Add key", text: "Paste an API key. It is encrypted in this browser before it leaves the page." },
  { title: "Share", text: "Pick a preset and share a lease link. The link holds a lease id, never the key." },
] as const;

/** State of each step: everything before the first open step is done, that one is current. */
export function stepStates(p: Progress): StepState[] {
  const done = [p.connected, p.connected && p.hasKey, p.connected && p.hasKey && p.hasLease];
  const current = done.indexOf(false);
  return done.map((d, i) => (d ? "done" : i === current ? "current" : "next"));
}

const MARK: Record<StepState, string> = { done: "✓", current: "→", next: "" };

export function OnboardingStrip({ progress }: { readonly progress: Progress }) {
  const states = stepStates(progress);
  return (
    <section aria-labelledby="start" className="strip">
      <h2 id="start">Start in three steps</h2>
      <ol>
        {STEPS.map((s, i) => {
          const state = states[i] ?? "next";
          return (
            <li
              key={s.title}
              className={`step ${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="num" aria-hidden="true">
                {MARK[state] || String(i + 1)}
              </span>
              <span>
                <strong>{s.title}</strong>
                <span className="sr-only">{state === "done" ? " (done)" : ""}</span>
                <br />
                {s.text}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="hint">
        Need testnet NEAR for gas?{" "}
        <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
          Get some from the testnet faucet
        </a>
        .
      </p>
    </section>
  );
}
