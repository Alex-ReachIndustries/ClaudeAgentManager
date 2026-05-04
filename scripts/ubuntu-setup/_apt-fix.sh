#!/bin/bash
# Sourced helper — applied at the start of step 00 and step 02.
# Two things:
#   1. Drop /etc/apt/apt.conf.d/99-timeouts so apt can never hang forever.
#   2. Swap Ubuntu archive default to UK mirror (gb.archive.ubuntu.com) which
#      has been more reliable than the round-robin archive.ubuntu.com.
#      We DO NOT swap the Mint mirror — packages.linuxmint.com is fine and
#      bytemark/etc don't mirror standard Mint Cinnamon (only LMDE).
# Also: undoes a bad bytemark swap from older versions of this script if found.
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
else
  echo "  apt timeouts: already present"
fi

# 2. Repair: undo a bad bytemark Mint swap if a previous version of this
# helper applied it (bytemark only mirrors LMDE, not standard Mint).
swap_back() {
  local bad="$1" good="$2"
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    if grep -q "$bad" "$f" 2>/dev/null; then
      sudo sed -i.bak "s|$bad|$good|g" "$f"
      echo "  REPAIR: $bad -> $good in $(basename "$f")"
    fi
  done
}
swap_back "http://mirror.bytemark.co.uk/linuxmint/packages" "http://packages.linuxmint.com"
swap_back "http://mirror.bytemark.co.uk/linuxmint" "http://packages.linuxmint.com"

# 3. Mirror swap (Ubuntu only, idempotent)
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
swap_mirror "http://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "https://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"

echo "  apt config OK — caller will run apt-get update next (output will be visible)."
