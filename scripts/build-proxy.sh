#!/usr/bin/env bash
# Build the KeyLease proxy (wasm32-wasip2) twice from clean and fail if the bytes differ.
# Prints the sha256 that a key's lock (WasmHash) must name. Output: target/proxy/keylease-proxy.wasm
#
# The toolchain is pinned (rust-toolchain.toml) and machine paths are remapped, so the same commit builds the
# same bytes on any x86_64 Linux host. For the hash OutLayer itself measures, also build in OutLayer's pinned compiler image
# (OutLayer's scripts/build_github_wasm.sh --dir wasm/keylease-proxy --target wasm32-wasip2 --twice); the
# published hash comes from that build (docs/VERIFY.md).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
# Own target dir, so the remap flags do not invalidate the normal build cache.
export CARGO_TARGET_DIR="$root/target/proxy-build"
export RUSTFLAGS="--remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$root=/src"
out="$CARGO_TARGET_DIR/wasm32-wasip2/release/keylease-proxy.wasm"

build() {
  cargo clean -q -p keylease-proxy --release --target wasm32-wasip2
  cargo build -q -p keylease-proxy --release --target wasm32-wasip2 --locked
  sha256sum "$out" | cut -d' ' -f1
}

first="$(build)"
second="$(build)"
if [ "$first" != "$second" ]; then
  echo "proxy build is not reproducible: $first vs $second" >&2
  exit 1
fi
mkdir -p target/proxy
cp "$out" target/proxy/keylease-proxy.wasm
echo "rustc $(rustc --version | cut -d' ' -f2)"
echo "keylease-proxy.wasm $(wc -c <target/proxy/keylease-proxy.wasm) bytes"
echo "sha256 $first"
