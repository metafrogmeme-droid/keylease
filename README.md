# KeyLease

**Lend the call, never the key.** Wallet-native API key leases on NEAR, with the key sealed in an OutLayer
TEE.

Built at NEAR HACKATHON (Nov 2026). Status: **in development, NEAR testnet only.** Prototype, not audited.

An owner seals an API key once and shares **leases**: N calls, until a time, these endpoints only. Agents
call through KeyLease; one pinned, open-source proxy build in an Intel TDX enclave is the only code that can
open the key. Revoke in one click; the next call is refused. The full plan is in
[docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md).

## Develop

Requires Node ≥ 22.18, pnpm 10, Rust stable.

```sh
pnpm install                     # also enables the git hooks in .githooks
scripts/install-gitleaks.sh      # pinned gitleaks for the pre-commit hook (.tools/bin, git-ignored)
pnpm check                       # eslint, prettier, tsc strict, vitest, copy-lint, env-lint
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Secrets live in `.env` only (git-ignored); `.env.example` lists names. Never commit a key.

## Layout

| Path                      | What                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `crates/keylease-reasons` | refusal codes and hints shared by contract, proxy and clients       |
| `tools/repo-lint`         | copy-lint, env-lint, commit-lint (run in CI and the git hooks)      |
| `scripts/`                | gitleaks install and self-test                                      |
| `docs/`                   | threat model, decisions, open questions, proposals, wording, verify |

## Docs

[Threat model](docs/THREAT_MODEL.md) · [Decisions](docs/DECISIONS.md) ·
[Open questions](docs/OPEN_QUESTIONS.md) · [Proposals](docs/PROPOSALS.md) · [Wording](docs/WORDING.md) ·
[Verify](docs/VERIFY.md)

## Disclosure

> Disclosure: the same author also entered **Claw Guard: Signing Gate for AI Agents**
> (https://github.com/metafrogmeme-droid/claw-guard-near) at NEAR HACKATHON. The two projects are independent:
> no shared code or contracts; Claw Guard gates trading orders, KeyLease leases API calls.

## License

MIT, see [LICENSE](LICENSE).
