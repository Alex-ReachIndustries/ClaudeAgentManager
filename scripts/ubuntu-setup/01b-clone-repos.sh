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

# Repo list — these are the projects Cam will actively work on.
# Format: "<owner/repo> <local target path>"
# Lumi repos go under ~/Research because they're work projects.
REPOS=(
  "Reach-Industries/AIGroupPortal               $HOME/Research/AIGroupPortal"
  "Reach-Industries/Lumi-AI-Core                $HOME/Research/Lumi-AI-Core"
  "Reach-Industries/Lumi-AI-Continuous          $HOME/Research/Lumi-AI-Continuous"
  "Reach-Industries/Lumi-AI-Singular            $HOME/Research/Lumi-AI-Singular"
  "Alex-ReachIndustries/VisualTools             $HOME/Research/VisualTools"
  "Alex-ReachIndustries/ClaudeMeetingNoteTaker  $HOME/ClaudeMeetingNoteTaker"
  "Alex-ReachIndustries/PersonalAdmin           $HOME/PersonalAdmin"
  "Alex-ReachIndustries/AdventOfCode            $HOME/AdventOfCode"
)

FAILED=()

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
    FAILED+=("$repo (path occupied)")
    continue
  fi

  echo "  cloning $repo -> $dest"
  if gh repo clone "$repo" "$dest" 2>&1 | tail -3; then
    echo "  ✓ $name cloned"
  else
    echo "  ! failed to clone $repo (private repo + auth issue, or repo doesn't exist) — continuing"
    FAILED+=("$repo")
  fi
done

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✓ All repos cloned successfully"
else
  echo "✓ Repo clone step finished with ${#FAILED[@]} failure(s):"
  printf '    - %s\n' "${FAILED[@]}"
  echo "  Continuing — these can be cloned manually later."
fi
echo "  ClaudeManager itself is cloned by step 07 (not here)."
echo "  Re-running this script is safe — already-cloned repos are skipped."
