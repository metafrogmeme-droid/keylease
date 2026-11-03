#!/usr/bin/env bash
# Build the KeyLease proxy (wasm32-wasip2) twice from clean and fail if the bytes differ.
# Prints the sha256 that a key's lock (WasmHash) must name. Output: target/proxy/keylease-proxy.wasm
#
# Same machine + same toolchain -> same bytes. Across machines, build in OutLayer's pinned compiler image
# (OutLayer's scripts/build_github_wasm.sh --dir wasm/keylease-proxy --target wasm32-wasip2 --twice); the
# published hash comes from that build (docs/VERIFY.md).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
rustup target add wasm32-wasip2 >/dev/null 2>&1 || true

build() {
  cargo clean -q -p keylease-proxy --release --target wasm32-wasip2
  cargo build -q -p keylease-proxy --release --target wasm32-wasip2 --locked
  sha256sum target/wasm32-wasip2/release/keylease-proxy.wasm | cut -d' ' -f1
}

first="$(build)"
second="$(build)"
if [ "$first" != "$second" ]; then
  echo "proxy build is not reproducible: $first vs $second" >&2
  exit 1
fi
mkdir -p target/proxy
cp target/wasm32-wasip2/release/keylease-proxy.wasm target/proxy/keylease-proxy.wasm
echo "keylease-proxy.wasm $(wc -c <target/proxy/keylease-proxy.wasm) bytes"
echo "sha256 $first"
