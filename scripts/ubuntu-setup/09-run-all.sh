#!/bin/bash
set -euo pipefail
# Master installer — runs all steps in order.
# Run from the directory containing the scripts:
#   cd ~/ubuntu-setup && bash 09-run-all.sh
#
# Step 00 (Claude install) is intended to be run FIRST, on its own, so that
# Claude itself can drive the rest of the setup under your direction.
# This script runs steps 01–08 once Claude is already up.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_distro-check.sh"

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

# Step 00 should be run manually first — it ends with "now run claude and OAuth".
# If you're running this script you've presumably already done that.
if [ ! -f "$HOME/.claude/agent-manager-key" ]; then
  echo "ERROR: ~/.claude/agent-manager-key not found."
  echo "Run 00-claude-code.sh first, then run 'claude' and complete OAuth login."
  echo "Then come back and run this script."
  exit 1
fi

run_step "01" "github"            # INTERACTIVE: GitHub browser login
run_step "02" "system-update"
run_step "02b" "nvidia"           # No-op if non-Nvidia or driver already loaded
run_step "03" "docker"
run_step "04" "tailscale"         # INTERACTIVE: requires browser auth for tailnet
run_step "05" "desktop-apps"      # Chrome + Slack + Steam
run_step "06" "android-dev"
run_step "07" "claude-manager"
run_step "08" "systemd-autostart"

echo ""
echo "=========================================="
echo "ALL STEPS COMPLETE"
echo "=========================================="
echo ""
echo "Manual steps remaining:"
echo "  1. sudo tailscale up   (if you didn't already)"
echo "  2. Pair Steam Link from your TV (Steam → Settings → Remote Play)"
echo "  3. Connect AVNC on Android to <hostname>.<tailnet>.ts.net:5900"
echo "     (default VNC password is 'vncpass' — CHANGE IT)"
echo "  4. Verify the agent manager: curl -s http://localhost:3001/api/health"
echo "  5. The systemd service should keep ClaudeManager running across reboots:"
echo "     systemctl --user status claude-manager.service"
