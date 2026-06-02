#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OTP="${1:-}"

PACKAGES=(core tui tools local-provider harness webfetch coding-agent)

echo "Building npm artifacts…"
deno run -A --sloppy-imports "$ROOT/scripts/build_npm.ts"

echo
echo "Publishing (topological order)…"
for dir in "${PACKAGES[@]}"; do
  pkg="$ROOT/packages/$dir/npm"
  name=$(node -p "require('$pkg/package.json').name")
  version=$(node -p "require('$pkg/package.json').version")

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "  = $name@$version already published — skip"
    continue
  fi

  echo "  → publishing $name@$version"
  if [ -n "$OTP" ]; then
    ( cd "$pkg" && npm publish --access public --otp="$OTP" )
  else
    ( cd "$pkg" && npm publish --access public )
  fi
done

echo
echo "Done."
