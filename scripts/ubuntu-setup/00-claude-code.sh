#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_distro-check.sh"

echo "=== 00: Claude Code CLI (FIRST — so Claude can drive the rest) ==="
# This step gets you a working Claude session that can run the remaining
# setup scripts under your direction. It installs:
#   - curl/wget/git (minimum bootstrap deps)
#   - Node.js 22 LTS (Claude CLI is npm)
#   - Claude Code CLI
# It also seeds ~/.claude/agent-manager-key and ~/.claude/agent-server-url
# so Claude can connect to the agent manager once step 07 brings it up.
#
# After this script: run `claude` in a terminal, complete the OAuth login,
# then ask Claude to run the rest of the setup.

# 1. Bootstrap deps (in case 02-system-update hasn't run yet)
if ! command -v curl &>/dev/null || ! command -v git &>/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y curl wget git ca-certificates gnupg
fi

# 2. Node.js 22 LTS via NodeSource
if ! command -v node &>/dev/null || [ "$(node --version | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node $(node --version), npm $(npm --version)"

# 3. Claude Code CLI
if ! command -v claude &>/dev/null; then
  sudo npm install -g @anthropic-ai/claude-code
fi
claude --version

# 4. Seed ~/.claude config so Claude can talk to the agent manager
#    (manager itself is brought up by 07-claude-manager.sh)
mkdir -p "$HOME/.claude/commands" "$HOME/.claude/memory"

AGENT_MANAGER_KEY="9970726e74c96ea61113163e13f05a7778c8f413dcbb69dfa06f9aaa44d68542"
echo "$AGENT_MANAGER_KEY" > "$HOME/.claude/agent-manager-key"
chmod 600 "$HOME/.claude/agent-manager-key"

echo "http://localhost:3001" > "$HOME/.claude/agent-server-url"

# 5. CLAUDE.md — pull from the repo if it's been cloned, else fetch directly
CLAUDE_MD_SRC="$HOME/Research/ClaudeManager/docs/CLAUDE-ubuntu.md"
if [ -f "$CLAUDE_MD_SRC" ]; then
  cp "$CLAUDE_MD_SRC" "$HOME/.claude/CLAUDE.md"
else
  # Fetch raw from GitHub (will require auth later for private repos, but this file is public-readable via raw URL once you've auth'd)
  curl -fsSL -o "$HOME/.claude/CLAUDE.md" \
    https://raw.githubusercontent.com/Alex-ReachIndustries/ClaudeAgentManager/main/docs/CLAUDE-ubuntu.md \
    || echo "(CLAUDE.md not yet fetched — re-run after step 07-claude-manager.sh clones the repo)"
fi

echo ""
echo "✓ Claude Code installed and config seeded"
echo ""
echo "NEXT STEPS (manual — do these BEFORE running the next script):"
echo "  1. Run:  claude"
echo "  2. Complete the OAuth login in your browser"
echo "  3. Once at the prompt, ask Claude to run the rest of the setup:"
echo "       \"Please run the rest of the Ubuntu setup scripts in order, starting with 01-github.sh\""
echo ""
echo "Note: agent-manager-key and agent-server-url are already set."
echo "      The agent manager itself comes up in step 07."
