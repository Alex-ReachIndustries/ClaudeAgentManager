#!/bin/bash
# Sourced helper — applied at the start of step 00 and step 02.
# Three things:
#   1. Drop /etc/apt/apt.conf.d/99-timeouts so apt can never hang forever.
#   2. Probe connectivity to gb.archive.ubuntu.com; fall back to
#      nl.archive.ubuntu.com if gb is unreachable. Both mirror the security
#      suite so we use ONE chosen mirror for both archive and security.
#   3. Swap default Ubuntu archive AND security mirrors to the chosen mirror.
#      We do NOT swap the Mint mirror — packages.linuxmint.com works.
# Also: undoes a bad bytemark Mint swap from older versions if present.
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

# 2. Pick a working Ubuntu mirror.
# Probe gb first (UK, Canonical-run); fall back to nl (SURFnet-run, independent
# of Canonical's mirror network so it survives Canonical-side outages).
probe() {
  local url="$1"
  curl -sI --max-time 5 "$url" 2>/dev/null | grep -q "200 OK"
}

UBUNTU_MIRROR=""
for candidate in \
  "http://gb.archive.ubuntu.com/ubuntu" \
  "http://nl.archive.ubuntu.com/ubuntu" \
  "http://mirror.kernel.org/ubuntu"; do
  if probe "$candidate/dists/" || probe "$candidate/dists/noble/Release"; then
    UBUNTU_MIRROR="$candidate"
    echo "  Ubuntu mirror picked: $UBUNTU_MIRROR (reachable)"
    break
  else
    echo "  Ubuntu mirror unreachable, trying next: $candidate"
  fi
done
if [ -z "$UBUNTU_MIRROR" ]; then
  UBUNTU_MIRROR="http://gb.archive.ubuntu.com/ubuntu"
  echo "  WARNING: no probe succeeded. Falling back to gb.archive blindly — apt may hit 30s timeouts."
fi

# 3a. Repair: undo a bad bytemark Mint swap from older versions of this helper
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

# 3b. Swap Ubuntu archive + security to the chosen mirror (idempotent)
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

# Archive
swap_mirror "http://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "https://archive.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
# Security — geographic mirrors host the security pocket, so reuse the same one
swap_mirror "http://security.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
swap_mirror "https://security.ubuntu.com/ubuntu" "$UBUNTU_MIRROR"
# If a previous version pinned us to a different gb/nl mirror, normalise to the chosen one
for prev in \
  "http://gb.archive.ubuntu.com/ubuntu" \
  "http://nl.archive.ubuntu.com/ubuntu" \
  "http://mirror.kernel.org/ubuntu"; do
  [ "$prev" = "$UBUNTU_MIRROR" ] && continue
  swap_mirror "$prev" "$UBUNTU_MIRROR"
done

echo "  apt config OK — caller will run apt-get update next (output will be visible)."
