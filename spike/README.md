# Day-1 spike (PR 2)

Throwaway experiment for docs/OPEN_QUESTIONS.md Q-001 and Q-002. Not product code: own cargo workspace,
excluded from the root workspace. Testnet only.

**Question.** Can a NEAR contract ask `outlayer.testnet` to run a pinned wasm with a secret owned by
another account, and does a secret locked with `Predecessor[contract] AND WasmHash[proxy]` open for that
pair only?

## Pieces

| Path               | What                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello-proxy/`     | wasm32-wasip2 guest. Prints whether `SPIKE_SECRET` arrived and the first 8 hex of its sha256, never the value. `--features variant-b` gives different bytes for the wrong-build row.                                                               |
| `caller-contract/` | near-sdk 5 contract. `run()` forwards to `request_execution` with a `WasmUrl` source and the owner's `secrets_ref`; `on_result()` receives OutLayer's answer through yield/resume. Anyone may call `run`, the way any agent will sign `use_lease`. |
| `runner/`          | TypeScript runner: publishes both builds on FastFS, seals a random canary (ECIES in the runner, to the keystore key), stores two rows, runs the rows below, writes `results/<time>.json`, then deletes the rows and sub-accounts.                  |
| `build.sh`         | builds `artifacts/` and fails if the proxy hash changes between two builds.                                                                                                                                                                        |

## Rows

Accounts: owner = `$NEAR_ACCOUNT_ID`; `klspike.<owner>` (the contract the lock names); `kldecoy.<owner>`
(same contract code, other account); `klagent.<owner>` (an agent that signs).

Row A: accessor `WasmHash[A]`, lock `Predecessor[Whitelist[klspike]] AND WasmHash[A]`.
Row B: accessor `WasmHash[B]`, same lock (it names build A on purpose).

| Row | Call                                                 | Expect                                                       |
| --- | ---------------------------------------------------- | ------------------------------------------------------------ |
| S1  | agent → klspike.run → OutLayer, build A              | opens                                                        |
| S2  | agent → kldecoy.run → OutLayer, build A              | refused                                                      |
| S3  | owner → OutLayer `request_execution` directly, row A | refused                                                      |
| S4  | agent → klspike.run, build B (row B)                 | refused                                                      |
| S5  | owner → klspike.run, build A                         | opens (the signer does not matter; the contract is the gate) |
| S6  | agent → klspike.run, build A, 8000-byte answer       | opens with the full answer                                   |

A row counts as **refused** only when OutLayer accepted the request and its `execution_completed` event
reports `success: false`; a panic before OutLayer or a missing event is **error**, never a pass. Every
refusal's `error_message` is recorded for review.

## Run (owner's machine or an allowed session)

```sh
rustup target add wasm32-wasip2 && cargo install cargo-near --locked   # once
spike/build.sh
node spike/runner/src/run.ts             # dry run: prints the plan, sends nothing
set -a; . ./.env; set +a                 # NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY (testnet), optional NEAR_RPC_URL
node spike/runner/src/run.ts --apply     # about 7.5 NEAR moved to sub-accounts, nearly all returned at cleanup
```

Hosts it needs: `rpc.testnet.near.org` (or `NEAR_RPC_URL`), `testnet-api.outlayer.ai`, `test.fastfs.io`.

The canary is random per run, lives only in memory, and is checked never to appear in any output, log or
result file. Sub-account keys are generated in memory and the accounts are deleted at the end
(`--keep` skips cleanup).
