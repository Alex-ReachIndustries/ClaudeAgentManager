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

# Enable lingering so user services run without an active login session
sudo loginctl enable-linger "$USER"

# x11vnc as a SYSTEM service, so it is reachable from boot (login screen
# included), not only after someone logs in at the desk. See 04b for why.
# Tailscale is not authed yet on a fresh install, so the service waits for it
# and 04b's port check fails: that is expected here, not an error.
sudo bash "$(dirname "$0")/04b-x11vnc-boot.sh" || echo "(x11vnc will start once Tailscale is up)"

echo ""
echo "✓ Tailscale + x11vnc installed"
echo ""
echo "NEXT STEPS (manual):"
echo "  1. Authenticate Tailscale:  sudo tailscale up"
echo "     Open the URL shown to log into your tailnet."
echo "  2. Find this machine's tailnet name: tailscale status"
echo "  3. x11vnc starts at boot (once Tailscale is up) and shows the login screen until you log in."
echo "  4. CHANGE the default VNC password ('vncpass'):"
echo "        x11vnc -storepasswd <newpassword> ~/.vnc/passwd"
echo "        sudo bash $(dirname "$0")/04b-x11vnc-boot.sh"
echo "  5. On Android, install AVNC (F-Droid or Play Store) and connect to:"
echo "        host:     <machine-name>.<your-tailnet>.ts.net"
echo "        port:     5900"
echo "        password: (whatever you set)"
echo ""
echo "Notes:"
echo "  - x11vnc shares the LIVE screen (login screen or desktop) — same as sitting at the keyboard."
echo "  - Listening only on tailscale0, so it's not exposed on LAN/WAN."
