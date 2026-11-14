#!/bin/bash
set -euo pipefail
echo "=== 04b: x11vnc at boot (login screen + desktop) over Tailscale ==="
# Run with sudo. Installs x11vnc as a SYSTEM service so AVNC can reach the
# machine straight after a reboot, before anyone logs in at the keyboard.
#
# Why not a user service: before login, display :0 is the LightDM login screen,
# owned by root with its auth cookie in /var/run/lightdm/root/:0. A user-level
# x11vnc gets "-auth guess: failed for display=':0'", retries forever and never
# opens port 5900 (2026-11-14: tower rebooted, no remote access until someone
# logged in at the desk). Running as root with the X server's own -auth file
# works on the login screen and keeps working on the desktop after login.
#
# Replaces (and disables) the user-level x11vnc.service from 04-tailscale.sh.

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi
command -v x11vnc >/dev/null || { echo "x11vnc not installed (run 04-tailscale.sh first)" >&2; exit 1; }

TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || true)}"
[ -n "$TARGET_USER" ] && [ "$TARGET_USER" != root ] || { echo "Run via sudo from your own account" >&2; exit 1; }
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
TARGET_UID=$(id -u "$TARGET_USER")

# VNC password: reuse the user's existing one, readable by root only.
if [ ! -f "$TARGET_HOME/.vnc/passwd" ]; then
  echo "No VNC password at $TARGET_HOME/.vnc/passwd — create one first: x11vnc -storepasswd" >&2
  exit 1
fi
install -m 600 -o root -g root "$TARGET_HOME/.vnc/passwd" /etc/x11vnc.passwd

cat > /usr/local/sbin/x11vnc-tailnet <<'EOF'
#!/bin/bash
# Started by x11vnc.service. Shares X display :0 (the login screen before
# login, the desktop after) on this host's tailnet address only.
set -u
until [ -S /tmp/.X11-unix/X0 ]; do sleep 1; done
# Resolve the tailnet IP at start, never hardcode it: it changes when Tailscale
# is re-authed, and x11vnc bound to a stale address is unreachable.
until addr=$(tailscale ip -4 2>/dev/null | head -1) && [ -n "$addr" ] \
      && ip -4 addr show tailscale0 2>/dev/null | grep -q "inet $addr/"; do
  sleep 1
done
# The X server's own auth file, from its command line (LightDM: /var/run/lightdm/root/:0).
until auth=$(ps -C Xorg -o args= | sed -n 's/.* -auth \([^ ]*\).*/\1/p' | head -1) \
      && [ -n "$auth" ] && [ -r "$auth" ]; do
  sleep 1
done
# No -loop: when X restarts (logout) x11vnc exits and systemd starts it again,
# which re-resolves the address and auth file.
# -listen covers IPv4 only: without -noipv6 AND -rfbportv6 -1, libvncserver
# also listens on [::]:5900 on EVERY interface (LAN included).
exec /usr/bin/x11vnc -display :0 -auth "$auth" -forever -noxdamage \
  -rfbauth /etc/x11vnc.passwd -rfbport 5900 -listen "$addr" -noipv6 -rfbportv6 -1 -shared
EOF
chmod 755 /usr/local/sbin/x11vnc-tailnet

cat > /etc/systemd/system/x11vnc.service <<'EOF'
[Unit]
Description=x11vnc - share display :0 (login screen and desktop) over Tailscale
After=tailscaled.service display-manager.service
Wants=tailscaled.service
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=/usr/local/sbin/x11vnc-tailnet
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Retire the user-level service so the two never fight over port 5900.
runuser -u "$TARGET_USER" -- env XDG_RUNTIME_DIR="/run/user/$TARGET_UID" \
  systemctl --user disable --now x11vnc.service 2>/dev/null || true

systemctl daemon-reload
systemctl enable x11vnc.service
systemctl restart x11vnc.service

for _ in $(seq 1 30); do
  if ss -tln | grep -q ':5900 '; then
    echo ""
    echo "✓ x11vnc is listening on $(tailscale ip -4 | head -1):5900 and will start on every boot."
    echo "  Connect AVNC to $(hostname) port 5900 (same VNC password as before)."
    exit 0
  fi
  sleep 1
done
echo "x11vnc did not open port 5900 within 30s. Check: journalctl -u x11vnc -n 30" >&2
exit 1
