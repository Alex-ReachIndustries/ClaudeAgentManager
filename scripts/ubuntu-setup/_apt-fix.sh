#!/bin/bash
# Sourced helper — applied at the start of step 00 and step 02.
# Two things:
#   1. Drop /etc/apt/apt.conf.d/99-timeouts so apt can never hang forever.
#   2. Swap default Ubuntu/Mint mirrors to UK ones (gb.archive.ubuntu.com,
#      mirror.bytemark.co.uk).
# Idempotent — safe to source multiple times.
#
# DOES NOT run apt-get update itself — that's the caller's job, with output
# visible. Otherwise users see dead air for up to 2 minutes wondering if the
# script has hung. Each calling script does its own apt-get update next.

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
else
  echo "  apt timeouts: already present"
fi

# 2. Mirror swap (idempotent — sed only swaps if old URL present)
swap_mirror() {
  local old="$1" new="$2"
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    if grep -q "$old" "$f" 2>/dev/null; then
      sudo sed -i.bak "s|$old|$new|g" "$f"
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

echo "  apt config OK — caller will run apt-get update next (output will be visible)."
