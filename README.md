# KeyLease

**Lend the call, never the key.** Wallet-native API key leases on NEAR, with the key sealed in an
OutLayer TEE.

Built at NEAR HACKATHON (Nov 2026). Prototype. Not audited. NEAR **testnet** only.

## What it is

An owner seals an API key once and shares **leases**: N calls, until a time, these endpoints only.
Agents call through KeyLease (SDK, curl, near CLI or MCP). One pinned, open-source proxy build
running in an Intel TDX enclave is the only code that can open the key. Revoke in one click; the
next call is refused. Receipts on chain name hashes and status, never the body or the key.

## Problem

An agent that holds an API key can leak it: a prompt injection, a poisoned tool result, or a
compromised front end. Policies that only check once at deposit time leave every later call
unchecked. KeyLease moves both the key and the call rules out of the agent: the key stays sealed
in OutLayer Secrets, and every call is gated by a NEAR lease before the proxy opens it.

## Try it in 5 minutes

### A. Hosted demo (do X → see Y)

Live site: https://keylease.humanoid-traders.com (testnet; use this domain, not the `*.vercel.app`
mirror). Steps and expected lines from real runs are in [docs/VERIFY.md](docs/VERIFY.md)
("Web app, by hand" and "Hosted on Vercel").

| Do                                                                                                                      | See                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Open https://keylease.humanoid-traders.com                                                                              | TESTNET banner; Connect · Add key · Share                                        |
| Connect Meteor, HOT, Intear or MetaMask                                                                                 | `Connected as <account>`                                                         |
| Add key → OpenAI-compatible, base URL `https://keylease.humanoid-traders.com/mock/v1`, paste a low-value demo key, Seal | Field clears at once; `✓ Key added.` with two tx links                           |
| Your keys → Test key                                                                                                    | `✓ The key works: the API answered HTTP 200 through the proxy.` and a receipt tx |
| Share → preset `Demo, 1 hour, 10 calls`                                                                                 | Share box `Lease <n> for <grantee>` with link/QR; no snippet holds the key       |
| Open the lease link                                                                                                     | `Lease <n>`, status `active`, `0 used, 10 left of 10`                            |
| Revoke on that row                                                                                                      | `✓ Revoked. The next call is refused with lease_revoked.`                        |

Full click-path (Key Pass, sub-leases, EVM grantee, panic button): [docs/VERIFY.md](docs/VERIFY.md).
Real-wallet MetaMask mobile run 2026-11-04 (lease 8, HTTP 200): same doc.

Quick no-wallet checks against the live host:

```sh
curl -sI https://keylease.humanoid-traders.com/ | grep -iE 'content-security-policy|x-frame-options'
# content-security-policy: frame-ancestors 'none'   x-frame-options: DENY

curl -sI https://keylease.humanoid-traders.com/mock/v1/models | grep -i x-keylease-demo
# x-keylease-demo: mock API: canned answers, low-value demo key, no real provider
```

### B. Local checks (no testnet account)

Requires Node ≥ 22.18, pnpm 10, Rust 1.99.1 (see [rust-toolchain.toml](rust-toolchain.toml)).

```sh
pnpm install
scripts/install-gitleaks.sh
pnpm check                       # eslint, prettier, tsc, vitest, copy-lint, env-lint
cargo fmt --check && cargo clippy --all-targets -- -D warnings
scripts/install-cargo-near.sh && scripts/build-contracts.sh && cargo test
```

Expect: `pnpm check` and the cargo steps exit 0; gitleaks self-test
(`GITLEAKS=.tools/bin/gitleaks scripts/gitleaks-selftest.sh`) prints `gitleaks self-test passed`.

End-to-end on NEAR testnet with the `kl` CLI (deploy, seal, lease, call, revoke): follow
[docs/VERIFY.md](docs/VERIFY.md) sections 0–8. Prompt-injection attack run (8/8 as expected on
2026-11-03): [docs/ATTACK_LOG.md](docs/ATTACK_LOG.md).

## How NEAR is used (built in the window)

| NEAR feature                            | Where                                           | What it does here                                                                                           |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rust smart contract (`near-sdk` 5.30.0) | [contracts/keylease](contracts/keylease)        | Keys, leases, quotas, endpoints, expiry, revoke epochs, receipts, NEP-297 events                            |
| Yield / resume to OutLayer              | `use_lease` → `request_execution` → `on_result` | Contract asks OutLayer to run the pinned proxy wasm; call quota is used before the run                      |
| NEP-171 Key Pass                        | [nft.rs](contracts/keylease/src/nft.rs)         | A transferable lease is an NFT; `nft_transfer` re-points the holder                                         |
| Sub-leases                              | [sub.rs](contracts/keylease/src/sub.rs)         | Holder hands on a shrink-only slice; revoke of a parent refuses the subtree                                 |
| Function-call access keys               | agent / sponsor accounts                        | Gas-only callers for demo leases; owner methods need full access                                            |
| Wallet Selector + ethereum-wallets      | [apps/web](apps/web)                            | Meteor, HOT, Intear, MyNearWallet, MetaMask; WalletConnect when configured                                  |
| `env::ecrecover` / `ed25519_verify`     | signed `use_lease`                              | EVM (EIP-191) and Solana holders sign the call; contract recovers the holder, never takes it as an argument |
| near-workspaces sandbox                 | [tests/sandbox](tests/sandbox)                  | Integration tests against a local NEAR sandbox                                                              |

Status: deployed and run on NEAR testnet (contract `keylease.keylease-spike-3298edc1.testnet`);
hosted demo at https://keylease.humanoid-traders.com. Proxy wasm published on
[`metafrogmeme-droid/keylease-wasm`](https://github.com/metafrogmeme-droid/keylease-wasm) (release
`wasm-0e45d5b`, sha256 `95385bd1…4cd970`). No mainnet deploy.

## Threat model and limits (short)

Trust assumptions: OutLayer and Intel TDX attestation run only the pinned wasm and keep its env
private; NEAR consensus holds lease state; the owner's browser is trusted at the moment a key is
pasted. KeyLease is a hackathon prototype, not audited.

Limits that stay: TEE / OutLayer trust; provider ToS on key sharing (demo uses `mock-api` only);
one in-flight call can still finish after revoke or a Key Pass transfer; a failed OutLayer run still
uses one call. Full table: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Upgrade policy

The secret lock trusts one contract account, so that contract is the gate for every lease. On
testnet it stays upgradable until code freeze (13 Nov 2026, 18:00 CET); then all its full-access
keys are removed and it can no longer change. Any later upgrade is deployed to a **new contract
id**, and key owners re-point their lock to it. See [threat model T19](docs/THREAT_MODEL.md).

## Develop

```sh
pnpm install                     # also enables the git hooks in .githooks
scripts/install-gitleaks.sh      # pinned gitleaks for the pre-commit hook (.tools/bin, git-ignored)
scripts/install-cargo-near.sh    # pinned cargo-near for the contract builds (.tools/bin)
pnpm check                       # eslint, prettier, tsc strict, vitest, copy-lint, env-lint
cargo fmt --check && cargo clippy --all-targets -- -D warnings
scripts/build-contracts.sh && cargo test # sandbox tests need cargo-near and `ulimit -n 65535`
pnpm --filter @keylease/web dev          # web app on localhost:3000 (testnet only)
pnpm --filter @keylease/web build && pnpm --filter @keylease/web e2e   # static export + CSP, Playwright smoke
pnpm --filter @keylease/web build:e2e && pnpm --filter @keylease/web e2e:timing   # time to first lease ≤ 60 s
```

Secrets live in `.env` only (git-ignored); `.env.example` lists names. Never commit a key.

## Layout

| Path                      | What                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/keylease`      | NEAR contract: keys, leases, quotas, expiry, endpoints, revoke; Key Pass (NEP-171)                                                              |
| `contracts/mock-outlayer` | test double for OutLayer, sandbox tests only                                                                                                    |
| `tests/sandbox`           | end-to-end tests in a local NEAR sandbox                                                                                                        |
| `wasm/keylease-proxy`     | proxy run in the OutLayer TEE: opens the key, calls one endpoint, withholds the key                                                             |
| `apps/web`                | web app (Next.js static export): TESTNET banner, onboarding, wallets, Add key, Test key, presets, Share, leases, revoke, receipts, panic button |
| `cli`                     | `kl`: owner-run testnet CLI (deploy, add key, lease, call, receipts, revoke); see docs/VERIFY.md                                                |
| `packages/sdk`            | `@keylease/sdk`: `lease({ contract, leaseId }).call(endpoint, body)`, testnet only                                                              |
| `packages/mcp`            | `@keylease/mcp`: MCP server with `keylease_call` and `keylease_status` for agents                                                               |
| `examples`                | a small agent, and the prompt-injection attack run that writes docs/ATTACK_LOG.md                                                               |
| `packages/outlayer`       | OutLayer helpers: keystore envelope, secret lock, wasm publishing, run outcomes                                                                 |
| `mock-api`                | low-value demo API (OpenAI-shaped chat, echo, a header mirror that trips the tripwire)                                                          |
| `crates/keylease-reasons` | refusal codes and hints shared by contract, proxy and clients                                                                                   |
| `crates/keylease-rules`   | input rules shared by contract and proxy                                                                                                        |
| `tools/repo-lint`         | copy-lint, env-lint, commit-lint (run in CI and the git hooks)                                                                                  |
| `scripts/`                | gitleaks install and self-test, reproducible proxy build                                                                                        |
| `docs/`                   | threat model, decisions, open questions, proposals, wording, verify                                                                             |

## Docs

[Threat model](docs/THREAT_MODEL.md) · [Decisions](docs/DECISIONS.md) ·
[Open questions](docs/OPEN_QUESTIONS.md) · [Proposals](docs/PROPOSALS.md) · [Wording](docs/WORDING.md) ·
[Verify](docs/VERIFY.md) · [Attack log](docs/ATTACK_LOG.md)

Testnet run hosting: the proxy wasm is a release asset of the public repo
[`metafrogmeme-droid/keylease-wasm`](https://github.com/metafrogmeme-droid/keylease-wasm)
(`wasm-<commit>`, sha256 checked by `kl` and by OutLayer); the demo API (a mock with canned
answers) runs on the same Vercel project at `/mock`, with the laptop tunnel as fallback. Steps in
docs/VERIFY.md 2 and 2b. The web app is live at https://keylease.humanoid-traders.com (testnet;
mirror keylease.vercel.app, which MetaMask's scanner flags, so use the custom domain) and is
hosted on Vercel (static pages plus one same-origin relay for OutLayer's keystore key, which
browsers cannot fetch directly): docs/VERIFY.md "Hosted on Vercel". Testnet NEAR for gas: the
[NEAR testnet faucet](https://docs.near.org/tools/faucet).

## Baseline vs built in the window

Hackathon window starts 2026-11-01. Baseline: the repository's initial commit `6f95ee7`
(2026-11-02; empty scaffold). Everything else — contracts, proxy, web, SDK, MCP, CLI, mock API,
docs, CI — was built after 1 Nov 2026. No pre-hackathon product code.

## How it was built

Built with AI coding assistants (code, tests and docs), reviewed and approved by the owner;
libraries and versions are listed below.

Libraries and tools actually used (exact versions are pinned in `Cargo.lock` and `pnpm-lock.yaml`):

- Rust (contracts): `near-sdk` 5.30.0, `serde_json` 1.0.154.
- Rust (sandbox tests): `near-workspaces` 0.24.0, `tokio` 1.54.1, `anyhow` 1.0.104.
- Rust (proxy): `wasi-http-client` 0.2.1; toolchain Rust **1.99.1** with `wasm32-wasip2` /
  `wasm32-unknown-unknown` ([rust-toolchain.toml](rust-toolchain.toml)); `cargo-near` for contract
  builds.
- TypeScript (web): Next.js 16.4.4, React 19.3.1, `@near-wallet-selector/*` 10.1.4 (core, meteor,
  hot, intear, my-near-wallet, wallet-connect, ethereum-wallets), `near-api-js` 6.5.1, `viem`
  2.57.16, `@wagmi/core` 2.22.1, `qrcode-generator` 2.0.4.
- TypeScript (SDK / CLI / OutLayer): `near-api-js` 7.4.0, `@noble/curves` 2.4.0, `@noble/hashes`
  2.4.0, `@noble/ciphers` 2.4.0, `@scure/base` 2.2.0.
- MCP: `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.
- Dev: pnpm 10.28.0, TypeScript 5.9.3, eslint 10, prettier 3, vitest 4, Playwright (web e2e),
  `gitleaks` 8.30.1 with [.gitleaks.toml](.gitleaks.toml).
- External services (testnet): OutLayer (`outlayer.testnet` / `testnet-api.outlayer.ai`), NEAR
  testnet RPC, Vercel Hobby hosting.
- Not used as a dependency: Shade Agents, NEAR Intents, mainnet deploy path.

## Disclosure

> Disclosure: the same author also entered **Claw Guard: Signing Gate for AI Agents**
> (https://github.com/metafrogmeme-droid/claw-guard-near) at NEAR HACKATHON. The two projects are independent:
> no shared code or contracts; Claw Guard gates trading orders, KeyLease leases API calls.

## License

MIT, see [LICENSE](LICENSE).
