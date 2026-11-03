/**
 * Refusal codes and proxy errors, worded as in docs/WORDING.md (a test checks this file against it).
 * The contract's own hint text wins when the chain returns one.
 */
export const REFUSALS: Record<string, string> = {
  lease_expired: "This lease has expired; ask the key owner for a new lease.",
  quota_used: "All calls in this lease are used; ask the key owner for more calls.",
  endpoint_not_in_lease:
    "This endpoint is not in the lease; call one of the listed endpoints or ask for a wider lease.",
  lease_revoked: "The key owner revoked this lease; ask them for a new one.",
  not_lease_holder:
    "Your account does not hold this lease; use the wallet or agent the lease was shared with.",
  tripwire: "The call looked like an attempt to read the key, so it was stopped and recorded on chain.",
  parent_revoked:
    "A lease above this one was revoked; ask the agent that shared it with you for a new lease.",
  parent_quota_used: "A lease above this one has no calls left; ask the agent that shared it with you.",
  lease_not_found: "No lease has this id; check the lease id you were given.",
};

export const PROXY_ERRORS: Record<string, string> = {
  bad_input: "the contract and proxy builds disagree on the input; nothing was called.",
  body_too_large: "the request body is over 64 KB; send a smaller request.",
  key_unavailable: "the sealed key could not be opened for this run; the key owner should check its lock.",
  upstream_error: "the API could not be reached or did not answer in time; try again later.",
  response_too_large: "the API answer is over 256 KB; ask for a smaller answer.",
};

/** `<code>: <hint>` from a contract panic inside a wallet or RPC error text (same pattern as `kl`). */
export function refusalIn(text: string): { code: string; hint: string } | null {
  const m = /panicked: ([a-z_]+): ([^"\\]+)/u.exec(text);
  const code = m?.[1];
  if (code === undefined || !(code in REFUSALS)) return null;
  return { code, hint: (m?.[2] ?? "").trim() };
}
