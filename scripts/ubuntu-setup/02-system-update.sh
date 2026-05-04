#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_distro-check.sh"

echo "=== 02: System Update ==="

# Apt fix: 30s timeouts + fast UK mirrors. No-op if step 00 already did it.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_apt-fix.sh"

# --- Now do the actual update + install ---
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get dist-upgrade -y
sudo apt-get install -y \
  curl wget git unzip zip tar \
  build-essential pkg-config \
  software-properties-common \
  apt-transport-https ca-certificates \
  gnupg lsb-release \
  htop tmux vim nano \
  net-tools iputils-ping dnsutils \
  xdotool jq

sudo apt-get autoremove -y
sudo apt-get autoclean -y

echo ""
echo "✓ System update complete"
echo "  Mirrors: see _apt-fix.sh — defaults are UK (gb.archive.ubuntu.com,"
echo "  mirror.bytemark.co.uk). If you're elsewhere, edit"
echo "  /etc/apt/sources.list.d/official-package-repositories.list manually,"
echo "  or use Software Sources GUI on Mint."
