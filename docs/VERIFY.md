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

**2. Proxy wasm on a GitHub release** (default). OutLayer's worker fetches the proxy by URL without logging
in, so the file goes on a release of the public repo `metafrogmeme-droid/keylease-wasm`, tagged
`wasm-<keylease commit>`. The release URL redirects once to GitHub's file host, within the worker's limit
of 3 redirects. Run from the commit you built in step 0:

```sh
TAG=wasm-$(git rev-parse --short HEAD)
gh release create "$TAG" target/proxy/keylease-proxy.wasm --repo metafrogmeme-droid/keylease-wasm \
  --title "$TAG" --notes "keylease-proxy.wasm from keylease $(git rev-parse HEAD), sha256 $(sha256sum target/proxy/keylease-proxy.wasm | cut -d' ' -f1)"
PROXY_URL=https://github.com/metafrogmeme-droid/keylease-wasm/releases/download/$TAG/keylease-proxy.wasm
curl -sL "$PROXY_URL" | sha256sum                   # = step 0 sha256
```

A release is only needed when the proxy's sha256 changes; an older release with the same sha256 serves the
same bytes (3 Nov run: `wasm-0e45d5b`, sha256 `95385bd1…4cd970`). FastFS (`kl deploy` without `--proxy-url`)
and the `WASM_DIR` route of `serve.ts` remain as other hosts.

**2b. Demo API on the owner's laptop.** The mock API must be reachable by OutLayer's workers. A Cloudflare
quick tunnel gives it a public https name, but `cloudflared` reaches Cloudflare's edge on port **7844**
(QUIC over UDP, or `--protocol http2` over TCP) and cannot run through an HTTPS-only proxy. The operator box
has HTTPS-only egress (3 Nov: `failed to dial to edge with quic: timeout`, then `TLS handshake with edge
error: EOF`), so the tunnel runs on the owner's laptop. Both machines hold the same `MOCK_API_KEY` in env,
typed on each, never copied through chat or git.

```sh
# on the laptop (same commit)
read -rs MOCK_API_KEY && export MOCK_API_KEY
MOCK_API_KEY=$MOCK_API_KEY PORT=8787 node mock-api/src/serve.ts &
cloudflared tunnel --url http://localhost:8787         # prints https://<name>.trycloudflare.com within ~10 s

# on the operator box (outbound HTTPS is enough)
curl -s -H "authorization: Bearer $MOCK_API_KEY" https://<name>.trycloudflare.com/v1/models
```

Expect `{"object":"list","data":[{"id":"keylease-mock-1",…}]}`. In the steps below, `<mock host>` is
`<name>.trycloudflare.com`. The laptop stays awake with the tunnel up until step 10. A quick tunnel's name
changes on every restart; if it does, seal the key again (step 4) with the new `--base-url` (the proxy URL
is on GitHub and does not change).

**3. Deploy** contract `keylease.<you>.testnet` and the proxy URL from step 2 (the CLI checks the URL the
way OutLayer's worker fetches it, sha256 included, before anything goes on chain).

```sh
kl deploy --proxy-url "$PROXY_URL"
```

```text
contract   keylease.<you>.testnet
code       sha256 <contract sha256, as build-contracts.sh printed>
proxy      sha256 <proxy sha256, as build-proxy.sh printed>
proxy url  https://github.com/metafrogmeme-droid/keylease-wasm/releases/download/wasm-<commit>/keylease-proxy.wasm
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

**If a host's URL changes.** The demo API's quick tunnel gets a new `*.trycloudflare.com` name on every
restart: run step 4 again with the new `--base-url` (a new key id) and lease from that key; the old key keeps
its old URL. If the proxy ever moves (a new release with the same sha256, or another host),
`kl set-proxy --proxy-url <new url>` points the contract at the same build (it refuses a different build and
checks the URL first); expect `proxy` and `proxy url` lines and a `tx` link.

`kl revoke --everything` is the panic button (every lease of the account in one transaction);
`kl revoke --key 0` revokes every lease on one key.

Costs: each `kl call` attaches 0.025 NEAR. OutLayer refunds the unused compute to the caller; 0.005 NEAR
stays with the contract for the receipt. A refused call costs only gas.

## Web app, by hand (PR 7)

After steps 0-3 (contract deployed, proxy on its release, demo API up on the laptop):

```sh
NEXT_PUBLIC_KEYLEASE_CONTRACT_ID=keylease.<you>.testnet pnpm --filter @keylease/web build
node apps/web/scripts/serve.ts apps/web/out 4173       # then open http://127.0.0.1:4173
```

The local server includes the same OutLayer pubkey relay as the hosted app (`POST /api/secrets/pubkey`,
E-017), so this machine needs outbound HTTPS to `testnet-api.outlayer.ai`.

1. TESTNET banner names `keylease.<you>.testnet`; the strip shows Connect · Add key · Share.
2. Connect wallet → Meteor, HOT, Intear or MetaMask (MyNearWallet works for Add key but leaves the page,
   so it cannot finish Test key). Expect `Connected as <account>` and step 1 ✓.
3. Add key: provider OpenAI-compatible, base URL `https://<mock host>/v1`, paste the demo key, label `web
demo`, Seal and add key, confirm two transactions. Expect the field empty at once, then `✓ Key added.`
   with two tx links. If you see `OutLayer's keystore could not be reached from this page`, the relay got no
   answer from OutLayer; try again, or use step 4 (`kl add-key`).
4. Your keys → Test key on `web demo`, confirm two transactions (a one-call lease to yourself, then the
   call on `/models`, 0.025 NEAR). Expect `✓ The key works: the API answered HTTP 200 through the proxy.`
   and a `receipt tx` link.

## Hosted on Vercel (D3, E-017)

Vercel Hobby, from this repo. Patrick logs in and deploys; nothing here holds a Vercel token.

Project settings (once): **Root Directory** `apps/web`, **Framework Preset** Other, **Node.js** 22.x.
`apps/web/vercel.json` sets the install and build commands; the build writes `.vercel/output` (Build
Output API v3: static pages, the edge function `/api/secrets/pubkey`, response headers). Environment
variables (Production and Preview):

| Name                               | Value                                     |
| ---------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_NEAR_NETWORK`         | `testnet` (anything else fails the build) |
| `NEXT_PUBLIC_KEYLEASE_CONTRACT_ID` | `keylease.<you>.testnet`                  |
| `NEXT_PUBLIC_REOWN_PROJECT_ID`     | empty (WalletConnect off, E-016)          |

```sh
npx vercel@latest login          # or connect the GitHub repo in the Vercel dashboard
npx vercel@latest link --cwd apps/web
npx vercel@latest deploy --cwd apps/web            # preview; add --prod for production
```

Checks against the deployed URL `<app>`:

```sh
curl -sI https://<app>/ | grep -iE 'content-security-policy|x-frame-options|x-content-type'
# content-security-policy: frame-ancestors 'none'   x-frame-options: DENY   x-content-type-options: nosniff

B='{"accessor":{"type":"WasmHash","hash":"<proxy sha256>"},"owner":"<you>.testnet","profile":"kl-check","secrets_json":"{\"KL_API_KEY\":\"\"}"}'
curl -s -X POST https://<app>/api/secrets/pubkey -H 'content-type: application/json' -d "$B"
# {"pubkey":"<64 hex>"}
X='{"accessor":{"type":"WasmHash","hash":"<proxy sha256>"},"owner":"<you>.testnet","profile":"kl-check","secrets_json":"{\"KL_API_KEY\":\"x\"}"}'
curl -s -X POST https://<app>/api/secrets/pubkey -H 'content-type: application/json' -d "$X"
# {"error":"secrets_json values must be empty: the relay never carries a key"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<app>/api/secrets/pubkey \
  -H 'content-type: application/json' -H 'origin: https://example.org' -d "$B"
# 403
```

Then run "Web app, by hand" steps 1-4 on `https://<app>` instead of the local server.

## Attestation (PR 12, planned)

Paste an execution id into the Verify page: wasm hash, input/output hash, Intel TDX quote check result.
