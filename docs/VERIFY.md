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

**2c. Demo API on Vercel** (once the web app is deployed, see "Hosted on Vercel"; replaces the laptop
tunnel). The same mock runs as an edge function at `https://<app>/mock/*`: canned answers only, marked
with an `x-keylease-demo` header, and the relay's limits (2 KB bodies, 20 requests per minute per IP,
browsers from other sites refused). The low-value demo key goes into Vercel's env, typed at the prompt:

```sh
npx vercel@latest env add MOCK_API_KEY production    # from the repo root; paste the demo key at the prompt
npx vercel@latest deploy --prod                      # see "Hosted on Vercel" for the prebuilt path
curl -s -H "authorization: Bearer $MOCK_API_KEY" https://<app>/mock/v1/models
curl -sI https://<app>/mock/v1/models | grep -i x-keylease-demo
```

Expect `{"object":"list","data":[{"id":"keylease-mock-1",…}]}` and
`x-keylease-demo: mock API: canned answers, low-value demo key, no real provider`. In the steps below,
`<mock host>` is then `<app>/mock`, a host that does not change on restarts. The 20-per-minute limit counts
per calling IP, and OutLayer's workers call from a few IPs, so a busy demo minute can see `429` answers.

_Run 2026-11-03_ on `https://keylease.vercel.app` (Patrick): `GET /mock/v1/models` answered 200 with the
key and 401 without it. `HEAD` (the `curl -I` line) answered 404 then; since PR 10c it answers like `GET`.

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

_Run 2026-11-03_ (Patrick) with `--base-url https://keylease.vercel.app/mock`: key id 0,
[add-key tx](https://testnet.nearblocks.io/txns/Z1Wr9SXZ2JE1BaB47V3xvAjBykz27RE1bZQ6uLPufxt).

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

## Attack run (PR 9)

After steps 0-4 (contract, proxy, demo API, the demo key sealed with `--base-url https://<mock host>`), from
the operator box. It creates a fresh 3-call lease to yourself on `/v1/chat/completions` and
`/debug/headers`, plays eight prompt-injection attacks as the agent, revokes before the last one, and
rewrites `docs/ATTACK_LOG.md` with expected and actual results (codes, HTTP status and tx links only).
Costs a few calls of 0.025 NEAR (unused compute refunded) plus gas. The script is `examples/src/attack.ts`
(the `examples/` folder at the repo root, not under `packages/`); run it from the repo root.

```sh
export KEYLEASE_CONTRACT_ID=keylease.<you>.testnet KEYLEASE_KEY_ID=<key id from step 4>
# NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY from step 1 (env or the repo's .env; never printed)
pnpm --filter @keylease/examples attack
```

Expect one line per attack and a total; exit code 0 when all match:

```text
A1 PASS  GET /v1/keys  expected refused `endpoint_not_in_lease` (no call used)  actual refused `endpoint_not_in_lease`
…
A4 PASS  GET /debug/headers  expected refused `tripwire` (call used, recorded)  actual refused `tripwire`
A5 PASS  POST /v1/chat/completions  expected answered, token redacted  actual answered HTTP 200, token redacted
…
A8 PASS  POST /v1/chat/completions  expected refused `lease_revoked` (no call used)  actual refused `lease_revoked`
8/8 as expected; log: …/docs/ATTACK_LOG.md
```

Send back the regenerated `docs/ATTACK_LOG.md` (it holds no secret) to replace the plan in the repo. The
smallest agent, for a lease you shared: `KEYLEASE_LEASE_ID=<n> pnpm --filter @keylease/examples agent "Hi"`.

_Run 2026-11-03_ (Patrick, commit `0826c78`, key 0, lease 0, demo API on `keylease.vercel.app/mock`): 8/8 as
expected, [docs/ATTACK_LOG.md](ATTACK_LOG.md) (PR #28).

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

5. Your keys → Share on `web demo`: grantee `<you>.testnet` (or an agent account), preset `Demo, 1 hour,
10 calls`, Create lease and share, confirm one transaction. Expect a Share box `Lease <n> for <grantee>`
   with the link `…/lease/?id=<n>`, a QR code and Copy Link · SDK · near CLI · MCP; no snippet holds the key.
   Open the link: `Lease <n>`, status `active`, `0 used, 10 left of 10`, `in 1 h`, endpoint `/chat/completions`.
6. From a shell with the grantee's key in your keychain, the copied near CLI command makes one leased call
   (same as `kl call`, step 7).

7. Your leases: the new lease shows `Lease <n> → <grantee>`, `active`, `0 used, 10 left · expires in 1 h`.
   After a call (step 6), the row adds `last call … /chat/completions ✓ HTTP 200`, and the lease page lists it
   under Calls with its input sha256 (no body, no key).
8. Revoke on that row, confirm one transaction: `✓ Revoked. The next call is refused with lease_revoked.` and
   the row says `revoked`. Running the near CLI command again fails with
   `lease_revoked: The key owner revoked this lease; ask them for a new one.` "Revoke all for this key"
   on the key row does the same for every lease on that key.

9. Panic button → Revoke everything → Yes, revoke everything, confirm one transaction: `✓ Every lease of
this account is revoked…`; every lease row says `revoked`, and any copied near CLI call fails with
   `lease_revoked`.

10. Key Pass (needs a contract deployed from `main` after PR 10): Share with "Let the holder transfer this
    lease (Key Pass) to another account" ticked, to a second account you hold. Open the lease link with that
    account's wallet: a "Transfer Key Pass" box. Give a third `.testnet` account, confirm one transaction
    (1 yoctoNEAR): `✓ Key Pass <n> moved to <account>.`, the Holder line changes, and the box is gone. The
    second account's near CLI call now fails with `not_lease_holder`. A lease shared without the box ticked
    says `this Key Pass is not transferable: the key owner did not allow transfers for this lease.`

Time to first lease (brief §4) is measured in CI by `apps/web/e2e/timing.spec.ts`. It drives connect →
paste key → preset → share against a build with a test-only wallet (`pnpm build:e2e`, never deployed:
`pnpm check:release` fails any build that contains it, and the Vercel build runs that check). It asserts
both the measured run and a human estimate (4 s per click or field) stay under 60 s; today 8 actions,
32 s estimated.

## Hosted on Vercel (D3, E-017)

Vercel Hobby, from this repo. Patrick logs in and deploys; nothing here holds a Vercel token.

**Live:** `https://keylease.vercel.app` (project `rune-claw/keylease`, Root Directory `apps/web`, prebuilt
deploys). Checked on it: the demo API at `/mock` (step 2c), the demo key sealed against it (step 4), the
attack run, and the header, relay and leased-call checks below (_Run 2026-11-03_). Still open: the
real-wallet run ("Web app, by hand" steps 1-9 on this URL).

Project settings (once): **Root Directory** `apps/web`, **Framework Preset** Other, **Node.js** 22.x.
`apps/web/vercel.json` sets the install and build commands; the build writes `.vercel/output` (Build
Output API v3: static pages, the edge function `/api/secrets/pubkey`, response headers). Environment
variables (Production and Preview):

| Name                               | Value                                     |
| ---------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_NEAR_NETWORK`         | `testnet` (anything else fails the build) |
| `NEXT_PUBLIC_KEYLEASE_CONTRACT_ID` | `keylease.<you>.testnet`                  |
| `NEXT_PUBLIC_REOWN_PROJECT_ID`     | empty (WalletConnect off, E-016)          |

Run the CLI from the **repo root**, without `--cwd apps/web`: the project's Root Directory is already
`apps/web`, so `--cwd apps/web` makes the CLI look for `apps/web/apps/web` and stop with "does not exist".
`.vercel/` (the link and the build output) is git-ignored.

```sh
npx vercel@latest login          # or connect the GitHub repo in the Vercel dashboard
npx vercel@latest link           # once, at the repo root: pick rune-claw/keylease
npx vercel@latest deploy         # preview; add --prod for production
# or build here and upload the output (how the live deploys are made):
npx vercel@latest build --prod && npx vercel@latest deploy --prebuilt --prod
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

_Run 2026-11-03_ (Patrick) on `https://keylease.vercel.app`, deploy `dpl_4DAL4AagpMKf3dn5cgzz8vvotFi9` of
`main` at `e664be0` (after PR 10c), 20:48 CET:

| Check                                                       | Result                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` headers                                             | `content-security-policy: frame-ancestors 'none'`, `x-frame-options: DENY`, `nosniff`, HSTS with preload, `no-referrer`, `permissions-policy`                                                     |
| `/mock/v1/models` without the key, `HEAD` / `GET`           | 401 / 401 (`HEAD` was 404 before PR 10c)                                                                                                                                                          |
| `/mock/v1/models` with a wrong key, `HEAD` / `GET`          | 401 / 401                                                                                                                                                                                         |
| `x-keylease-demo` header on `/mock`                         | present                                                                                                                                                                                           |
| `/mock` from a foreign origin                               | 403                                                                                                                                                                                               |
| relay `POST /api/secrets/pubkey`, empty secret value        | 200, a 64-hex pubkey                                                                                                                                                                              |
| relay, non-empty secret value                               | 400                                                                                                                                                                                               |
| relay, foreign origin                                       | 403                                                                                                                                                                                               |
| lease 1 on key 0, then a leased `POST /v1/chat/completions` | [lease tx](https://testnet.nearblocks.io/txns/BzKeENDTdX1tgdVMZRJSRxaBDvrz4SSgVe1cqHgedfaS), [call tx](https://testnet.nearblocks.io/txns/CuihvYgQZ7kY3o6C5kH6GoKeLtGz5M66ye2b35mgyZg1): HTTP 200 |
| lease 2 on key 0, then a leased `GET /v1/models`            | [lease tx](https://testnet.nearblocks.io/txns/6QYryo8cvGm9GHqeVSbR9AL66faSmhZLbM1VM1QVr244), [call tx](https://testnet.nearblocks.io/txns/D8udBtXJ5FmoYbgFnMwvJwCTaBigtgavMprPPy2AzbKL): HTTP 200 |

`/mock` with the real demo key, called directly, was not run: `MOCK_API_KEY` is a sensitive variable in
Vercel and is not read back. The two leased calls above reached `/mock` with that key from inside the
proxy and got 200.

Then run "Web app, by hand" steps 1-9 on `https://<app>` instead of the local server.

## Attestation (PR 12, planned)

Paste an execution id into the Verify page: wasm hash, input/output hash, Intel TDX quote check result.
