# Proposals

New ideas that are not in scope. Patrick decides; accepted ones move into the brief's milestones.

| ID    | Proposal                                                                                          | Cost         | Why                                                                             | Decision |
| ----- | ------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- | -------- |
| P-001 | Pin GitHub Actions by commit SHA and add Dependabot for actions only                              | 30 min       | Closes the residual in T17                                                      | open     |
| P-002 | Generate the SDK refusal table from `crates/keylease-reasons` at build time                       | 1 h, in PR 9 | One source for codes across Rust and TypeScript                                 | open     |
| P-003 | Embed an `outlayer.manifest` in the proxy wasm with `callers.contract.only = [keylease contract]` | 1 h, in PR 4 | Second, code-side gate before any secret is decrypted; covered by the wasm hash | open     |
