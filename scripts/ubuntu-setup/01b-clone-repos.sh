#!/bin/bash
set -euo pipefail
echo "=== 01b: Clone work repos ==="
# Pulls down every repo Cam will likely need to work on. Idempotent — if a
# repo is already present at the target path, skip (don't pull, to avoid
# touching uncommitted local work).
#
# ClaudeManager is NOT cloned here — that's step 07 because it has extra
# setup (docker compose up, .env API key, etc.) right after the clone.

# Requires gh auth from step 01.
if ! gh auth status &>/dev/null; then
  echo "ERROR: gh not authenticated. Run 01-github.sh first." >&2
  exit 1
fi

mkdir -p "$HOME/Research"

# repo => target path
REPOS=(
  "Reach-Industries/AIGroupPortal               $HOME/Research/AIGroupPortal"
  "Alex-ReachIndustries/VisualTools             $HOME/Research/VisualTools"
  "Alex-ReachIndustries/ClaudeMeetingNoteTaker  $HOME/ClaudeMeetingNoteTaker"
  "Alex-ReachIndustries/PersonalAdmin           $HOME/PersonalAdmin"
  "Alex-ReachIndustries/AdventOfCode            $HOME/AdventOfCode"
)

for line in "${REPOS[@]}"; do
  repo="$(echo "$line" | awk '{print $1}')"
  dest="$(echo "$line" | awk '{print $2}')"
  name="$(basename "$dest")"

  if [ -d "$dest/.git" ]; then
    echo "  ✓ $name already cloned at $dest — skipping"
    continue
  fi

  if [ -e "$dest" ]; then
    echo "  ! $dest exists but is not a git repo — skipping (move it aside if you want a fresh clone)"
    continue
  fi

  echo "  cloning $repo -> $dest"
  if gh repo clone "$repo" "$dest" 2>&1 | tail -3; then
    echo "  ✓ $name cloned"
  else
    echo "  ! failed to clone $repo (private repo + auth issue, or repo doesn't exist) — continuing"
  fi
done

echo ""
echo "✓ Repo clone step complete"
echo "  ClaudeManager itself is cloned by step 07 (not here)."
echo "  Re-running this script is safe — already-cloned repos are skipped."
