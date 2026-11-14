import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandHeader } from "../components/BrandHeader.tsx";
import { TestnetBanner } from "../components/TestnetBanner.tsx";
import { WalletProvider } from "../components/WalletProvider.tsx";
import { config } from "../lib/config.ts";
import "./rc-tokens.css";
import "./rc-theme.css";
import "./rc-base.css";
import "./globals.css";
import "./ethereum-wallets.css";

export const metadata: Metadata = {
  title: "KeyLease (testnet)",
  description: "Lend the call, never the key: lease API calls to agents and teammates on NEAR testnet.",
  referrer: "no-referrer",
  icons: { icon: "/runeclaw/runeclaw-mark-64.png" },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TestnetBanner contractId={config.contractId} />
        <WalletProvider>
          <main>
            <BrandHeader />
            {children}
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
