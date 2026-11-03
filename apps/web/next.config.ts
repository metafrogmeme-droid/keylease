import type { NextConfig } from "next";
import "./lib/config.ts";

/** The test-only wallet is compiled in only for the timing-test build (lib/test-wallet.ts). */
const testWallet =
  process.env["NEXT_PUBLIC_KL_E2E"] === "1" ? "./lib/test-wallet.ts" : "./lib/no-test-wallet.ts";

const nextConfig: NextConfig = {
  turbopack: { resolveAlias: { "@keylease/test-wallet": testWallet } },
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
