import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TestnetBanner } from "../components/TestnetBanner.tsx";
import { WalletProvider } from "../components/WalletProvider.tsx";
import { config } from "../lib/config.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: "KeyLease (testnet)",
  description: "Lend the call, never the key: lease API calls to agents and teammates on NEAR testnet.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TestnetBanner contractId={config.contractId} />
        <WalletProvider>
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
