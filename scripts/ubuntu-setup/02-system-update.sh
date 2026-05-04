#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_distro-check.sh"

echo "=== 02: System Update ==="

# --- Apt timeouts + retries (CRITICAL: prevents the hangs we kept hitting) ---
# Without these, if archive.ubuntu.com / packages.linuxmint.com is slow or
# down, apt will wait forever. With these, every connection caps at 30s and
# retries 3x before giving up. Persistent, applies to all future apt runs.
echo "Setting apt timeouts + retries..."
sudo tee /etc/apt/apt.conf.d/99-timeouts >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
Acquire::ftp::Timeout "30";
APT::Acquire::By-Hash "yes";
EOF

# --- Swap to fast mirrors ---
# The default Mint and Ubuntu mirrors (packages.linuxmint.com, archive.ubuntu.com)
# have been intermittently slow/dead — that's what hung the original installer
# and kept apt from finishing. Use known-fast UK/EU/global mirrors instead.
echo "Switching to fast mirrors..."

# Ubuntu archive: gb.archive (UK Canonical) is fastest from the UK; mirrors.kernel.org
# is a solid global fallback.
UBUNTU_MIRROR="http://gb.archive.ubuntu.com/ubuntu"
UBUNTU_SECURITY="http://security.ubuntu.com/ubuntu"

# Mint repo: bytemark UK mirror is reliable
MINT_MIRROR="http://mirror.bytemark.co.uk/linuxmint"

# Replace mirrors in all apt source files (idempotent — sed only swaps if old URL present)
swap_mirror() {
  local old="$1" new="$2"
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    if grep -q "$old" "$f" 2>/dev/null; then
      sudo sed -i.bak "s|$old|$new|g" "$f"
      echo "  $f: $old -> $new"
    fi
  done
}

swap_mirror "http://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "https://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "http://packages.linuxmint.com" "$MINT_MIRROR/packages"
swap_mirror "https://packages.linuxmint.com" "$MINT_MIRROR/packages"

echo "Active apt sources:"
grep -hE '^[^#]*(http|https)://' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null \
  | awk '{for(i=1;i<=NF;i++) if($i ~ /^https?:/) print $i}' | sort -u | head -10

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
echo "  Apt timeouts/retries set in /etc/apt/apt.conf.d/99-timeouts"
echo "  Mirrors swapped to UK/EU. If you're not in Europe, you may want to"
echo "  pick closer ones via: 'Software Sources' GUI, or edit"
echo "  /etc/apt/sources.list.d/official-package-repositories.list"
