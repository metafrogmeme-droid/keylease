import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same as a release build (next.config.ts): the test wallet is not part of it.
  resolve: {
    alias: { "@keylease/test-wallet": new URL("./lib/no-test-wallet.ts", import.meta.url).pathname },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    // lib/config.ts has no contract-id fallback any more; tests run against a fixed testnet id.
    env: { NEXT_PUBLIC_KEYLEASE_CONTRACT_ID: "keylease.testnet" },
  },
});
