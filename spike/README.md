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

## Run on the operator computer

Testnet only. The key stays in the operator's environment; never paste it into git, chat or a screenshot.
Needs Node ≥ 22.18, pnpm 10, Rust stable, and network access to `rpc.testnet.near.org`,
`testnet-api.outlayer.ai` and `test.fastfs.io`.

```sh
# 0. once: tools
rustup target add wasm32-wasip2
cargo install cargo-near --locked --no-default-features   # --no-default-features skips the USB/Ledger deps

# 1. code
git clone https://github.com/metafrogmeme-droid/keylease && cd keylease   # or: git pull on main
pnpm install

# 2. build (fails if the proxy hash differs between two builds)
spike/build.sh

# 3. account: a fresh .testnet account funded with ~10 NEAR from the faucet, key in env only
export NEAR_ACCOUNT_ID=<fresh>.testnet
read -rs NEAR_PRIVATE_KEY && export NEAR_PRIVATE_KEY      # paste ed25519:... ; not echoed, not in history

# 4. dry run: prints accounts, hashes, lock JSON and rows S1-S6; sends nothing
node spike/runner/src/run.ts

# 5. live run: ~7.2 NEAR moves to 3 sub-accounts and comes back at cleanup (also on failure)
node spike/runner/src/run.ts --apply

# 6. send back the printed PASS/FAIL lines and the file spike/results/<time>.json
unset NEAR_PRIVATE_KEY
```

The runner refuses a non-`.testnet` account, a non-testnet RPC and leftover sub-accounts from an earlier
run. The canary is random per run, lives only in memory, and the runner aborts if it ever appears in an
output; the result file holds hashes, tx links, OutLayer's refusal messages and logs, no key and no canary.
Sub-account keys exist only in memory; `--keep` skips cleanup (then the sub-accounts stay unreachable).
