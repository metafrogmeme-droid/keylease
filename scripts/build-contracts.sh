#!/usr/bin/env bash
# Build the NEAR contracts with cargo-near into target/near/ (used by the sandbox tests and deploys).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
for c in keylease mock-outlayer; do
  (cd "$root/contracts/$c" && cargo near build non-reproducible-wasm --locked --no-abi >/dev/null)
done
sha256sum "$root"/target/near/*/*.wasm
