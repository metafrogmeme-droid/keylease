/** @keylease/sdk: lend the call, never the key. Testnet only. */
export {
  CALL_DEPOSIT,
  KeyLeaseError,
  MAX_SUB_LEASE_DEPTH,
  SIGNATURE_TTL_MS,
  SUB_LEASE_DEPOSIT,
  callNumber,
  explorer,
  lease,
  leaseFromEnv,
  panicIn,
  refusalIn,
  type CallOptions,
  type CallResult,
  type KeyPass,
  type Lease,
  type LeaseOptions,
  type LeaseStatus,
  type Receipt,
  type SubLease,
  type SubLeaseOptions,
  type TxReceipt,
} from "./lease.ts";
export {
  evmKeySigner,
  solanaKeySigner,
  type EvmSigner,
  type HolderSigner,
  type SolanaSigner,
} from "./signer.ts";
export { TESTNET_RPC, nearTransport, type NearOptions } from "./near.ts";
export { TxFailed, type Sent, type Transport } from "./transport.ts";
export { PROXY_ERRORS, REFUSALS } from "./wording.ts";
