# Ubuntu 24.04 / Linux Mint 22 — ClaudeManager Setup Guide

> Fresh-install setup. Works on **Ubuntu 24.04** and **Linux Mint 22** (standard
> Cinnamon/MATE/Xfce — NOT LMDE). Pop!_OS 22.04 also works.
>
> The numbered scripts in `scripts/ubuntu-setup/` do the heavy lifting. The
> whole point of starting with Claude (step 00) is that Claude can drive the
> rest of the setup once it's running.
>
> Distro detection is automatic — `_distro-check.sh` (sourced by each
> script that needs it) maps Mint codenames to their upstream Ubuntu codenames
> for things like the Docker apt repo.

---

## 0. Prerequisites

- Ubuntu 24.04 LTS Desktop ISO: https://releases.ubuntu.com/24.04/
- Wired ethernet connection (recommended — much smoother for Steam Link, Docker pulls, and remote sessions)
- Disk: leave **unencrypted** (this iteration assumes no LUKS — boot reliability and remote unattended access are easier)
- Nvidia drivers: install via Ubuntu's "Additional Drivers" GUI before running these scripts. The old `02-nvidia-drivers.sh` step is **gone** — Ubuntu handles this natively now.

---

## 1. Get the setup scripts onto the box

You have two options:

**A. Direct download (recommended on a fresh OS):**
```bash
mkdir -p ~/ubuntu-setup && cd ~/ubuntu-setup
curl -fsSL -o ubuntu-setup.zip \
  https://github.com/Alex-ReachIndustries/ClaudeAgentManager/raw/main/scripts/ubuntu-setup.zip
unzip ubuntu-setup.zip
chmod +x *.sh
```

**B. From a USB drive containing `ubuntu-setup.zip`:**
```bash
mkdir -p ~/ubuntu-setup && cd ~/ubuntu-setup
unzip /media/$USER/<USB-NAME>/ubuntu-setup.zip
chmod +x *.sh
```

---

## 2. Step 00 — install Claude

```bash
cd ~/ubuntu-setup
bash 00-claude-code.sh
```

This installs Node.js 22 + Claude Code CLI, then seeds:
- `~/.claude/agent-manager-key` with the master key
- `~/.claude/agent-server-url` = `http://localhost:3001`
- `~/.claude/CLAUDE.md` (Ubuntu version)

Then **manually**:
```bash
claude
```
Complete the OAuth login in the browser. You're now at a Claude prompt.

---

## 3. Hand the rest off to Claude

Tell Claude:

> Please run the rest of the Ubuntu setup scripts in `~/ubuntu-setup/` in
> order, starting with `01-github.sh`. Hand control back to me for the
> interactive auth steps (GitHub, Tailscale, Steam, VNC password). Stop
> if anything fails.

Claude will run scripts 01–08, pausing for you when:
- **Step 01 (GitHub):** browser auth via `gh auth login --web`
- **Step 04 (Tailscale):** `sudo tailscale up` and browser auth for the tailnet
- **Step 05 (Steam):** Steam licence agreement (pre-accepted in the script, but first launch wants you to log in)

Or run the master script directly:
```bash
bash 09-run-all.sh
```

---

## 4. What each step does

| # | Script | What it does | Interactive? |
|---|--------|--------------|--------------|
| 00 | `00-claude-code.sh` | Node.js 22, Claude CLI, seed `~/.claude` | OAuth login |
| 01 | `01-github.sh` | git, gh CLI, sets identity | GitHub web auth |
| 02 | `02-system-update.sh` | apt update/upgrade + base tools | No |
| 03 | `03-docker.sh` | Docker CE, compose, user→docker group | No |
| 04 | `04-tailscale.sh` | Tailscale + x11vnc remote desktop service | Tailscale auth |
| 05 | `05-desktop-apps.sh` | Chrome, Slack, Steam (+Steam Link firewall) | No |
| 06 | `06-android-dev.sh` | JDK 17, Android SDK, Gradle 8.2 | No |
| 07 | `07-claude-manager.sh` | Clone repo, set API_KEY in .env, docker compose up | No |
| 08 | `08-systemd-autostart.sh` | Systemd user service for ClaudeManager | No |
| 09 | `09-run-all.sh` | Master runner — runs 01–08 in order | Inherits sub-step prompts |

---

## 5. Post-setup manual bits

### Remote desktop (AVNC on Android over Tailscale)

After step 04 + a desktop login (so x11vnc has an X session to attach to):
1. **Change the default VNC password** (it's currently `vncpass`):
   ```bash
   x11vnc -storepasswd <newpass> ~/.vnc/passwd
   systemctl --user restart x11vnc
   ```
2. On Android, install **AVNC** (F-Droid / Play Store) and connect to:
   - host: `<machine-name>.<your-tailnet>.ts.net`
   - port: `5900`
   - password: whatever you set above

### Steam Link on the TV

After step 05 + you've signed in to Steam at least once:
1. Steam → Settings → Remote Play → enable **Remote Play**
2. Steam → Settings → Remote Play → **Pair Steam Link** → note the PIN
3. On the TV's Steam Link app, enter the PIN
4. Both devices on the same LAN (ethernet on the desktop is ideal — ✓)

### Verify everything

```bash
# Agent manager up?
curl -s http://localhost:3001/api/health    # → {"status":"ok"}

# Systemd service alive?
systemctl --user status claude-manager.service

# Claude can reach the manager?
curl -s -H "Authorization: Bearer $(cat ~/.claude/agent-manager-key)" \
  http://localhost:3001/api/agents
```

---

## 6. Quick reference paths

| Item | Linux path |
|------|-----------|
| ClaudeManager repo | `~/Research/ClaudeManager` |
| Claude config | `~/.claude/` |
| Agent server URL | `~/.claude/agent-server-url` |
| API key | `~/.claude/agent-manager-key` |
| Docker data | `/ClaudeManager/agent-data` |
| Setup scripts | `~/ubuntu-setup/` |
| VNC password | `~/.vnc/passwd` |
| Systemd service | `~/.config/systemd/user/claude-manager.service` |

---

## 7. Differences from the Windows setup

| Feature | Windows | Linux |
|---------|---------|-------|
| Terminal multiplexer | Windows Terminal (`wt.exe`) | tmux |
| Process termination | `taskkill /PID /T /F` | `kill -TERM / -KILL` |
| PID check | PowerShell `Get-Process` | `kill -0 <pid>` |
| Autostart | Task Scheduler / startup.bat | systemd user service |
| Launcher mode | `process.platform` auto-detect | `LAUNCHER_MODE=linux` in `.env` |
| Remote desktop | Windows Remote Desktop | x11vnc + AVNC over Tailscale |
| Send keys | WScript.Shell SendKeys | xdotool |
