#!/bin/bash
set -euo pipefail
echo "=== 06: Tailscale ==="

curl -fsSL https://tailscale.com/install.sh | sh

sudo systemctl enable tailscaled
sudo systemctl start tailscaled

echo ""
echo "✓ Tailscale installed"
echo ""
echo "NEXT STEPS (manual):"
echo "1. Run: sudo tailscale up"
echo "2. Open the URL shown to authenticate with your Tailscale account"
echo "3. The machine will appear in your tailnet as a new node"
echo "4. Update ~/.claude/agent-server-url to point to the Tailscale IP/hostname of your backend"
