#!/bin/bash
set -euo pipefail
echo "=== 05: Desktop Apps (Chrome, Slack, Steam) ==="

# --- Google Chrome (stable) ---
if ! command -v google-chrome &>/dev/null && ! command -v google-chrome-stable &>/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | \
    sudo gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | \
    sudo tee /etc/apt/sources.list.d/google-chrome.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y google-chrome-stable
fi
echo "Chrome: $(google-chrome --version 2>/dev/null || echo 'install pending')"

# --- Slack desktop ---
if ! command -v slack &>/dev/null; then
  SLACK_DEB="/tmp/slack.deb"
  SLACK_URL="$(curl -fsSL https://slack.com/intl/en-gb/downloads/instructions/ubuntu 2>/dev/null \
    | grep -oE 'https://downloads\.slack-edge\.com/[^\"]+slack-desktop[^\"]+amd64\.deb' \
    | head -1)"
  if [ -z "${SLACK_URL:-}" ]; then
    SLACK_URL="https://downloads.slack-edge.com/desktop-releases/linux/x64/4.39.95/slack-desktop-4.39.95-amd64.deb"
  fi
  echo "Downloading Slack from: $SLACK_URL"
  curl -fsSL "$SLACK_URL" -o "$SLACK_DEB"
  sudo apt-get install -y "$SLACK_DEB"
  rm -f "$SLACK_DEB"
fi
echo "Slack: $(slack --version 2>/dev/null || echo 'installed')"

# --- Steam (with Steam Link / Remote Play support) ---
# Steam needs the multiverse repo + i386 arch for legacy 32-bit libs.
if ! command -v steam &>/dev/null; then
  sudo dpkg --add-architecture i386
  sudo add-apt-repository -y multiverse
  sudo apt-get update -y
  # Pre-accept Steam licence so install is non-interactive
  echo "steam steam/question select I AGREE" | sudo debconf-set-selections
  echo "steam steam/license note ''" | sudo debconf-set-selections
  sudo apt-get install -y steam-installer
fi
echo "Steam: installed"

# --- Steam Link / Remote Play firewall rules ---
# Steam Link uses TCP/UDP 27031–27036. If ufw is active, open them on the LAN.
# (TV needs to be on the same LAN as the desktop for low-latency streaming.)
if command -v ufw &>/dev/null && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo ufw allow 27031:27036/tcp comment 'Steam Remote Play (Steam Link)'
  sudo ufw allow 27031:27036/udp comment 'Steam Remote Play (Steam Link)'
  echo "ufw: opened 27031-27036 for Steam Remote Play"
else
  echo "ufw inactive — no firewall rules needed for Steam Link"
fi

echo ""
echo "✓ Chrome, Slack, Steam installed"
echo ""
echo "STEAM LINK SETUP (manual, on the TV):"
echo "  1. Launch Steam on this Ubuntu desktop and sign in"
echo "  2. Steam → Settings → Remote Play → enable 'Remote Play'"
echo "  3. Steam → Settings → Remote Play → 'Pair Steam Link' to get a PIN"
echo "  4. On the TV's Steam Link app, enter the PIN to pair"
echo "  5. Make sure desktop + TV are on the same LAN (ethernet preferred — ✓)"
echo ""
echo "Notes:"
echo "  - First Steam launch will pull a runtime — let it finish before pairing."
echo "  - For best performance: ethernet on both ends + 5GHz WiFi for the TV."
