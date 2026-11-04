"use client";
import { useState } from "react";
import { config } from "../lib/config.ts";
import { AddKey } from "./AddKey.tsx";
import { ConnectWallet } from "./ConnectWallet.tsx";
import { KeyList } from "./KeyList.tsx";
import { LeaseList } from "./LeaseList.tsx";
import { PanicButton } from "./PanicButton.tsx";
import { OnboardingStrip } from "./OnboardingStrip.tsx";
import { useWallet } from "./WalletProvider.tsx";

export function Onboarding() {
  const { accountId } = useWallet();
  const [added, setAdded] = useState(0);
  const [leased, setLeased] = useState(0);
  return (
    <>
      <OnboardingStrip
        progress={{ connected: accountId !== null, hasKey: added > 0, hasLease: leased > 0 }}
      />
      <ConnectWallet reownProjectId={config.reownProjectId} />
      {accountId !== null && (
        <>
          <AddKey
            onAdded={() => {
              setAdded((n) => n + 1);
            }}
          />
          <KeyList
            refresh={added}
            onLeaseCreated={() => {
              setLeased((n) => n + 1);
            }}
          />
          <LeaseList refresh={leased} />
          <PanicButton
            onDone={() => {
              setLeased((n) => n + 1);
            }}
          />
        </>
      )}
    </>
  );
}
