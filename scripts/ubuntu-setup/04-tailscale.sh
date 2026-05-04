#!/bin/bash
set -euo pipefail
echo "=== 04: Tailscale + Remote Desktop (x11vnc over Tailscale) ==="
# Installs Tailscale, plus x11vnc so you can attach to the live Ubuntu desktop
# session from another device (e.g. AVNC on Android) over the tailnet.
# x11vnc shares the EXISTING X session — no separate display, no screen lock issues.

# --- Tailscale ---
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
sudo systemctl enable tailscaled
sudo systemctl start tailscaled

# --- x11vnc ---
sudo apt-get update -y
sudo apt-get install -y x11vnc xdotool

# Create a VNC password (used by AVNC client)
# Default password is "vncpass" — CHANGE THIS by re-running x11vnc -storepasswd
VNC_PASSFILE="$HOME/.vnc/passwd"
if [ ! -f "$VNC_PASSFILE" ]; then
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "vncpass" "$VNC_PASSFILE"
  echo "WARNING: VNC password set to 'vncpass' — change it with: x11vnc -storepasswd <new> $VNC_PASSFILE"
fi

# Systemd user service so x11vnc starts at login and survives across reconnects.
# Bound to tailscale0 interface so it's only reachable over the tailnet, not LAN.
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/x11vnc.service" <<EOF
[Unit]
Description=x11vnc — share active X session over Tailscale
After=graphical-session.target tailscaled.service
PartOf=graphical-session.target

[Service]
Type=simple
# -display :0       share display 0 (the active desktop session)
# -auth guess       auto-detect the running X auth file
# -forever / -loop  don't exit on disconnect; restart if X restarts
# -noxdamage        more reliable on modern compositors
# -rfbauth <file>   require VNC password
# -listen <iface>   only accept connections on tailscale0
ExecStart=/usr/bin/x11vnc -display :0 -auth guess -forever -loop -noxdamage -rfbauth %h/.vnc/passwd -rfbport 5900 -listen tailscale0 -shared
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF

# Enable lingering so user services run without an active login session
sudo loginctl enable-linger "$USER"

systemctl --user daemon-reload
systemctl --user enable x11vnc.service
# Don't start now — x11vnc needs a live X session. It will auto-start at desktop login.

echo ""
echo "✓ Tailscale + x11vnc installed"
echo ""
echo "NEXT STEPS (manual):"
echo "  1. Authenticate Tailscale:  sudo tailscale up"
echo "     Open the URL shown to log into your tailnet."
echo "  2. Find this machine's tailnet name: tailscale status"
echo "  3. After you log into the Ubuntu desktop GUI, x11vnc starts automatically."
echo "  4. CHANGE the default VNC password ('vncpass'):"
echo "        x11vnc -storepasswd <newpassword> ~/.vnc/passwd"
echo "        systemctl --user restart x11vnc"
echo "  5. On Android, install AVNC (F-Droid or Play Store) and connect to:"
echo "        host:     <machine-name>.<your-tailnet>.ts.net"
echo "        port:     5900"
echo "        password: (whatever you set)"
echo ""
echo "Notes:"
echo "  - x11vnc shares the LIVE desktop session — same as sitting at the keyboard."
echo "  - Listening only on tailscale0, so it's not exposed on LAN/WAN."
