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

## Proxy build hash (PR 4)

| Claim                                                               | Do                                                                                                                                                                                                                          | See                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| The proxy build is reproducible                                     | `scripts/build-proxy.sh`                                                                                                                                                                                                    | two clean builds, one `sha256 …` line |
| The proxy refuses an endpoint outside the lease without calling out | `echo '{"v":1,"lease_id":"1","provider":"Custom","base_url":"https://api.example","allowed":["/a"],"endpoint":"/b","method":"GET"}' \| KL_API_KEY=x wasmtime run -S http --env KL_API_KEY target/proxy/keylease-proxy.wasm` | `"error":"endpoint_not_in_lease"`     |

Across machines, the hash that key locks name is the one from OutLayer's pinned compiler image
(`scripts/build_github_wasm.sh --dir wasm/keylease-proxy --target wasm32-wasip2 --twice` in the OutLayer
repo). It is published in the README from PR 6.

## Receipts on testnet (PR 6, planned)

From a receipt's transaction link: lease id, call number, input/output hashes, OutLayer execution id.

## Attestation (PR 12, planned)

Paste an execution id into the Verify page: wasm hash, input/output hash, Intel TDX quote check result.
