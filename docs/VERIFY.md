# Verify

How anyone can check KeyLease's claims without trusting the authors. Sections marked _planned_ are filled
in by the PR named.

## Repository rules (PR 1)

| Claim                                            | Do                                                                                                                     | See                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| No secrets in any commit                         | `scripts/install-gitleaks.sh && .tools/bin/gitleaks git --config .gitleaks.toml --ignore-gitleaks-allow --redact -v .` | `no leaks found`                          |
| The scan catches planted keys, even deleted ones | `GITLEAKS=.tools/bin/gitleaks scripts/gitleaks-selftest.sh`                                                            | `gitleaks self-test passed`               |
| `.env.example` holds names only                  | `pnpm env-lint`                                                                                                        | `env-lint: .env.example holds names only` |
| Copy rules hold                                  | `pnpm copy-lint`                                                                                                       | `copy-lint: N files clean.`               |
| Lint, types, tests                               | `pnpm check && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`                           | all pass                                  |

## Proxy build hash (PR 4, planned)

Rebuild the proxy wasm reproducibly and compare its sha256 with the one in the README and in the secret
condition.

## Receipts on testnet (PR 6, planned)

From a receipt's transaction link: lease id, call number, input/output hashes, OutLayer execution id.

## Attestation (PR 12, planned)

Paste an execution id into the Verify page: wasm hash, input/output hash, Intel TDX quote check result.
