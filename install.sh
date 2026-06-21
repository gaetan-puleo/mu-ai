#!/bin/sh
set -eu

REPO="gaetan-puleo/mu-ai"
BIN="mu"
INSTALL_DIR="${MU_INSTALL_DIR:-$HOME/.local/bin}"

err() {
  echo "install: $1" >&2
  exit 1
}

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) os="linux" ;;
  Darwin) os="macos" ;;
  *) err "unsupported OS '$os' — on Windows, download mu-windows-x64.exe from the releases page" ;;
esac

case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) err "unsupported architecture '$arch'" ;;
esac

asset="${BIN}-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

echo "Downloading ${asset} (latest)…"
mkdir -p "$INSTALL_DIR"
tmp=$(mktemp)
if ! curl -fSL "$url" -o "$tmp"; then
  rm -f "$tmp"
  err "download failed: $url"
fi

chmod +x "$tmp"
if [ "$os" = "macos" ]; then
  xattr -d com.apple.quarantine "$tmp" 2>/dev/null || true
fi
mv "$tmp" "$INSTALL_DIR/$BIN"

echo "Installed $BIN → $INSTALL_DIR/$BIN"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) echo "Run: $BIN" ;;
  *) echo "Add $INSTALL_DIR to your PATH, then run: $BIN" ;;
esac
