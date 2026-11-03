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

| Claim                                                               | Do                                                                                                                                                                                                                          | See                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The proxy build is reproducible                                     | `scripts/build-proxy.sh` (pinned rustc 1.99.1, paths remapped)                                                                                                                                                              | two clean builds, one `sha256 …` line, the same on CI and any x86_64 Linux host |
| The proxy refuses an endpoint outside the lease without calling out | `echo '{"v":1,"lease_id":"1","provider":"Custom","base_url":"https://api.example","allowed":["/a"],"endpoint":"/b","method":"GET"}' \| KL_API_KEY=x wasmtime run -S http --env KL_API_KEY target/proxy/keylease-proxy.wasm` | `"error":"endpoint_not_in_lease"`                                               |

With a `WasmUrl` source OutLayer runs exactly the bytes we publish (it refuses bytes whose sha256 differs
from the source's hash), so a key's lock names the sha256 that `scripts/build-proxy.sh` prints. The
toolchain is pinned and paths are remapped, so anyone gets the same bytes from the same commit; CI prints it
in the step "proxy wasm builds reproducibly". The deployed contract shows the hash it uses:
`kl status` / the `get_config` view (step 3 below).

## Testnet, end to end (PR 6)

Run on the operator computer, NEAR **testnet** only, from a checkout of `main`. Every key stays in env:
never paste it into git, chat or a screenshot. Lines in `<angle brackets>` vary per run; everything else
is printed exactly as shown. `kl` exits 0 when done, 2 when a lease rule refuses, 1 on an error.

**0. Tools and build** (once)

```sh
pnpm install
scripts/install-cargo-near.sh          # cargo-near-near 0.22.0
scripts/build-contracts.sh             # <sha256>  …/keylease_contract.wasm (and mock_outlayer.wasm)
scripts/build-proxy.sh
alias kl="node cli/src/main.ts"
```

Expect from `build-proxy.sh` (same as CI for the same commit):

```text
rustc 1.99.1
keylease-proxy.wasm <bytes> bytes
sha256 <proxy sha256>
```

**1. Account** (a fresh `.testnet` account with ~10 NEAR from the faucet)

```sh
export NEAR_ACCOUNT_ID=<you>.testnet
read -rs NEAR_PRIVATE_KEY && export NEAR_PRIVATE_KEY     # ed25519:…, not echoed
```

**2. Demo API and proxy file.** One small server serves both: the mock API (key required) and, with
`WASM_DIR`, the proxy wasm at `/wasm/keylease-proxy.wasm` (public, as OutLayer fetches it without logging in).
A Cloudflare quick tunnel gives it a public https name.

> **Host requirement.** `cloudflared` reaches Cloudflare's edge on port **7844** (QUIC over UDP, or `--protocol
http2` over TCP); it cannot run through an HTTPS-only proxy. A machine whose egress is HTTPS/443 through a
> proxy cannot host the tunnel (seen 3 Nov: `failed to dial to edge with quic: timeout`, then `TLS handshake
with edge error: EOF`; ssh-based tunnels fail there too). Check first:
> `cloudflared tunnel --url http://localhost:8787` must print a `trycloudflare.com` URL within ~10 s.
> If it cannot, use **2b** below; the other steps run unchanged on this machine.

```sh
read -rs MOCK_API_KEY && export MOCK_API_KEY
MOCK_API_KEY=$MOCK_API_KEY WASM_DIR=target/proxy PORT=8787 node mock-api/src/serve.ts &
cloudflared tunnel --url http://localhost:8787        # prints https://<name>.trycloudflare.com
curl -s -H "authorization: Bearer $MOCK_API_KEY" https://<name>.trycloudflare.com/v1/models
curl -s https://<name>.trycloudflare.com/wasm/keylease-proxy.wasm | sha256sum   # = build-proxy.sh sha256
```

In the steps below, `<mock host>` is `<name>.trycloudflare.com`; while FastFS is down, deploy with
`--proxy-url https://<name>.trycloudflare.com/wasm/keylease-proxy.wasm`.

Expect `{"object":"list","data":[{"id":"keylease-mock-1",…}]}`.

**2b. Tunnel on a second machine** (for example the owner's laptop) when this one cannot open port 7844. The
laptop runs only the server and the tunnel; everything else stays here. Both machines hold the same
`MOCK_API_KEY` in env, typed on each, never copied through chat or git.

```sh
# on the laptop, same commit: build the proxy (reproducible) or copy target/proxy/keylease-proxy.wasm over
scripts/build-proxy.sh                                   # sha256 must equal step 0 on this machine
read -rs MOCK_API_KEY && export MOCK_API_KEY
MOCK_API_KEY=$MOCK_API_KEY WASM_DIR=target/proxy PORT=8787 node mock-api/src/serve.ts &
cloudflared tunnel --url http://localhost:8787         # prints https://<name>.trycloudflare.com

# back on this machine (outbound HTTPS only is enough): the same two checks as step 2
curl -s -H "authorization: Bearer $MOCK_API_KEY" https://<name>.trycloudflare.com/v1/models
curl -s https://<name>.trycloudflare.com/wasm/keylease-proxy.wasm | sha256sum   # = step 0 sha256
```

The laptop must stay awake with the tunnel up until step 10. A quick tunnel's name changes on every
restart; if it does, run `kl set-proxy` with the new URL and seal the key again (step 4) with the new
`--base-url`. A host that needs only outbound HTTPS from this machine is proposed in docs/PROPOSALS.md
(P-004).

**3. Deploy** contract `keylease.<you>.testnet` and the proxy. FastFS by default; if FastFS is down, host
`target/proxy/keylease-proxy.wasm` on a public https URL and add `--proxy-url https://<host>/keylease-proxy.wasm`
(the CLI checks it the way OutLayer's worker fetches it, sha256 included, before anything goes on chain).

```sh
kl deploy
```

```text
contract   keylease.<you>.testnet
code       sha256 <contract sha256, as build-contracts.sh printed>
proxy      sha256 <proxy sha256, as build-proxy.sh printed>
proxy url  <FastFS or your URL>
admin      <you>.testnet
tx         https://testnet.nearblocks.io/txns/<hash>
```

Running it again prints `contract   keylease.<you>.testnet (already deployed)` and the same proxy lines.

**4. Seal the demo key** (encrypted on this machine to OutLayer's keystore, locked to the contract and the
proxy build; the key is read from env and never printed, and the request for the keystore's public key
carries only the env name, `{"KL_API_KEY":""}`, see Q-011)

```sh
kl add-key --key-env MOCK_API_KEY --base-url https://<mock host> --provider OpenAiCompatible --label demo
```

```text
sealed     profile main under <you>.testnet, lock Predecessor[keylease.<you>.testnet] AND WasmHash[<first 12 hex>…]
key        <key id, 0 on a fresh contract>
tx         https://testnet.nearblocks.io/txns/<hash>
```

**5. Lease** three calls to yourself for one hour, on the chat endpoint and the tripwire demo endpoint

```sh
kl lease --key 0 --grantee $NEAR_ACCOUNT_ID --calls 3 --for 1h \
  --endpoint /v1/chat/completions --endpoint /debug/headers
```

```text
lease      <lease id, 0 on a fresh contract>
expires    <ISO time one hour from now>
tx         https://testnet.nearblocks.io/txns/<hash>
```

**6. A leased call** goes through the proxy in the TEE and comes back with a receipt

```sh
kl call --lease 0 --endpoint /v1/chat/completions \
  --body '{"model":"keylease-mock-1","messages":[{"role":"user","content":"hello"}]}'
```

```text
tx         https://testnet.nearblocks.io/txns/<hash>
call       1 on lease 0
outcome    ok http 200
answer     {"v":1,"ok":true,"status":200,"body":"{\"id\":\"chatcmpl-mock\",\"object\":\"chat.completion\",<rest, cut at 300 characters>
input      sha256 <hex>
output     sha256 <hex>
```

**7. A refused call**: an endpoint that is not in the lease never reaches OutLayer (exit 2)

```sh
kl call --lease 0 --endpoint /v1/models --method GET
```

```text
tx         https://testnet.nearblocks.io/txns/<hash>
refused    endpoint_not_in_lease: This endpoint is not in the lease; call one of the listed endpoints or ask for a wider lease.
```

**8. The tripwire**: `/debug/headers` answers with the request headers, key included; the proxy withholds the
answer and the contract records a `tripwire` receipt and event (exit 2)

```sh
kl call --lease 0 --endpoint /debug/headers --method GET
```

```text
tx         https://testnet.nearblocks.io/txns/<hash>
call       2 on lease 0
outcome    tripwire (tripwire)
answer     {"v":1,"ok":false,"error":"tripwire","hint":"The call looked like an attempt to read the key, so it was stopped and recorded on chain."}
input      sha256 <hex>
output     sha256 <hex>
```

On nearblocks, the transaction's logs show `EVENT_JSON:{"standard":"keylease",…,"event":"tripwire",…}`.

**9. Receipts** (a view: no key needed)

```sh
kl receipts --lease 0
```

```text
call 1     ok /v1/chat/completions by <you>.testnet
call 2     tripwire tripwire /debug/headers by <you>.testnet
```

**10. Revoke, then the next call is refused** (exit 2)

```sh
kl revoke --lease 0
kl call --lease 0 --endpoint /v1/chat/completions --body '{"messages":[]}'
kl status --lease 0
```

```text
revoked    lease 0
tx         https://testnet.nearblocks.io/txns/<hash>
tx         https://testnet.nearblocks.io/txns/<hash>
refused    lease_revoked: The key owner revoked this lease; ask them for a new one.
lease      0 on key 0, revoked
grantee    <you>.testnet
calls      2 used, 1 left
expires    <ISO time>
endpoints  /v1/chat/completions /debug/headers
```

**If the host's URL changes** (a Cloudflare quick tunnel gets a new `*.trycloudflare.com` name on every
restart): for the proxy, `kl set-proxy --proxy-url https://<new host>/keylease-proxy.wasm` points the
contract at the same build (it refuses a different build, and checks the URL first); expect `proxy` and
`proxy url` lines and a `tx` link. For the demo API, run step 4 again with the new `--base-url` (a new key id)
and lease from that key; the old key keeps its old URL.

`kl revoke --everything` is the panic button (every lease of the account in one transaction);
`kl revoke --key 0` revokes every lease on one key.

Costs: each `kl call` attaches 0.025 NEAR. OutLayer refunds the unused compute to the caller; 0.005 NEAR
stays with the contract for the receipt. A refused call costs only gas.

## Attestation (PR 12, planned)

Paste an execution id into the Verify page: wasm hash, input/output hash, Intel TDX quote check result.
