#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DIST="$ROOT/dist"
CORE_LINK="$ROOT/anvish-core-link"

find_core_repo() {
  if [[ -d "$ROOT/anvish-core" ]]; then
    printf '%s\n' "$ROOT/anvish-core"
    return 0
  fi
  if [[ -d /workspace/anvish ]]; then
    printf '%s\n' /workspace/anvish
    return 0
  fi
  if [[ -d "$ROOT/../anvish" ]]; then
    printf '%s\n' "$ROOT/../anvish"
    return 0
  fi
  return 1
}

CORE_REPO=$(find_core_repo || true)
if [[ -z "$CORE_REPO" ]]; then
  echo "Could not locate the anvish core repository." >&2
  echo "Expected ./anvish-core, /workspace/anvish, or ../anvish." >&2
  exit 1
fi

ln -sfn "$CORE_REPO" "$CORE_LINK"
rm -rf "$DIST"
mkdir -p "$DIST/pkg"

export CC_wasm32_wasip1=clang
export WASI_SYSROOT=/usr
export CFLAGS_wasm32_wasip1="--sysroot=/usr -I/usr/include/wasm32-wasi"

if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-wasip1 >/dev/null
fi

cargo build --manifest-path "$ROOT/runner/Cargo.toml" --release --target wasm32-wasip1
cp "$ROOT/runner/target/wasm32-wasip1/release/anvish-site-runner.wasm" \
  "$DIST/pkg/anvish-site-runner.wasm"
cp -R "$ROOT/site/." "$DIST/"
cp "$ROOT/LICENSE" "$DIST/LICENSE"
touch "$DIST/.nojekyll"
