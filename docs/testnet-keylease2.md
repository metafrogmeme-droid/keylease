# Testnet: keylease2 deploy (12 Nov 2026)

NEAR **testnet** only. A second KeyLease contract was deployed next to the production one, with the same
runbook as [VERIFY.md](VERIFY.md) "Testnet, end to end (PR 6)", step 3. No code change was needed: the CLI
takes the contract id from `KEYLEASE_CONTRACT_ID`.

**Production is unchanged.** `keylease.keylease-spike-3298edc1.testnet` was not called, redeployed or
reconfigured, and no config in this repo points at keylease2.

## Run

| Item          | Value                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Date          | 12 Nov 2026, about 13:35 CET                                                                                        |
| Commit built  | `dc71ce1` (main)                                                                                                    |
| Contract      | `keylease2.keylease-spike-3298edc1.testnet`                                                                         |
| Admin         | `keylease-spike-3298edc1.testnet`                                                                                   |
| Contract code | sha256 `1a2eb21ed438bf70f81db3ba83661dbfa1271716265acba89b1e3af52f6e7086` (NEAR code hash `2mCu6Jj…S4rsf`, matches) |
| Proxy sha256  | `95385bd10e778f8f1488a266abaa79c455347f6404f53140b3bde8755a4cd970` (same as production, release `wasm-0e45d5b`)     |
| Proxy URL     | `https://github.com/metafrogmeme-droid/keylease-wasm/releases/download/wasm-0e45d5b/keylease-proxy.wasm`            |
| Command       | `kl deploy --proxy-url "$PROXY_URL"` with the env name `KEYLEASE_CONTRACT_ID` set to the contract above             |

`get_config` on keylease2 returns the admin, `outlayer.testnet`, the proxy URL and the proxy hash above.

## Transactions

| Step                                 | Tx                                                                                              | Status  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------- |
| Create account, fund 5 NEAR, add key | [PqSKyZbf…Hkto](https://testnet.nearblocks.io/txns/PqSKyZbfYvjvUAGDziRgxBVuCngcDt3dpJPXWKEHkto) | SUCCESS |
| Deploy code and `new` (one tx)       | [XifwkzAQ…jC1](https://testnet.nearblocks.io/txns/XifwkzAQ2cbqjRBYRtwDVqgj1e6TyBHef8vEHtyGjC1)  | SUCCESS |

Both were checked with the testnet RPC `tx` method (final execution status `FINAL`, `SuccessValue`).

## Balances (testnet NEAR)

| Account                                      | Before | After                        |
| -------------------------------------------- | ------ | ---------------------------- |
| `keylease-spike-3298edc1.testnet` (deployer) | 10.56  | 5.56                         |
| `keylease2.keylease-spike-3298edc1.testnet`  | none   | 5.00 total (1.84 spendable)  |
| `keylease.keylease-spike-3298edc1.testnet`   | 5.13   | 5.13 (production, untouched) |

The deployer's before value is "available for transfer" at 13:24 CET; spent in total about 5.01 NEAR (5 into
the contract, the rest gas).

## Not run

Steps 4 to 10 need the demo API key (`MOCK_API_KEY`), which is not on the operator box, and a mock host
(`https://keylease.vercel.app/mock`). Per the run rules the run stopped there instead of using another key.

| Step                                   | State                                                                 |
| -------------------------------------- | --------------------------------------------------------------------- |
| 4 Seal demo key (`kl add-key`)         | pending: needs `MOCK_API_KEY`, typed by Patrick                       |
| 5 Lease, 6 call, 7 refused, 8 tripwire | pending: need the sealed key; a call attaches 0.025 NEAR and 300 Tgas |
| 9 Receipts                             | pending: needs the calls above. No OutLayer request id exists yet     |
| 10 Revoke                              | pending                                                               |
| MetaMask text signature (0x0acca…4ea8) | pending: Patrick's wallet                                             |

Once `MOCK_API_KEY` is in env, steps 4 to 10 run as in VERIFY.md with
`KEYLEASE_CONTRACT_ID` set to the keylease2 contract id first. Add the tx hashes and the
OutLayer request id here when they exist.
