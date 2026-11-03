# Decisions

## Open decisions for Patrick

Defaults from the brief (§11) apply until Patrick decides. Update the row when he does.

| ID  | Question                                        | Default                                                        | Status                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Name and repo name                              | KeyLease, `metafrogmeme-droid/keylease`, private until 13 Nov  | default                                                                                                                                                                                                                                                                     |
| D2  | Who creates the repo                            | Patrick                                                        | done (repo exists)                                                                                                                                                                                                                                                          |
| D3  | Demo hosting until 25 Nov                       | Vercel static + mock API on a Vercel function                  | **testnet run**: `mock-api` and the proxy wasm behind a Cloudflare quick tunnel (`*.trycloudflare.com`). 3 Nov: the operator box cannot open the tunnel (HTTPS-only egress); open between VERIFY 2b (tunnel on a second machine) and P-004 (Worker); hosted demo still open |
| D4  | `business` track via HTTPS pay-per-call (PR 14) | yes if PR 14 lands                                             | open                                                                                                                                                                                                                                                                        |
| D5  | Sponsored judge key                             | function-call key, ≤ 0.5 testnet NEAR allowance, mock key only | open                                                                                                                                                                                                                                                                        |
| D6  | Mainnet proof (§10)                             | no                                                             | open                                                                                                                                                                                                                                                                        |
| D7  | Reown / WalletConnect projectId                 | Patrick creates it at cloud.reown.com; needed by PR 7          | open                                                                                                                                                                                                                                                                        |
| D8  | NEAR AI Cloud demo key                          | $10 Builders credit, provider-side hard limit                  | open                                                                                                                                                                                                                                                                        |
| D9  | Tools line in README vs no-labels rule (R1)     | one neutral tools line                                         | open                                                                                                                                                                                                                                                                        |
| D10 | Payout NEAR account                             | same as entry 1                                                | open                                                                                                                                                                                                                                                                        |
| D11 | Steal the Key public before judging, prize      | open on hosted demo after PR 12b; no money prize               | open                                                                                                                                                                                                                                                                        |
| D12 | `swarms` track                                  | yes if PR 10b merged                                           | open                                                                                                                                                                                                                                                                        |

## Engineering decision log

Short records of choices made while building. Newest last.

### E-001 (PR 1) One CI job, path-gated steps

Private-repo Actions minutes are limited and billed per job, rounded up per minute. CI is one job on every
PR: secrets scan and copy rules always run; the Node and Rust steps run only when their paths changed (and
always on `main`). pnpm store and cargo builds are cached. Editing a PR's title or body re-runs only the
PR text lint.

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

### E-007 (PR 2) Spike lives in `spike/` with its own workspace

Throwaway code for Q-001/Q-002: excluded from the root cargo workspace so product CI stays lean. Its
TypeScript runner is in the pnpm workspace so its unit tests (envelope, FastFS payload, lock shape) run in
CI. Nothing in `spike/` is imported by product code; PR 3 starts the real contract.

### E-008 (after PR 2) Answers from Patrick, 3 Nov

- Spike runs on Patrick's operator computer; the build session's network stays closed (Q-007, Q-008).
- Contract upgradable on testnet until code freeze, then locked; upgrade = new contract id (Q-009, T19).
- HACKATHON.md re-read 3 Nov 07:25 CET: no rule change, deadline 2026-11-14T23:59Z (Q-004).
- If spike row S6 fails, receipts keep hashes on chain and the body travels off chain (Q-010).

### E-009 (PR 3) Contract core choices

- **Revoke epochs.** `revoke_all(key)` and `revoke_all_owner()` bump a counter; a lease records the
  counters at creation and is refused once they differ. Revoking any number of leases costs one write, so
  the panic button cannot run out of gas.
- **Exact endpoints.** A lease lists exact paths (`/v1/chat/completions`), validated: ASCII
  `A-Za-z0-9-._~/`, no empty, `.` or `..` segment, no query. No prefix matching, so no path tricks.
- **Refusal order.** `lease_not_found`, then `not_lease_holder` (a stranger learns nothing more), then
  `lease_revoked`, `lease_expired`, `endpoint_not_in_lease`, `quota_used`. New code `lease_not_found`.
- **Errors as `<code>: <hint>`.** `use_lease` panics with the shared wording; `check_call` is the free view
  agents and the UI use first.
- **Storage.** Every write is charged exactly to the caller (rest refunded); removals refund.
- **`use_lease` without OutLayer.** PR 3 only checks and uses the call; PR 5 adds `request_execution`.

### E-010 (PR 4) Proxy shape

- **Pure core, thin WASI layer.** All rules are in `wasm/keylease-proxy/src/lib.rs` and tested natively;
  `main.rs` only reads stdin and env and makes the call through `wasi-http-client` (what OutLayer's own
  wasip2 examples use).
- **Shared rules crate.** The contract's input rules moved to `crates/keylease-rules`; the proxy re-checks
  the endpoint and base URL with the same code.
- **Withhold, do not scrub, on the key.** An answer that carries the key in any known form is not
  returned at all (`tripwire`), since a partial scrub could leave another encoding behind. Other bearer-like
  tokens are redacted and flagged (`redacted: true`).
- **Limits.** Body ≤ 64 KB, answer ≤ 256 KB (read in chunks, so a larger one is never held), connect
  timeout 10 s; total run time is OutLayer's `max_execution_seconds` (30 s in our requests).
- **Input v1** `{v, lease_id, provider, base_url, allowed, endpoint, method, body}`, unknown fields refused.
  The contract fills `provider`, `base_url` and `allowed`; PR 5 builds it.

### E-011 (PR 4b) Toolchain pinned, machine paths remapped

CI (rustc 1.99.1) and the build session (1.97.0) built different proxy bytes for the same commit. Now
`rust-toolchain.toml` pins 1.99.1 (closes E-006) and `scripts/build-proxy.sh` remaps `$CARGO_HOME` and the
repo path, so the proxy builds the same sha256 on any x86_64 Linux host. Bumping the toolchain changes the
proxy hash, so it is a deliberate change that owners must re-lock to.

### E-012 (PR 5) Call path

- **Who pays.** The caller attaches ≥ 0.025 NEAR. 0.005 NEAR stays for the receipt's storage; the rest goes
  to OutLayer with `payer_account_id = caller`, so OutLayer refunds unused compute straight to the caller.
- **Call before run, never given back.** The call is used before `request_execution`; a failed or timed-out
  run still counts. Giving calls back on failure would let a caller who can slow the API down make
  unlimited calls.
- **Receipts are hashes and an outcome.** `ok | refused | tripwire | error | failed`, the proxy's code, the
  HTTP status, `sha256` of the exact input and of the JSON returned. Never the body or the key; the body
  goes back only to the caller as the transaction result. Tripwire receipts also emit a `tripwire` event.
- **Proxy pointer.** The contract holds one proxy URL + hash (`set_proxy`, admin only). A new build does not
  open old keys: their owners re-point their lock (T2).
- **Mock OutLayer.** `contracts/mock-outlayer` answers like OutLayer + proxy and records every request;
  `tests/sandbox` runs the whole flow in a near-workspaces sandbox. The sandbox needs a 65535 open-file
  limit, so it runs in CI (the build session is capped at 20000).

### E-013 (PR 5b) cargo-near from the release binary

Building cargo-near from source took over 10 minutes of CI. `scripts/install-cargo-near.sh` downloads the
v0.22.0 release binary (about 2 s), checks it against the release `.sha256` file and the sha256 pinned in CI,
and keeps it in `.tools/` (cached by the script's hash, so a lockfile change does not drop it). Building
from crates.io stays as the fallback.

### E-014 (PR 6a) Shared OutLayer helpers and the mock API

- The spike's OutLayer modules (keystore envelope, lock, FastFS / self-hosted publishing, outcome parsing)
  move with their tests to `packages/outlayer`, used by the spike now and by the CLI, SDK and web app
  next. The spike keeps only its runner.
- `mock-api` is a plain Web `Request -> Response` handler (Vercel, Cloudflare Worker or Node), so D3 does
  not change its code. It answers with canned text and echoes only, behind a bearer key from env.
  `GET /debug/headers` mirrors request headers on purpose: a lease that includes it shows the proxy
  withholding an answer that carries the key, and the on-chain `tripwire` receipt (T1).
- Both test doubles follow their real specs, linked in their sources. `mock-api` follows the OpenAI API
  reference (chat completion and model objects, error object), as NEAR AI Cloud does.
  `contracts/mock-outlayer` takes OutLayer's exact `request_execution` types and refuses what OutLayer
  refuses at commit aaf60a2 (hash and URL shape, profile shape, limits caps, deposit ≥ estimate). Unlike
  OutLayer, it also refuses unknown fields, so a typo in our call fails the sandbox tests.

### E-015 (PR 6b) Testnet CLI and a private init

- `cli/` (`kl`) is the owner's tool for testnet: `deploy`, `add-key`, `lease`, `call`, `receipts`, `status`,
  `revoke`. It refuses non-`.testnet` ids and a non-testnet RPC, reads keys from env only, and prints fixed
  `label  value` lines, so docs/VERIFY.md states the expected output of every step.
- The contract account gets the owner's public key, so the owner can upgrade it until code freeze; then that
  key is removed (README "Upgrade policy").
- `new(admin, …)` is now `#[private]` and `kl deploy` sends the code and `new` in one transaction: nobody can
  initialise a fresh deploy first (T21). A sandbox test shows a stranger's `new` failing.
- The proxy goes to FastFS by default; `--proxy-url` takes a self-hosted copy, checked like OutLayer's worker
  fetches it before anything goes on chain.

### E-016 (PR 7b) Wallets without AppKit or modal-ui

- NEAR wallets (MyNearWallet, Meteor, HOT, Intear) and WalletConnect come from wallet-selector 10.1.4.
  MetaMask uses `@near-wallet-selector/ethereum-wallets` with wagmi's injected connector on NEAR testnet
  (chain 398). Without an AppKit modal that path needs no Reown project id and no third-party script, so
  Reown AppKit is left out; it can come back if the EVM-over-WalletConnect path is wanted.
- WalletConnect is offered only when `NEXT_PUBLIC_REOWN_PROJECT_ID` is set; otherwise the picker shows it
  disabled with "not configured", and its hosts stay out of the CSP.
- The app renders its own picker instead of `@near-wallet-selector/modal-ui`, which bundles React 18 next to
  the app's React 19 and calls an indexer the app does not need. The picker is a plain button list
  (keyboard and screen reader tested).
- wallet-selector gets an explicit network object, so it talks to `rpc.testnet.near.org` only.
- Meteor's SDK needs `near-api-js` 6 as a peer; the web app pins 6.5.1 (the CLI keeps 7).
- Wallet code loads after first paint (dynamic import), so the first screen does not wait for it.
