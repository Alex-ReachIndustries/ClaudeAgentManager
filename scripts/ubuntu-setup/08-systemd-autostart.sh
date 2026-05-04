#!/bin/bash
set -euo pipefail
echo "=== 09: Systemd Auto-Start ==="

REPO_DIR="$HOME/Research/ClaudeManager"
SERVICE_SRC="$REPO_DIR/scripts/claude-manager-launcher.service"
SERVICE_DEST="$HOME/.config/systemd/user/claude-manager.service"

# Create user systemd directory
mkdir -p "$(dirname "$SERVICE_DEST")"

# Copy service file, substituting actual username
sed "s/%i/$USER/g" "$SERVICE_SRC" > "$SERVICE_DEST"

# Enable lingering so user services run without login
sudo loginctl enable-linger "$USER"

# Enable the service
systemctl --user daemon-reload
systemctl --user enable claude-manager.service
systemctl --user start claude-manager.service

echo "Service status:"
systemctl --user status claude-manager.service --no-pager || true

echo ""
echo "✓ ClaudeManager systemd service installed and started"
echo "  Logs: journalctl --user -u claude-manager.service -f"
