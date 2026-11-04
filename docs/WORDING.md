# Wording

One vocabulary across contract, proxy, SDK, MCP server, web app and docs. copy-lint
(`pnpm copy-lint`, CI, pre-commit hook) enforces the forbidden parts.

## Vocabulary

- **key**: an API key the owner sealed once. Only the pinned proxy build can open it.
- **lease**: the right to make calls with a key: grantee, call quota, endpoints, expiry, optional price per call.
- **call quota**: calls left on a lease. Each call uses one before the enclave run starts.
- **endpoints**: the paths a lease may call on the key's base URL.
- **expiry**: the time after which the lease refuses calls.
- **revoke**: owner ends a lease; the next call is refused.
- **receipt**: on-chain record of one call: hashes, status, attestation reference. Never the body or the key.
- **sub-lease**: a slice of a lease handed on by its holder; limits only shrink.
- **Key Pass**: a lease held as an NEP-171 token; whoever holds the token holds the lease.

Say "refused" for a call that did not run, with a code from the table below. Say "sealed" for a key stored
in OutLayer Secrets.

## Refusal codes

Shown to agents and humans exactly as below. Source of truth: `crates/keylease-reasons`; a Rust test
fails if this table and the code differ.

| Code                    | What to do                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `lease_expired`         | This lease has expired; ask the key owner for a new lease.                                     |
| `quota_used`            | All calls in this lease are used; ask the key owner for more calls.                            |
| `endpoint_not_in_lease` | This endpoint is not in the lease; call one of the listed endpoints or ask for a wider lease.  |
| `lease_revoked`         | The key owner revoked this lease; ask them for a new one.                                      |
| `not_lease_holder`      | Your account does not hold this lease; use the wallet or agent the lease was shared with.      |
| `tripwire`              | The call looked like an attempt to read the key, so it was stopped and recorded on chain.      |
| `parent_revoked`        | A lease above this one was revoked; ask the agent that shared it with you for a new lease.     |
| `parent_quota_used`     | A lease above this one has no calls left; ask the agent that shared it with you.               |
| `lease_not_found`       | No lease has this id; check the lease id you were given.                                       |
| `bad_signature`         | The signature does not match this call; sign the exact request again with the holder's wallet. |
| `nonce_used`            | This signed call was already used; sign it again with a higher nonce.                          |
| `signature_expired`     | This signed call is past its valid-until time; sign it again.                                  |

## Proxy errors

Besides the refusal codes above, the proxy can answer with these codes (`wasm/keylease-proxy`):

- **bad_input**: the contract and proxy builds disagree on the input; nothing was called.
- **body_too_large**: the request body is over 64 KB; send a smaller request.
- **key_unavailable**: the sealed key could not be opened for this run; the key owner should check its lock.
- **upstream_error**: the API could not be reached or did not answer in time; try again later.
- **response_too_large**: the API answer is over 256 KB; ask for a smaller answer.

## Forbidden (copy-lint rules)

| Rule            | What it catches                                                                                            | Why                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| banned-word     | "safe" and "scam" and their forms (safely, scammer, ...) <!-- copy-lint-allow: banned-word -->             | Claims we cannot prove; name the concrete mitigation or threat instead. |
| ai-label        | tool attribution labels, tool co-author trailers, tool session links                                       | Project rule 6.                                                         |
| verdict-wording | "allowed/blocked by your rule/policy" style verdicts <!-- copy-lint-allow: verdict-wording -->             | Independence from the author's other entry; use refusal codes.          |
| promo           | token tickers of the author's other projects, price targets or predictions <!-- copy-lint-allow: promo --> | No token or price picks.                                                |

The name of the author's other entry is allowed (the README disclosure line needs it); its wording is not.

To allow one rule on one line, add `copy-lint-allow: <rule>` on that line with the reason nearby. Whole-file
exceptions live in `tools/repo-lint/allow.json`, each with a reason; today only the verbatim brief.
