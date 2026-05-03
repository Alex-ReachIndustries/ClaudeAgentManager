# Ubuntu 24.04 LTS — ClaudeManager Setup Guide

> New desktop setup guide for moving ClaudeManager from Windows to Ubuntu 24.04 LTS.

---

## 1. Install Ubuntu 24.04 LTS

**Download the ISO:**
https://releases.ubuntu.com/24.04/ubuntu-24.04.2-desktop-amd64.iso

**Create bootable USB (from Windows, using Rufus):**
1. Download Rufus: https://rufus.ie
2. Insert USB (≥8GB), open Rufus
3. Select the ubuntu ISO, leave defaults (GPT + UEFI), click Start
4. Boot from USB, choose "Install Ubuntu", follow the installer

---

## 2. First-boot system updates

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git tmux gnome-terminal xdotool build-essential
```

---

## 3. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should be v20.x
```

---

## 4. Install Docker Engine

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker     # or log out and back in
docker --version
```

---

## 5. Install PM2

```bash
sudo npm install -g pm2
pm2 startup systemd -u $USER --hp $HOME
# Run the printed systemctl command as root, e.g.:
#   sudo systemctl enable pm2-<username>
```

---

## 6. Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

---

## 7. Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Authenticate in the browser when prompted
tailscale ip -4   # note the IP — add to agent-server-url if needed
```

---

## 8. Transfer ClaudeManager

Option A — clone from GitHub (if the repo is pushed):
```bash
git clone https://github.com/your-org/ClaudeManager.git ~/ClaudeManager
```

Option B — copy from Windows over network:
```bash
# From Windows (Git Bash):
scp -r /c/Users/kuron/Research/ClaudeManager user@new-desktop:~/ClaudeManager
```

---

## 9. Configure credentials

```bash
mkdir -p ~/.claude

# Agent server URL (your Tailscale address or localhost)
echo "https://msi.tail06903c.ts.net" > ~/.claude/agent-server-url

# API key — copy from Windows machine:
#   Windows: type C:\Users\kuron\.claude\agent-manager-key
echo "your-api-key-here" > ~/.claude/agent-manager-key

# Anthropic API key
echo "export ANTHROPIC_API_KEY=sk-ant-..." >> ~/.bashrc
source ~/.bashrc
```

---

## 10. Start Docker services

```bash
cd ~/ClaudeManager
docker compose up -d
# Wait for backend health:
until curl -s http://localhost:3001/api/health; do sleep 3; done
echo "Backend ready"
```

---

## 11. Configure PM2 for launcher + watchdog

```bash
cd ~/ClaudeManager

# Start launcher
pm2 start launcher/launcher.js --name agent-launcher

# Start watchdog
pm2 start scripts/watchdog.js --name watchdog

# Save PM2 process list for auto-start on reboot
pm2 save
```

---

## 12. Configure auto-start on login

The systemd user service (`scripts/claude-manager-launcher.service`) handles startup.

```bash
mkdir -p ~/.config/systemd/user

# Create the service (replace USERNAME with your actual username)
sudo sed "s/%i/$USER/g" ~/ClaudeManager/scripts/claude-manager-launcher.service \
    > ~/.config/systemd/user/claude-manager.service

systemctl --user daemon-reload
systemctl --user enable claude-manager.service
systemctl --user start claude-manager.service

# Check status
systemctl --user status claude-manager.service
```

Alternatively, use the startup script directly:
```bash
chmod +x ~/ClaudeManager/scripts/startup.sh
# Add to ~/.config/autostart or call from ~/.profile:
~/ClaudeManager/scripts/startup.sh &
```

---

## 13. Verify the launcher

```bash
# Check launcher log
pm2 logs agent-launcher --lines 20

# It should print:
# [HH:MM:SS] Agent Launcher started — polling ...
# [HH:MM:SS] Platform: Linux
```

---

## 14. Terminal setup (tmux)

On Linux, named window groups use **tmux sessions** instead of Windows Terminal tabs.

```bash
# View all active agent sessions
tmux ls

# Attach to a project's session (e.g. DailyVacancy)
tmux attach -t DailyVacancy

# Navigate between agent tabs within a session
# Ctrl+B then n (next window)  /  p (previous window)
# Ctrl+B then w (window list)

# Detach from session without stopping agents
# Ctrl+B then d
```

---

## 15. Android ADB (for Android app testing)

```bash
sudo apt install -y android-tools-adb
# Enable USB debugging on your phone, then:
adb devices
# Build and install the APK:
cd ~/ClaudeManager/android
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Java/Android SDK are already handled by the Android Gradle plugin — install JDK 17:
```bash
sudo apt install -y openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> ~/.bashrc
```

---

## 16. Key differences from Windows

| Feature | Windows | Linux |
|---------|---------|-------|
| Terminal multiplexer | Windows Terminal (`wt.exe`) | tmux |
| Named window groups | `wt -w <name>` | `tmux new-session -s <name>` |
| Process termination | `taskkill /PID /T /F` | `kill -TERM / -KILL` |
| PID check | PowerShell `Get-Process` | `kill -0 <pid>` |
| Startup | Task Scheduler / startup.bat | systemd user service / startup.sh |
| Launcher mode | Auto-detected (`process.platform`) | Same — `IS_LINUX=true` auto |
| Signal/input | WScript.Shell SendKeys | xdotool (install separately) |

---

## Quick reference paths

| Item | Linux path |
|------|-----------|
| ClaudeManager | `~/ClaudeManager` |
| Claude config | `~/.claude/` |
| Agent server URL | `~/.claude/agent-server-url` |
| API key | `~/.claude/agent-manager-key` |
| PM2 logs | `~/.pm2/logs/` |
| Docker data | Docker named volume `agent-data` |
| Startup script | `~/ClaudeManager/scripts/startup.sh` |
