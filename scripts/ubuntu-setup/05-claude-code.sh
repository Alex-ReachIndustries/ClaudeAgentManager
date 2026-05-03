#!/bin/bash
set -euo pipefail
echo "=== 05: Claude Code CLI ==="

# Install Claude Code CLI globally
sudo npm install -g @anthropic-ai/claude-code

# Confirm install
claude --version

echo ""
echo "✓ Claude Code installed"
echo ""
echo "NEXT STEPS (manual):"
echo "1. Run: claude"
echo "2. Complete the OAuth login in your browser"
echo "3. Copy your API key to ~/.claude/agent-manager-key:"
echo "   echo 'YOUR_KEY_HERE' > ~/.claude/agent-manager-key"
echo "4. Set agent server URL:"
echo "   echo 'http://localhost:3001' > ~/.claude/agent-server-url"
