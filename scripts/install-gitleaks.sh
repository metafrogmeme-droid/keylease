#!/usr/bin/env bash
# Install the pinned gitleaks into .tools/bin (git-ignored). Used by CI and by the pre-commit hook.
# The tarball is checked against the release checksums file; on linux_x64 also against a pinned sha256.
set -euo pipefail
VERSION="8.30.1"
LINUX_X64_SHA256="${GITLEAKS_LINUX_X64_SHA256:-}"

root="$(git rev-parse --show-toplevel)"
dest="$root/.tools/bin"
if [ -x "$dest/gitleaks" ] && "$dest/gitleaks" version 2>/dev/null | grep -q "$VERSION"; then
  echo "gitleaks $VERSION already in $dest"
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) arch=linux_x64 ;;
  Linux-aarch64 | Linux-arm64) arch=linux_arm64 ;;
  Darwin-x86_64) arch=darwin_x64 ;;
  Darwin-arm64) arch=darwin_arm64 ;;
  *) echo "unsupported platform; install gitleaks $VERSION yourself" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
base="https://github.com/gitleaks/gitleaks/releases/download/v$VERSION"
tarball="gitleaks_${VERSION}_${arch}.tar.gz"
curl -fsSL --retry 3 -o "$tmp/$tarball" "$base/$tarball"
curl -fsSL --retry 3 -o "$tmp/checksums.txt" "$base/gitleaks_${VERSION}_checksums.txt"

(cd "$tmp" && grep " $tarball\$" checksums.txt | sha256sum -c -)
actual="$(sha256sum "$tmp/$tarball" | cut -d' ' -f1)"
echo "gitleaks $tarball sha256 $actual"
if [ "$arch" = linux_x64 ] && [ -n "$LINUX_X64_SHA256" ] && [ "$actual" != "$LINUX_X64_SHA256" ]; then
  echo "sha256 mismatch: expected $LINUX_X64_SHA256" >&2
  exit 1
fi

mkdir -p "$dest"
tar -xzf "$tmp/$tarball" -C "$tmp" gitleaks
install -m 0755 "$tmp/gitleaks" "$dest/gitleaks"
"$dest/gitleaks" version
