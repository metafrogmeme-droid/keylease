"use client";
import { useState } from "react";
import { config } from "../lib/config.ts";
import { walletOptions } from "../lib/wallets.ts";
import { AddKey } from "./AddKey.tsx";
import { ConnectWallet } from "./ConnectWallet.tsx";
import { KeyList } from "./KeyList.tsx";
import { OnboardingStrip } from "./OnboardingStrip.tsx";
import { useWallet } from "./WalletProvider.tsx";

const OPTIONS = walletOptions(config);

export function Onboarding() {
  const { accountId } = useWallet();
  const [added, setAdded] = useState(0);
  return (
    <>
      <OnboardingStrip progress={{ connected: accountId !== null, hasKey: added > 0, hasLease: false }} />
      <ConnectWallet options={OPTIONS} />
      {accountId !== null && (
        <>
          <AddKey
            onAdded={() => {
              setAdded((n) => n + 1);
            }}
          />
          <KeyList refresh={added} />
        </>
      )}
    </>
  );
}
