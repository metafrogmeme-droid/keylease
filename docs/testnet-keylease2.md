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

## Steps 4 to 10 (12 Nov 2026, about 14:10 to 14:20 CET)

Demo key rotated first (see below). All steps ran against keylease2 with `KEYLEASE_CONTRACT_ID` set to it, the
key read from env, base URL `https://keylease.vercel.app/mock`, sealed under profile `k2-main` (the same
account owns the production seal under other profile names, so the profiles do not collide).

| Step                           | Result                                                                  | Tx                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4 Seal demo key (`kl add-key`) | key 0, lock `Predecessor[keylease2...]` AND `WasmHash[95385bd10e77...]` | [69SU5AEN…](https://testnet.nearblocks.io/txns/69SU5AENBywE4KMqFs8M1vvABhpJLomQidYL9CutdBKw)                                                                                                            |
| 5 Lease (3 calls, 1 h)         | lease 0, `/v1/chat/completions` and `/debug/headers`                    | [EkrhCWgg…](https://testnet.nearblocks.io/txns/EkrhCWggyjtHtYLy4pACoJeJHHghvWcdYPLvbZwy4eUq)                                                                                                            |
| 6 Leased call                  | call 1, outcome `ok`, HTTP 200                                          | [91k8D1kR…](https://testnet.nearblocks.io/txns/91k8D1kR6qW537fCXhPErAJBMaF18C7W2V8J7ZbWkpbi)                                                                                                            |
| 7 Endpoint not in lease        | refused `endpoint_not_in_lease`, exit 2                                 | [8fTFSLQK…](https://testnet.nearblocks.io/txns/8fTFSLQKjiWmL78jeU66J4sC1EKBApP2ECCTXdYLQQXP)                                                                                                            |
| 8 Tripwire (`/debug/headers`)  | call 2, outcome `tripwire`, answer withheld, recorded on chain          | [3meaTrre…](https://testnet.nearblocks.io/txns/3meaTrreWvziRrC3SHQKc8cJ9wDRp7aRjvVrnpkq9HZw)                                                                                                            |
| 9 Receipts (view)              | call 1 `ok /v1/chat/completions`, call 2 `tripwire /debug/headers`      | none (view)                                                                                                                                                                                             |
| 10 Revoke, then call           | `revoked`; next call refused `lease_revoked`; status 2 used, 1 left     | [HejHkpHE…](https://testnet.nearblocks.io/txns/HejHkpHEqTPCbby8sEMaPKYHv9ReLDova4JhiP8cda5P), refused call [AEdQuYoW…](https://testnet.nearblocks.io/txns/AEdQuYoWUZn2TfKtEeamRAUuPScP6gkjZoeDW4Qvd1xL) |

Answers and hashes: call 1 input sha256 `83ddeb17414e83fc497ec7b02ce82339f930622cb0dab7e1d52d777e75d5c7ad`,
output `e504aa2ff31ef01376a0deb9044a2d2100800b92b01492a2a53aa14b710e7e7a`; call 2 input
`58ef14fec560d3719d214f3e6249c2c88a442e8d3c40581d9a659c8a6028b8a1`, output
`03189522d36762700a86725adf588745b4c9dd38b639f04aa8ee0b110ad31b4`.

## Demo key rotation (12 Nov 2026)

`MOCK_API_KEY` on the Vercel project `rune-claw/keylease` (production, sensitive) was replaced with a new random
value, and production was redeployed from the same source (`227b4db`, deployment
`dpl_79sC39eBdbWPcajcrYrQY6hmLSrs`, READY). `GET https://keylease.vercel.app/mock/v1/models` with the new key
answers 200.

The Vercel variable is only what the mock checks on incoming calls. The proxy calls the mock with the key
**sealed on the contract**, so the old seals stop working after a rotation. The production contract got the new
key under a new profile `prod-r2` (key id 4, [add-key tx APe99LDX…](https://testnet.nearblocks.io/txns/APe99LDXxuDXadEpSvcWy1UpE7bnyi3yFTL2Vz2aZ7qA)).
A one-call lease 9 on key 4 and one call ([lease tx 2uVro7SC…](https://testnet.nearblocks.io/txns/2uVro7SCHdoKKJt6n1mGvgJpka3BMdFEWAXhG4Mgc7av),
[call tx GBUfLZha…](https://testnet.nearblocks.io/txns/GBUfLZhaB5N47VNrGTuxMpTowc5G1cyWm3abddyxEaYb)) answered `ok` HTTP 200.
**Older production keys (ids 0 to 3) still hold the old key and now get 401 from the mock; use key 4.**
Production code and config were not redeployed.

## Still open: Patrick's MetaMask text signature (0x0acca...4ea8)

Lease 1 on keylease2 (key 0, holder `0x0acca2862903d0415639316574a5286d42854ea8`, 1 call, `GET /v1/models`,
expires 2026-11-13 14:16 CET, create tx [Fkohg5Mm…](https://testnet.nearblocks.io/txns/Fkohg5MmiFYx2dZy5iDuSM3YCM4ZYmDi5YcHoMkhQG2x)).
The contract's `signed_call_message` view returns this text for nonce 1, valid until 2026-11-13 13:00 CET
(`1794571200000`). Sign it as EIP-191 `personal_sign` with the `0x0acca...4ea8` account; then `use_lease_signed` is
sent from the operator account (it pays the 0.025 NEAR deposit):

```text
KeyLease signed call
network: near-testnet
contract: keylease2.keylease-spike-3298edc1.testnet
lease: 1
nonce: 1
valid until (unix ms): 1794571200000
request: GET /v1/models
body sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

Not yet run: `use_lease_signed` for lease 1 (waits for the signature). The hosted web app points at the production
contract, so its "Make a test call" button does not see lease 1.

## Balances after the run (testnet NEAR)

| Account                                      | Now                         |
| -------------------------------------------- | --------------------------- |
| `keylease-spike-3298edc1.testnet` (deployer) | 5.49 (5.56 before this run) |
| `keylease2.keylease-spike-3298edc1.testnet`  | 5.03                        |
| `keylease.keylease-spike-3298edc1.testnet`   | 5.13                        |

Spent in this run about 0.07 NEAR net of refunds (storage and deposits kept by the contracts, plus gas).
