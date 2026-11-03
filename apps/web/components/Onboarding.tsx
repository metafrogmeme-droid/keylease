"use client";
import { useState } from "react";
import { config } from "../lib/config.ts";
import { walletOptions } from "../lib/wallets.ts";
import { AddKey } from "./AddKey.tsx";
import { ConnectWallet } from "./ConnectWallet.tsx";
import { OnboardingStrip } from "./OnboardingStrip.tsx";
import { useWallet } from "./WalletProvider.tsx";

const OPTIONS = walletOptions(config);

export function Onboarding() {
  const { accountId } = useWallet();
  const [hasKey, setHasKey] = useState(false);
  return (
    <>
      <OnboardingStrip progress={{ connected: accountId !== null, hasKey, hasLease: false }} />
      <ConnectWallet options={OPTIONS} />
      {accountId !== null && (
        <AddKey
          onAdded={() => {
            setHasKey(true);
          }}
        />
      )}
    </>
  );
}
