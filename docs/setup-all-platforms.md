# Setup — Windows, macOS & Linux

How to run the Claude Agent Manager on any platform, connect to it locally and remotely (Tailscale), and reach it from an iPhone. For a non-technical walkthrough, use the friendly user-guide PDF from the latest release instead.

The Manager itself (backend, frontend, MQTT, PDF service) runs in **Docker** and is identical on every OS. The **host launcher** (which spawns/resumes Claude terminal sessions) runs natively and is platform-specific.

---

## 1. Prerequisites (all platforms)

- **Docker** — Docker Desktop (Windows/macOS) or Docker Engine + Compose plugin (Linux). Must be running.
- **Git** — to clone the repo (or download the release ZIP).
- **Node.js 20+** — only needed on the machine that runs the host launcher.
- ~2 GB free disk.

## 2. Get the code

```bash
git clone https://github.com/Alex-ReachIndustries/ClaudeAgentManager.git
cd ClaudeAgentManager
```
(Or download the "Source code (zip)" from the latest [release](https://github.com/Alex-ReachIndustries/ClaudeAgentManager/releases) and unzip it.)

## 3. Start the stack (identical everywhere)

```bash
docker compose up -d
```
Verify: `curl http://localhost:8080/api/health` → `{"status":"ok"}`

Reveal your **access key** (paste it into the dashboard the first time):
```bash
docker compose logs backend | grep "API Key"
```

### Platform notes for the stack
- **Windows** — install **Docker Desktop**, launch it, wait until it reports *Running*, then run the command in **PowerShell** from the repo folder (Shift + right-click the folder in Explorer → "Open PowerShell window here"). Keep Docker Desktop's WSL2 backend enabled.
- **macOS** — install Docker Desktop; run the command in Terminal.
- **Linux** — install Docker Engine + the `docker-compose-plugin`; run the command in a terminal (add your user to the `docker` group or use `sudo`).

## 4. Host launcher (spawning/resuming agents)

The launcher runs **natively on the host** (not in Docker) so it can open real Claude terminal sessions. Only needed if you launch/resume agents from the dashboard.

- **Windows** (primary): `node launcher\launcher.js` — or run hidden in the background:
  ```powershell
  Start-Process -FilePath 'node' -ArgumentList 'launcher\launcher.js' -WindowStyle Hidden
  ```
  The launcher generates `.bat`/`.ps1` spawn scripts on Windows.
- **macOS / Linux**: `cd launcher && node launcher.js` (it generates `.sh` spawn scripts and uses `tmux` windows).

---

## 5. Accessing the dashboard

### Locally (on the server machine)
`http://localhost:8080` — `localhost` only works **on the server itself**.

### From another device on the same Wi-Fi
Use the server's LAN IP: `http://<192.168.x.x>:8080`.

### From anywhere (recommended) — Tailscale

> ⚠️ **Tailscale must be set up with a PERSONAL email — NOT a `reach.industries` email.**
> A reach.industries login lands you on a different, org-managed tailnet where your devices can't see each other. Sign the server **and** every client into the **same personal account** (personal email / Google / GitHub).

1. Install Tailscale on the server (`winget install Tailscale.Tailscale` on Windows, or [tailscale.com/download](https://tailscale.com/download)) and on each client/phone.
2. Sign every device into the **same personal Tailscale account** (see the warning above).
3. Get the server's Tailscale address: `tailscale ip -4` → a `100.x.y.z` address (or read it in the Tailscale app / admin console).
4. Reach the UI at `http://<100.x.y.z>:8080`. For trusted HTTPS instead, run `tailscale serve --bg 8080` on the server and use `https://<host>.<tailnet>.ts.net`.

### From an iPhone
1. Install the **Tailscale** app on the iPhone and sign into the **same personal account** as the server.
2. In **Safari**, open `http://<server 100.x.y.z address>:8080` (NOT `localhost`).
3. Paste the access key once; then **Share → Add to Home Screen** for an app-like icon. The mobile web UI mirrors the Android app (bottom tabs). Works on Wi-Fi or cellular, anywhere.

(Android users can instead install the companion APK from the latest release.)

---

## 6. What's new (v7)

- **Knowledge Hub** (`/api/kb/*`) — shared, searchable knowledge the agents consult and contribute to: hybrid semantic+keyword search, approval queue, people profiles, category tree, proactive retrieval, a **knowledge-wanted** backlog for gaps, and an **Insights** analytics view. Human searches from the UI/app are tagged as `user`.
- **Context hygiene** — agents compact-on-idle and keep pointer-only summaries, re-fetching from the KB on demand.
- **Model tiers** — `opus`/`sonnet` resolve centrally to the current latest (Opus 5 / Sonnet 5).
