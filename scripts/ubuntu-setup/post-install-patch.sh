#!/bin/bash
set -euo pipefail
echo "=== Post-install patch ==="
# Standalone: run this on a machine where the main 00-09 setup already finished,
# to apply two updates that were added later:
#   1. Clone the additional/missed work repos (Lumi-AI-Core/Continuous/Singular,
#      and the regular set if 01b hadn't run before).
#   2. Seed ~/.claude/memory/ from the bundled claude-memory.zip if Claude's
#      memory dir is empty.
#
# Idempotent — safe to run on any machine, partial state, or repeatedly.
# Does not touch anything that's already in place.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. Clone missing repos ---
if [ -f "$SCRIPT_DIR/01b-clone-repos.sh" ]; then
  echo ""
  echo "[1/2] Cloning any missing work repos..."
  bash "$SCRIPT_DIR/01b-clone-repos.sh"
else
  echo "WARNING: 01b-clone-repos.sh not found next to this script — skipping."
  echo "         Make sure you unzipped the full ubuntu-setup.zip, not just this file."
fi

# --- 2. Seed ~/.claude/memory if not already populated ---
echo ""
echo "[2/2] Seeding ~/.claude/memory if needed..."
mkdir -p "$HOME/.claude/memory"
MEMORY_ARCHIVE="$SCRIPT_DIR/claude-memory.zip"
if [ ! -f "$MEMORY_ARCHIVE" ]; then
  echo "  WARNING: $MEMORY_ARCHIVE not found — skipping. Make sure you unzipped"
  echo "  the full ubuntu-setup.zip alongside this script."
elif [ -f "$HOME/.claude/memory/MEMORY.md" ]; then
  echo "  ~/.claude/memory/MEMORY.md already present — leaving alone."
  echo "  (If you want to overwrite, remove ~/.claude/memory/ first.)"
else
  if ! command -v unzip &>/dev/null; then
    sudo apt-get install -y unzip
  fi
  TMPDIR_MEM="$(mktemp -d)"
  unzip -q "$MEMORY_ARCHIVE" -d "$TMPDIR_MEM"
  if [ -d "$TMPDIR_MEM/claude-memory" ]; then
    cp -r "$TMPDIR_MEM/claude-memory/." "$HOME/.claude/memory/"
    echo "  ✓ memories seeded ($(ls "$HOME/.claude/memory/" | wc -l) files)"
  fi
  rm -rf "$TMPDIR_MEM"
fi

echo ""
echo "✓ Post-install patch complete."
