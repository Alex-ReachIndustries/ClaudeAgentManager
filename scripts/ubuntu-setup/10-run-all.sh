#!/bin/bash
set -euo pipefail
# Master installer — runs all steps in order.
# Run from the directory containing the scripts:
#   cd ~/ubuntu-setup && bash 10-run-all.sh
#
# Steps requiring manual action (login, keys) are marked INTERACTIVE.
# All others are fully automated.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_step() {
  local num="$1" name="$2"
  echo ""
  echo "========================================"
  echo "STEP $num: $name"
  echo "========================================"
  bash "$SCRIPT_DIR/${num}-${name}.sh"
  echo ""
  echo "✓ Step $num complete"
}

run_step "00" "github"           # INTERACTIVE: GitHub browser login
run_step "01" "system-update"
run_step "02" "nvidia-drivers"
run_step "03" "docker"
run_step "04" "nodejs"
run_step "05" "claude-code"       # INTERACTIVE: requires browser login
run_step "06" "tailscale"         # INTERACTIVE: requires browser auth
run_step "07" "android-dev"
run_step "08" "claude-manager"
run_step "09" "systemd-autostart"

echo ""
echo "=========================================="
echo "ALL STEPS COMPLETE"
echo "=========================================="
echo ""
echo "Manual steps remaining:"
echo "  1. Step 00 prompted GitHub login in browser — confirm it worked: gh auth status"
echo "  2. Run: claude            (authenticate with Anthropic)"
echo "  3. Run: sudo tailscale up (join your tailnet)"
echo "  3. Edit ~/Research/ClaudeManager/.env with your config"
echo "  4. Set agent-manager-key: echo 'KEY' > ~/.claude/agent-manager-key"
echo "  5. REBOOT the machine (for Nvidia drivers to take effect)"
echo ""
echo "After reboot, verify with:"
echo "  nvidia-smi"
echo "  docker run hello-world"
echo "  claude --version"
