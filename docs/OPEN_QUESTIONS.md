# Open questions

Questions for Patrick and facts still to confirm. Each has an owner and the PR it blocks. Answered
questions keep their answer here.

| ID    | Question                                                                                                                                                                                      | Blocks  | Status           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- |
| Q-001 | Can a NEAR testnet contract call `outlayer.testnet` `request_execution` and get the result back by yield/resume? (spike)                                                                      | PR 3, 5 | open (PR 2)      |
| Q-002 | Does a secret with condition `Predecessor[contract] AND WasmHash[proxy]` open only for that pair, when the secret is owned by the key owner and the run is requested by the contract? (spike) | PR 3, 5 | open (PR 2)      |
| Q-003 | If Q-002 is no: accept fallback A (`AllowAll AND WasmHash[proxy]` + contract view `check_call(exec_id)`)?                                                                                     | PR 3    | waiting on Q-002 |
| Q-004 | Re-read https://nearhackathon.com/HACKATHON.md: the build environment could not reach it on 3 Nov (network policy). Patrick to confirm no rule change since the brief, or allow the host.     | PR 15   | open             |
| Q-005 | OutLayer payment key format, so gitleaks gets a dedicated rule                                                                                                                                | PR 14   | open             |
| Q-006 | Rust toolchain range for near-sdk 5.x contract wasm on testnet today                                                                                                                          | PR 3    | open (PR 2)      |
