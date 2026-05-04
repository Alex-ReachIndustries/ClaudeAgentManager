# Instructions for Claude — finish Ubuntu/Mint setup

You are Claude, running on a freshly-installed Ubuntu 24.04 / Linux Mint 22 desktop.
The human has already run `00-claude-code.sh` and `claude` (OAuth login). Now they
want you to drive the rest of the setup. Follow these instructions verbatim.

## Ground rules

1. **Run scripts one at a time.** Wait for each to finish (or fail) before the next.
2. **Only stop and ask the human when an explicit "PROMPT HUMAN" step says so.**
   Sudo password prompts are fine to surface — the human is sitting at the machine.
3. **If a script fails:** post the last 30 lines of its output, your best guess
   at the cause, and wait for the human. Do not retry blindly.
4. **All scripts live in `~/ubuntu-setup/`.** They expect to be run from anywhere.
5. **Verify after every step.** Each step below has a `# verify` line — actually run it.
6. Use the `Bash` tool. Don't use background mode for these — they need to be
   visible so the human can intervene if something goes sideways.

## What you're installing

In order: GitHub CLI + auth → system updates → Docker → Tailscale + x11vnc →
Chrome + Slack + Steam → Android dev tools → ClaudeManager itself → systemd
auto-start. Then you hand back to the human for the manual auth bits that can
only happen in person (Steam login, VNC password change, Steam Link pairing).

## Before you start

Check you're on a supported distro:

```bash
source ~/ubuntu-setup/_distro-check.sh
```

This should print `=== Detected: <Ubuntu/Mint> <version> (Ubuntu base: noble) ===`.
If it prints "Debian detected" or "Mint LMDE", **STOP** and tell the human — these
scripts won't work and they need to reinstall with standard Mint or Ubuntu.

---

## Step 1 — GitHub auth (PROMPT HUMAN)

```bash
bash ~/ubuntu-setup/01-github.sh
```

This opens a browser for OAuth. Tell the human:

> The browser will open the GitHub device-code page. Sign in as
> alex@reach.industries, paste the device code shown in the terminal,
> and authorise. Tell me when you're at the "Logged in as alex" line.

Wait for confirmation. Then verify:

```bash
gh auth status
```

If it shows "Logged in to github.com as alex", continue. Otherwise, stop.

---

## Step 2 — System update (no prompt)

```bash
bash ~/ubuntu-setup/02-system-update.sh
```

This is non-interactive (apt may ask for sudo password — that's expected).
Verify it finished cleanly:

```bash
echo "Last apt errors:"; sudo tail -20 /var/log/apt/history.log
```

---

## Step 3 — Docker (no prompt, but a sudo + group note)

```bash
bash ~/ubuntu-setup/03-docker.sh
```

After it finishes, your shell is NOT yet in the docker group. Verify Docker
can be reached at all:

```bash
sudo docker run --rm hello-world
```

If that prints a "Hello from Docker!" message, continue. The user will need
to log out/in or run `newgrp docker` later for non-sudo docker access — note
this for them in your final message but don't make them do it now.

---

## Step 4 — Tailscale + x11vnc (PROMPT HUMAN for tailnet auth)

```bash
bash ~/ubuntu-setup/04-tailscale.sh
```

The script installs both packages but does NOT join the tailnet. After it finishes:

```bash
sudo tailscale up
```

This will print a URL. Tell the human:

> Tailscale needs a browser login. Open the URL it just printed and authorise
> this machine. Tell me when "tailscale status" shows it as authenticated.

Wait. Then verify:

```bash
tailscale status
```

Must show this machine as `active; relay`. If not, stop and ask.

x11vnc only starts when the user logs into the desktop GUI — don't try to
test it now. Note in your final summary that the human needs to:
- Change the VNC password (current default is `vncpass`)
- Install AVNC on Android and connect to the tailnet name on port 5900

---

## Step 5 — Desktop apps (no prompt)

```bash
bash ~/ubuntu-setup/05-desktop-apps.sh
```

This installs Chrome, Slack, Steam (with Steam Link firewall rules pre-opened).
First-time Steam needs interactive login the first time you run it from the GUI —
that's a manual post-step, not something to do now.

Verify:

```bash
google-chrome --version && slack --version 2>/dev/null || true
which steam
```

All three should resolve.

**Steam Link readiness check.** Run:

```bash
steam-link-check
```

Look at the output for:
- **Display server:** must be X11, NOT Wayland. If Wayland, tell the human to log
  out and pick "Cinnamon" (not "Cinnamon Wayland") at the login screen.
- **Hardware encoder:** must show NVENC (if Nvidia) or VAAPI H264 entrypoint
  (Intel/AMD). If neither, streaming will use CPU encode and be laggy.
- **UDP buffer sizes:** must be ≥ 16 MB (the script sets this — should already be fine).
- **Network:** machine and TV must be on the same `inet` subnet for auto-discovery.

If the encoder check fails on Nvidia, the proprietary driver isn't loaded. Tell
the human: "Open Driver Manager, pick the recommended Nvidia driver, apply, reboot —
then try Steam Link again." Don't try to install the driver yourself; Mint's
Driver Manager handles the kernel module signing for secure boot which is fiddly
to do from the CLI.

If the encoder check fails on Intel/AMD, run `vainfo` directly and capture the
full output — could be a missing va-driver package.

---

## Step 6 — Android dev tools (no prompt, takes a while)

```bash
bash ~/ubuntu-setup/06-android-dev.sh
```

Downloads the Android SDK + Gradle, ~500 MB. Wait for it to finish.

Verify:

```bash
source ~/.bashrc
java -version 2>&1 | head -1
ls $ANDROID_HOME/build-tools/
```

---

## Step 7 — ClaudeManager (no prompt)

```bash
bash ~/ubuntu-setup/07-claude-manager.sh
```

This clones the repo to `~/Research/ClaudeManager`, writes the API key into
`.env`, and brings up the docker compose stack. The script's tail will validate
the API key against the running backend.

Verify:

```bash
curl -s http://localhost:3001/api/health
curl -s -H "Authorization: Bearer $(cat ~/.claude/agent-manager-key)" \
  http://localhost:3001/api/agents | head -c 200
```

First curl must return `{"status":"ok"}`. Second must NOT return
`{"error":"Invalid or missing API key"}` — if it does, the API key in `.env`
isn't matching `~/.claude/agent-manager-key`. Tell the human.

---

## Step 8 — Systemd auto-start (no prompt)

```bash
bash ~/ubuntu-setup/08-systemd-autostart.sh
```

Verify:

```bash
systemctl --user status claude-manager.service --no-pager | head -10
```

Should show `active (running)` or `active (exited)` (it's a `Type=oneshot`
service so "exited" is fine — what matters is the agent manager is alive,
which the previous curl already confirmed).

---

## Step 9 — Reconnect this Claude session to the local agent manager

Right now your `~/.claude/agent-server-url` is set to `http://localhost:3001`.
The agent manager is now actually up. Test that you can reach it:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.claude/agent-manager-key)" \
  http://localhost:3001/api/agents/bootstrap | head -c 100
```

Should start with `{"name":"Agent Manager Bootstrap","version":"3.0"`. If not,
something's off — tell the human.

If you want to restart yourself as a session-managed Claude, you can — but
that's optional and should only happen if the human asks.

---

## Final summary message to the human

Once everything above passes, post a single message saying:

> Setup complete. Remaining manual steps:
> 1. Log out and back in (or run `newgrp docker`) so docker works without sudo
> 2. Change the VNC password: `x11vnc -storepasswd <new> ~/.vnc/passwd && systemctl --user restart x11vnc`
> 3. Install AVNC on Android, connect to `<machine>.<tailnet>.ts.net:5900`
> 4. Launch Steam from the application menu, sign in
> 5. Run `steam-link-check` once Steam is open — confirm encoder + UDP buffers are healthy
> 6. In Steam → Settings → Remote Play → enable Remote Play
>    - Advanced Host Options → enable hardware encoding, encoder = NVENC or VAAPI (NOT software)
> 7. Pair Steam Link from your TV (PIN flow)
> 8. Reboot once to confirm `claude-manager.service` comes up at boot
>
> Agent manager: http://localhost:3001 (also via `<machine>.<tailnet>.ts.net:3001`)
> API key: in `~/.claude/agent-manager-key`
> ClaudeManager repo: `~/Research/ClaudeManager`

---

## If anything fails

1. Capture the last 30–50 lines of output
2. State what you think went wrong
3. **Stop** — do not skip the failed step or hack around it
4. Ask the human what to do

Common failures and fixes:
- **`gh auth login` fails:** browser couldn't reach github → check network / DNS / firewall
- **`docker compose up` fails to pull:** transient registry issue → try once more
- **`tailscale up` URL doesn't open browser:** copy the URL manually into a browser
- **API key mismatch in step 7:** edit `~/Research/ClaudeManager/.env` so `API_KEY=` matches `~/.claude/agent-manager-key`, then `docker compose restart backend`
- **systemd service in `failed` state:** `journalctl --user -u claude-manager.service --no-pager -n 50`

Don't go further down the list while a step is broken — each step assumes the
previous one worked.
