#!/usr/bin/env bash
# Build the spike artefacts into spike/artifacts/ (git-ignored):
#   proxy-a.wasm  the build the secret is locked to
#   proxy-b.wasm  a second build with different bytes (wrong-build row S4)
#   caller.wasm   the spike caller contract (deployed as klspike.* and kldecoy.*)
# Builds twice and fails if the proxy hash changes, so the pinned hash is stable on this machine.
set -euo pipefail
cd "$(dirname "$0")"
out=artifacts
mkdir -p "$out"

proxy() { # proxy <out-name> [cargo args...]
  local name="$1"
  shift
  cargo build -q -p spike-hello-proxy --release --target wasm32-wasip2 --locked "$@"
  cp target/wasm32-wasip2/release/spike-hello-proxy.wasm "$out/$name"
}

proxy proxy-a.wasm
first="$(sha256sum "$out/proxy-a.wasm" | cut -d' ' -f1)"
cargo clean -q -p spike-hello-proxy --release --target wasm32-wasip2
proxy proxy-a.wasm
second="$(sha256sum "$out/proxy-a.wasm" | cut -d' ' -f1)"
[ "$first" = "$second" ] || { echo "proxy hash changed between builds: $first vs $second" >&2; exit 1; }
proxy proxy-b.wasm --features variant-b
proxy proxy-a.wasm # restore a in target/ for anyone inspecting it

(cd caller-contract && cargo near build non-reproducible-wasm --locked --no-abi >/dev/null)
cp target/near/spike_caller_contract/spike_caller_contract.wasm "$out/caller.wasm"

sha256sum "$out"/*.wasm
