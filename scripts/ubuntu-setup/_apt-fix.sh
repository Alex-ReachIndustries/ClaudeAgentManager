#!/bin/bash
# Sourced helper — applied at the start of step 00 and step 02.
# Two things:
#   1. Drop /etc/apt/apt.conf.d/99-timeouts so apt can never hang forever.
#   2. Swap default Ubuntu/Mint mirrors to UK ones (gb.archive.ubuntu.com,
#      mirror.bytemark.co.uk) which have been reliable.
# Idempotent — safe to source multiple times.

set -e

# 1. Apt timeouts — every connection caps at 30s, retries 3x
if [ ! -f /etc/apt/apt.conf.d/99-timeouts ]; then
  sudo tee /etc/apt/apt.conf.d/99-timeouts >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
Acquire::ftp::Timeout "30";
EOF
  echo "  apt timeouts: 30s + 3 retries written"
fi

# 2. Mirror swap (idempotent — sed only swaps if old URL present)
APT_MIRRORS_FIXED=""
swap_mirror() {
  local old="$1" new="$2"
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    if grep -q "$old" "$f" 2>/dev/null; then
      sudo sed -i.bak "s|$old|$new|g" "$f"
      APT_MIRRORS_FIXED="yes"
      echo "  swap: $old -> $new in $(basename "$f")"
    fi
  done
}

UBUNTU_MIRROR="http://gb.archive.ubuntu.com/ubuntu"
MINT_MIRROR="http://mirror.bytemark.co.uk/linuxmint/packages"

swap_mirror "http://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "https://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "http://packages.linuxmint.com" "$MINT_MIRROR"
swap_mirror "https://packages.linuxmint.com" "$MINT_MIRROR"

# Force apt to refresh package lists from the new mirror.
# We don't run a full update here — just enough to refresh metadata.
if [ -n "$APT_MIRRORS_FIXED" ]; then
  sudo apt-get update -y -o Acquire::Languages=none -o Acquire::CompressionTypes::Order::=gz 2>&1 | tail -3 || true
fi

echo "  apt config OK"
