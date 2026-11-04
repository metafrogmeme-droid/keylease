/**
 * NEAR testnet account ids this app accepts as a key owner (T9, T22). One function for the pubkey relay
 * and the add-key screen, so both refuse the same things.
 *
 * Accepted, lowercase only:
 * - named testnet accounts: `alice.testnet`, `kl.alice.testnet` (NEAR's account id grammar, 2-64 chars);
 * - eth-implicit accounts: `0x` + 40 hex, what MetaMask and other EVM wallets sign in as on NEAR;
 * - NEAR implicit accounts: 64 hex (an ed25519 public key).
 *
 * Refused: mainnet names (`alice.near`), top-level names without `.testnet`, uppercase (NEAR ids are
 * lowercase; OutLayer would derive a different keystore key for `0X…`), and anything else. Implicit ids
 * have no network suffix; they are the same string on every network, and the app only talks to testnet.
 */
const NAMED_TESTNET = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*\.testnet$/u;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/u;
const NEAR_IMPLICIT = /^[0-9a-f]{64}$/u;

export type TestnetAccountKind = "named" | "eth-implicit" | "near-implicit";

/** Which kind of testnet account `id` is, or null when it is not one this app accepts. */
export function testnetAccountKind(id: unknown): TestnetAccountKind | null {
  if (typeof id !== "string") return null;
  if (ETH_IMPLICIT.test(id)) return "eth-implicit";
  if (NEAR_IMPLICIT.test(id)) return "near-implicit";
  if (NAMED_TESTNET.test(id)) return "named";
  return null;
}

export function isTestnetAccount(id: unknown): id is string {
  return testnetAccountKind(id) !== null;
}

export const TESTNET_ACCOUNT_RULE =
  "a NEAR testnet account (name.testnet, 0x + 40 lowercase hex, or 64 lowercase hex)";
