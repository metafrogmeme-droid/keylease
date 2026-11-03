#!/usr/bin/env bash
# Install the pinned cargo-near into .tools/bin (git-ignored, cached in CI by this file's hash).
# Prefers the prebuilt release binary (seconds), checked against the release's .sha256 file and, on
# linux_x64, against a pinned sha256 once known; falls back to building from crates.io (minutes).
set -euo pipefail
VERSION="0.22.0"
LINUX_X64_SHA256="${CARGO_NEAR_LINUX_X64_SHA256:-}"

root="$(git rev-parse --show-toplevel)"
dest="$root/.tools/bin"
if [ -x "$dest/cargo-near" ] && "$dest/cargo-near" near --version 2>/dev/null | grep -q "$VERSION"; then
  echo "cargo-near $VERSION already in $dest"
  exit 0
fi
mkdir -p "$dest"

prebuilt() {
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || return 1
  local tmp asset base actual
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  asset="cargo-near-x86_64-unknown-linux-gnu.tar.gz"
  base="https://github.com/near/cargo-near/releases/download/cargo-near-v$VERSION"
  curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || return 1
  curl -fsSL --retry 3 -o "$tmp/$asset.sha256" "$base/$asset.sha256" || return 1
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
  [ "$actual" = "$(cut -d' ' -f1 "$tmp/$asset.sha256")" ] || { echo "cargo-near checksum mismatch" >&2; return 1; }
  if [ -n "$LINUX_X64_SHA256" ] && [ "$actual" != "$LINUX_X64_SHA256" ]; then
    echo "cargo-near sha256 $actual is not the pinned $LINUX_X64_SHA256" >&2
    exit 1
  fi
  echo "cargo-near $asset sha256 $actual"
  tar -xzf "$tmp/$asset" -C "$tmp"
  install -m 0755 "$(find "$tmp" -type f -name cargo-near | head -1)" "$dest/cargo-near"
}

if ! prebuilt; then
  echo "prebuilt cargo-near unavailable; building $VERSION from crates.io" >&2
  cargo install cargo-near --version "$VERSION" --locked --no-default-features --root "$root/.tools"
fi
"$dest/cargo-near" near --version
