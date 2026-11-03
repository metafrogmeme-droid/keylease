/** What `@keylease/test-wallet` resolves to in every build except the timing-test build (next.config.ts). */
export function createTestSelector(): never {
  throw new Error("the test wallet is not part of this build");
}
