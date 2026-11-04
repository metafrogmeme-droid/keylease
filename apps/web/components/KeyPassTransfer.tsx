"use client";
import { useState } from "react";
import { config } from "../lib/config.ts";
import {
  NOT_TRANSFERABLE,
  NOT_TRANSFERABLE_TEXT,
  receiverId,
  receiverProblem,
  transferTx,
} from "../lib/keypass.ts";
import { failureText } from "../lib/testkey.ts";
import { txHash, useWallet } from "./WalletProvider.tsx";

/** The holder moves the lease to another account: one `nft_transfer`, 1 yoctoNEAR. */
export function KeyPassTransfer({
  leaseId,
  holder,
  onMoved,
}: {
  readonly leaseId: string;
  readonly holder: string;
  readonly onMoved: (receiver: string, tx: string | null) => void;
}) {
  const w = useWallet();
  const [receiver, setReceiver] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" } | { kind: "error"; text: string }>({
    kind: "idle",
  });

  async function transfer() {
    const to = receiverId(receiver);
    const problem = receiverProblem(to, holder);
    if (problem) {
      setState({ kind: "error", text: problem });
      return;
    }
    setState({ kind: "working" });
    try {
      const [out] = await w.send([transferTx(config.contractId, leaseId, to)]);
      onMoved(to, out === undefined ? null : txHash(out));
    } catch (e) {
      const text = failureText(e);
      setState({ kind: "error", text: text === NOT_TRANSFERABLE ? NOT_TRANSFERABLE_TEXT : text });
    }
  }

  return (
    <form
      className="lease-form"
      onSubmit={(e) => {
        e.preventDefault();
        void transfer();
      }}
    >
      <fieldset disabled={state.kind === "working"} aria-label={`Transfer Key Pass ${leaseId}`}>
        <legend>Transfer Key Pass</legend>
        <p className="hint">
          This lease is a Key Pass token you hold. Moving it hands every call left to the new holder, and your
          account is refused from then on. It works only if the key owner allowed it when creating the lease.
        </p>
        <label>
          New holder
          <input
            value={receiver}
            placeholder="bob.testnet"
            autoComplete="off"
            onChange={(e) => {
              setReceiver(e.target.value);
            }}
          />
        </label>
        <button type="submit">Transfer Key Pass</button>
      </fieldset>
      <p role="status">{state.kind === "working" ? "Confirm the transfer in your wallet…" : ""}</p>
      {state.kind === "error" && <p role="alert">{state.text}</p>}
    </form>
  );
}
