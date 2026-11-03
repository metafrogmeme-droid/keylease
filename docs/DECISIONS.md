# Decisions

## Open decisions for Patrick

Defaults from the brief (§11) apply until Patrick decides. Update the row when he does.

| ID  | Question                                        | Default                                                        | Status             |
| --- | ----------------------------------------------- | -------------------------------------------------------------- | ------------------ |
| D1  | Name and repo name                              | KeyLease, `metafrogmeme-droid/keylease`, private until 13 Nov  | default            |
| D2  | Who creates the repo                            | Patrick                                                        | done (repo exists) |
| D3  | Demo hosting until 25 Nov                       | Vercel static + mock API on a Vercel function                  | open               |
| D4  | `business` track via HTTPS pay-per-call (PR 14) | yes if PR 14 lands                                             | open               |
| D5  | Sponsored judge key                             | function-call key, ≤ 0.5 testnet NEAR allowance, mock key only | open               |
| D6  | Mainnet proof (§10)                             | no                                                             | open               |
| D7  | Reown / WalletConnect projectId                 | Patrick creates it at cloud.reown.com; needed by PR 7          | open               |
| D8  | NEAR AI Cloud demo key                          | $10 Builders credit, provider-side hard limit                  | open               |
| D9  | Tools line in README vs no-labels rule (R1)     | one neutral tools line                                         | open               |
| D10 | Payout NEAR account                             | same as entry 1                                                | open               |
| D11 | Steal the Key public before judging, prize      | open on hosted demo after PR 12b; no money prize               | open               |
| D12 | `swarms` track                                  | yes if PR 10b merged                                           | open               |

## Engineering decision log

Short records of choices made while building. Newest last.

### E-001 (PR 1) One CI job, path-gated steps

Private-repo Actions minutes are limited and billed per job, rounded up per minute. CI is one job on every
PR: secrets scan and copy rules always run; the Node and Rust steps run only when their paths changed (and
always on `main`). pnpm store and cargo builds are cached.

### E-002 (PR 1) gitleaks from the pinned release binary, not the marketplace action

The action scans only the PR's commits on `pull_request`; the rule is the full history. The binary is
version-pinned and checked against the release checksums and a pinned sha256 (`scripts/install-gitleaks.sh`).
`--ignore-gitleaks-allow` stops an inline comment from hiding a key.

### E-003 (PR 1) Repo tools run as TypeScript on Node's type stripping

`tools/repo-lint` runs with `node file.ts` (Node ≥ 22.18), so the pre-commit hook needs no build step and no
extra runtime dependency. `tsc --noEmit` (strict, `erasableSyntaxOnly`) typechecks it; vitest tests it.

### E-004 (PR 1) Refusal codes live in one Rust crate

`crates/keylease-reasons` holds the codes and one-sentence hints. Contract and proxy will depend on it; the
SDK will mirror it with a generated table. A test keeps `docs/WORDING.md` identical.

### E-005 (PR 1) copy-lint patterns are written split

Rule sources use a `·` splitter, so the linter and its tests never match themselves and need no allowlist.
The only whole-file exception is the verbatim brief (it quotes the wording it forbids).

### E-006 (PR 1) Rust toolchain: runner stable for now

The contract toolchain (near-sdk 5.x and `cargo near` need a specific rustc range for wasm) is pinned in
PR 3 with `rust-toolchain.toml`, once the spike confirms the versions.
