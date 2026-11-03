#!/usr/bin/env bash
# Self-test: proves the gitleaks setup catches planted fake keys, including a key that was committed and
# then deleted (full-history scan), and a staged key (pre-commit mode). Keys are random and built at run
# time, so this file holds no key-shaped string. Exit 0 = every check behaved as expected.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
gl="${GITLEAKS:-$(command -v gitleaks || echo "$root/.tools/bin/gitleaks")}"
gl="$(cd "$root" && realpath "$gl")" # the test cds into a scratch repo
cfg="$root/.gitleaks.toml"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

b58() { LC_ALL=C tr -dc '1-9A-HJ-NP-Za-km-z' </dev/urandom | head -c "$1"; }
alnum() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

scan() { # scan <expect-exit> <label> <args...>
  local expect="$1" label="$2"
  shift 2
  set +e
  "$gl" git "$@" --config "$cfg" --ignore-gitleaks-allow --no-banner --redact \
    --report-format json --report-path "$work/report.json" >"$work/out.log" 2>&1
  local got=$?
  set -e
  if [ "$got" -ne "$expect" ]; then
    cat "$work/out.log" >&2
    echo "FAIL $label: exit $got, expected $expect" >&2
    exit 1
  fi
  echo "ok   $label"
}

expect_rule() {
  grep -q "\"RuleID\": \"$1\"" "$work/report.json" || { echo "FAIL rule $1 not reported" >&2; exit 1; }
  echo "ok   reported rule $1"
}

repo="$work/repo"
git init -q "$repo"
cd "$repo"
git config user.name selftest
git config user.email selftest@example.invalid
git config commit.gpgsign false

echo "hello" >README.md
git add README.md && git commit -qm "clean"
scan 0 "clean history passes" "$repo"

# Plant fake keys, commit, then delete them: only a full-history scan still sees them.
{
  echo "near_key = \"ed25519:$(b58 88)\""
  echo "provider = \"sk-proj-$(alnum 48)\""
  echo "NEAR_PRIVATE_KEY=$(alnum 40)"
} >config.txt
git add config.txt && git commit -qm "oops"
git rm -q config.txt && git commit -qm "remove"
[ ! -e config.txt ] || exit 1
scan 1 "deleted key found in full history" "$repo"
expect_rule near-ed25519-private-key
expect_rule llm-provider-key
expect_rule env-style-secret-assignment

# gitleaks:allow must not hide a key in CI (--ignore-gitleaks-allow).
echo "k = \"ed25519:$(b58 88)\" # gitleaks:allow" >allowed.txt
git add allowed.txt
scan 1 "staged key found in pre-commit mode, inline allow ignored" --pre-commit --staged "$repo"
expect_rule near-ed25519-private-key

echo "gitleaks self-test passed"
