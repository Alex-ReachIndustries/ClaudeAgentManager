#!/bin/bash
set -euo pipefail
echo "=== 05: Desktop Apps (Chrome, Slack, Steam + Steam Link tuning) ==="

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
if ! command -v steam &>/dev/null; then
  sudo dpkg --add-architecture i386
  if ! grep -qhs "multiverse" /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null; then
    sudo add-apt-repository -y multiverse
  fi
  sudo apt-get update -y
  echo "steam steam/question select I AGREE" | sudo debconf-set-selections
  echo "steam steam/license note ''" | sudo debconf-set-selections
  sudo apt-get install -y steam-installer
fi
echo "Steam: installed"

# --- Hardware video encoder support (THE biggest cause of Steam Link lag/black-screen) ---
# Without a working encoder, Steam falls back to libx264 on CPU which stutters at 1080p+.
# We install VAAPI (Intel/AMD) + Vulkan tooling unconditionally; NVENC comes from the
# Nvidia proprietary driver if present.
echo "Installing hardware video encoding stack..."
sudo apt-get install -y \
  vainfo libva2 libva-drm2 libva-x11-2 \
  intel-media-va-driver-non-free \
  mesa-va-drivers \
  vdpau-driver-all libvdpau-va-gl1 \
  vulkan-tools mesa-vulkan-drivers \
  libvulkan1 libvulkan1:i386

# Detect GPU and report
GPU_INFO="$(lspci -nn 2>/dev/null | grep -Ei 'vga|3d|display' || true)"
echo "Detected GPU(s):"
echo "$GPU_INFO"

if echo "$GPU_INFO" | grep -qi nvidia; then
  echo ""
  echo "WARNING: Nvidia GPU detected. Steam Link uses NVENC for hardware encoding."
  echo "Make sure the proprietary Nvidia driver is installed (NOT nouveau)."
  if command -v nvidia-smi &>/dev/null; then
    nvidia-smi --query-gpu=driver_version,name --format=csv,noheader 2>/dev/null \
      || echo "  nvidia-smi present but no driver loaded — install via Driver Manager and reboot."
  else
    echo "  nvidia-smi not found. On Mint: open 'Driver Manager' from the menu, pick the recommended Nvidia driver, apply, reboot."
    echo "  On Ubuntu: 'Software & Updates' -> 'Additional Drivers' tab."
  fi
fi

# Verify VAAPI works for Intel/AMD
if echo "$GPU_INFO" | grep -qiE 'intel|amd|radeon'; then
  echo ""
  echo "Verifying VAAPI hardware encode/decode (Intel/AMD):"
  vainfo 2>&1 | grep -E 'Driver version|VAProfile.*Enc|H264.*Enc' | head -10 \
    || echo "  vainfo not yet ready — run 'vainfo' after reboot to verify."
fi

# --- Network tuning for streaming ---
# Steam Remote Play uses high-bitrate UDP. The default Linux UDP buffer sizes
# (208 KB on Ubuntu/Mint) are too small for 50+ Mbps streaming and cause
# stuttering / "stream lag" warnings. Bump them.
echo ""
echo "Tuning network buffers for low-latency streaming..."
SYSCTL_FILE="/etc/sysctl.d/99-steam-link.conf"
sudo tee "$SYSCTL_FILE" > /dev/null <<'EOF'
# Steam Remote Play / Steam Link tuning — larger UDP buffers for high-bitrate streams
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
# Reduce IP fragmentation timeout so dropped packets don't pile up
net.ipv4.ipfrag_time = 30
EOF
sudo sysctl --system | grep -E 'rmem_max|wmem_max' | head -2

# --- Steam Link / Remote Play firewall rules ---
# 27031-27036 TCP/UDP for client/host streaming protocol; 27000-27100 UDP for game traffic.
# Multicast 255.255.255.255:27036 is used for LAN auto-discovery.
if command -v ufw &>/dev/null && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo ufw allow 27031:27036/tcp comment 'Steam Remote Play (Steam Link)'
  sudo ufw allow 27031:27036/udp comment 'Steam Remote Play (Steam Link)'
  sudo ufw allow 27000:27100/udp comment 'Steam game traffic'
  echo "ufw: opened 27000-27100 UDP and 27031-27036 TCP/UDP for Steam Remote Play"
else
  echo "ufw inactive — no firewall rules needed for Steam Link"
fi

# --- Steam Link diagnostics helper ---
# Drop a small script in PATH the user can run from the Steam Link host any time
# to verify the streaming setup before pairing.
sudo tee /usr/local/bin/steam-link-check >/dev/null <<'EOF'
#!/bin/bash
# Quick check: are the bits Steam Link needs in place?
echo "=== Steam Link host check ==="
echo
echo "[1/5] Display server:"
echo "  XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unknown}"
[ "${XDG_SESSION_TYPE:-}" = "wayland" ] && echo "  WARNING: Wayland session — Steam Remote Play has known issues. Log out and pick an X11/Cinnamon session."
echo
echo "[2/5] Hardware encoder:"
if command -v nvidia-smi &>/dev/null && nvidia-smi -q 2>/dev/null | grep -q 'Driver Version'; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
  echo "  → NVENC available (Nvidia proprietary driver)"
elif command -v vainfo &>/dev/null; then
  vainfo 2>&1 | grep -E 'Driver version|VAProfileH264.*VAEntrypointEncSlice' | head -5
else
  echo "  WARNING: no hardware encoder detected — streaming will fall back to CPU encode"
fi
echo
echo "[3/5] UDP buffer sizes (need >=8 MB):"
sysctl net.core.rmem_max net.core.wmem_max
echo
echo "[4/5] Streaming ports (should NOT be blocked):"
if command -v ufw &>/dev/null; then
  sudo ufw status 2>/dev/null | grep -E '2703[1-6]|2700' || echo "  ufw inactive or no rules — fine"
else
  echo "  ufw not installed — fine"
fi
echo
echo "[5/5] Network — same subnet as the TV?"
ip -4 addr show | grep -E 'inet ' | grep -v '127.0.0.1'
echo "  (Steam Link auto-discovery only works on the same broadcast domain.)"
echo
echo "Done. If anything above shows a WARNING, fix it before pairing."
EOF
sudo chmod +x /usr/local/bin/steam-link-check

echo ""
echo "✓ Chrome, Slack, Steam, hardware encoders, and network tuning installed"
echo ""
echo "STEAM LINK SETUP (manual, on the TV):"
echo "  1. Launch Steam on this desktop and sign in"
echo "  2. Run: steam-link-check  (verifies the host side is ready)"
echo "  3. Steam → Settings → Remote Play → enable 'Remote Play'"
echo "  4. Steam → Settings → Remote Play → Advanced Host Options:"
echo "       - Enable hardware encoding ✓"
echo "       - Encoder: NVENC (Nvidia) or VAAPI (Intel/AMD) — NOT software"
echo "       - Bandwidth limit: Automatic (or match your LAN)"
echo "  5. Steam → Settings → Remote Play → 'Pair Steam Link' for the PIN"
echo "  6. On the TV's Steam Link app, enter the PIN"
echo ""
echo "Streaming tips if you still see stutter/lag:"
echo "  - Run 'steam-link-check' first — it surfaces the usual culprits"
echo "  - Pick an X11 session at login (NOT Wayland) — 'Cinnamon' on Mint, not 'Cinnamon (Wayland)'"
echo "  - If on Nvidia: install proprietary driver via Driver Manager (the Mesa one doesn't have NVENC)"
echo "  - Ethernet on both ends if possible; if TV is on Wi-Fi, force it to 5 GHz, same AP as desktop"
echo "  - In Steam Link app on TV: Settings → Streaming → set bandwidth manually (Fast/Balanced)"
