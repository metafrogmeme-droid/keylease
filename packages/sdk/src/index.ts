/** @keylease/sdk: lend the call, never the key. Testnet only. */
export {
  CALL_DEPOSIT,
  KeyLeaseError,
  callNumber,
  explorer,
  lease,
  leaseFromEnv,
  refusalIn,
  type CallOptions,
  type CallResult,
  type Lease,
  type LeaseOptions,
  type LeaseStatus,
  type Receipt,
} from "./lease.ts";
export { TESTNET_RPC, nearTransport, type NearOptions } from "./near.ts";
export { TxFailed, type Sent, type Transport } from "./transport.ts";
export { PROXY_ERRORS, REFUSALS } from "./wording.ts";
