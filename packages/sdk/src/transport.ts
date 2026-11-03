/** How the SDK reaches NEAR. The default signs with near-api-js; tests and custom signers inject their own. */
export interface Sent {
  /** Transaction hash. */
  readonly hash: string;
  /** Decoded return value (JSON), or null when the call returned nothing. */
  readonly value: unknown;
  readonly logs: readonly string[];
}

/** A failed transaction; `text` is the chain's failure JSON (it holds the contract's panic message). */
export class TxFailed extends Error {
  readonly hash: string;
  readonly text: string;
  constructor(hash: string, text: string) {
    super(`transaction ${hash} failed`);
    this.hash = hash;
    this.text = text;
  }
}

export interface Transport {
  /** The signing account. */
  readonly account: string;
  view<T>(contract: string, method: string, args: object): Promise<T>;
  /** Sign, send, wait for the final outcome. Throws TxFailed when the transaction fails. */
  call(contract: string, method: string, args: object, deposit: bigint, tgas: number): Promise<Sent>;
}
