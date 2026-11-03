"use client";
import { config } from "../lib/config.ts";
import { walletOptions } from "../lib/wallets.ts";
import { ConnectWallet } from "./ConnectWallet.tsx";
import { OnboardingStrip } from "./OnboardingStrip.tsx";
import { useWallet } from "./WalletProvider.tsx";

const OPTIONS = walletOptions(config);

export function Onboarding() {
  const { accountId } = useWallet();
  return (
    <>
      <OnboardingStrip progress={{ connected: accountId !== null, hasKey: false, hasLease: false }} />
      <ConnectWallet options={OPTIONS} />
    </>
  );
}
