# KeyLease

**Lend the call, never the key.** Wallet-native API key leases on NEAR, with the key sealed in an OutLayer
TEE.

Built at NEAR HACKATHON (Nov 2026). Status: **in development, NEAR testnet only.** Prototype, not audited.

An owner seals an API key once and shares **leases**: N calls, until a time, these endpoints only. Agents
call through KeyLease; one pinned, open-source proxy build in an Intel TDX enclave is the only code that can
open the key. Revoke in one click; the next call is refused. The full plan is in
[docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md).

## Upgrade policy

The secret lock trusts one contract account, so that contract is the gate for every lease. On testnet it
stays upgradable until code freeze (13 Nov 2026, 18:00 CET); then all its full-access keys are removed and
it can no longer change. Any later upgrade is deployed to a **new contract id**, and key owners re-point
their lock to it. See [threat model T19](docs/THREAT_MODEL.md).

## Develop

Requires Node ≥ 22.18, pnpm 10, Rust stable.

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
| `contracts/keylease`      | NEAR contract: keys, leases, quotas, expiry, endpoints, revoke                                                                                  |
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
[`metafrogmeme-droid/keylease-wasm`](https://github.com/metafrogmeme-droid/keylease-wasm) (`wasm-<commit>`,
sha256 checked by `kl` and by OutLayer); the demo API (a mock with canned answers) runs on the same Vercel project at `/mock`, with the laptop tunnel as fallback. Steps in docs/VERIFY.md 2 and 2b. The web app is hosted on Vercel (static pages plus one same-origin relay for OutLayer's keystore key, which browsers cannot fetch directly): docs/VERIFY.md "Hosted on Vercel". Testnet NEAR for gas: the
[NEAR testnet faucet](https://docs.near.org/tools/faucet).

## Disclosure

> Disclosure: the same author also entered **Claw Guard: Signing Gate for AI Agents**
> (https://github.com/metafrogmeme-droid/claw-guard-near) at NEAR HACKATHON. The two projects are independent:
> no shared code or contracts; Claw Guard gates trading orders, KeyLease leases API calls.

## License

MIT, see [LICENSE](LICENSE).
