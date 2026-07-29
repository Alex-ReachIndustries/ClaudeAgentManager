<#
  ClaudeManager — turnkey installer for Windows (PowerShell)

  Gets a FRESH Windows 10/11 machine running the Claude Agent Manager end to end:
    winget-installs Docker Desktop, Node.js, Git and Claude Code -> clones the
    repo -> brings the stack up -> shows the API key the backend generates ->
    walks the Claude login, registers the launcher to run at logon, and
    (optionally) sets up Tailscale for remote access.

  LEAN on purpose (only what the Manager needs). IDEMPOTENT (safe to re-run).

  NOTE: v1 — authored against a real Win11 24H2 baseline but pending live
  validation on the MSI test box. The Docker Desktop step needs a human to
  launch the app + reboot once.

  Usage (in PowerShell, from anywhere):
    powershell -ExecutionPolicy Bypass -File install-windows.ps1
    powershell -ExecutionPolicy Bypass -File install-windows.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$InstallDir = "$env:USERPROFILE\ClaudeAgentManager",
  [string]$RepoUrl    = "https://github.com/Alex-ReachIndustries/ClaudeAgentManager.git"
)

$ErrorActionPreference = 'Stop'

function Step($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m){   Write-Host "    [ok] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "    [!] $m" -ForegroundColor Yellow }
function Fail($m){ Write-Host "ERROR: $m" -ForegroundColor Red }
function Run($desc, $script){
  if($DryRun){ Write-Host "    [dry-run] $desc" -ForegroundColor DarkGray }
  else { & $script }
}
function Have($cmd){ [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
Step "Preflight checks"
if($DryRun){ Warn "DRY RUN — no changes will be made" }
if(-not (Have winget)){
  Fail "winget (App Installer) not found. Install 'App Installer' from the Microsoft Store, then re-run."
  exit 1
}
Ok "winget present ($(winget --version 2>$null))"

# winget helper — installs by id if the command isn't already present
function Winget-Ensure($cmdName, $wingetId, $label){
  if(Have $cmdName){ Ok "$label already installed"; return }
  Run "winget install --id $wingetId" { winget install --id $wingetId --silent --accept-package-agreements --accept-source-agreements -e | Out-Host }
  Ok "$label installed"
}

# ---------------------------------------------------------------------------
# 1. Git, Node.js
# ---------------------------------------------------------------------------
Step "Git"
Winget-Ensure git   "Git.Git"          "Git"
Step "Node.js (LTS)"
Winget-Ensure node  "OpenJS.NodeJS.LTS" "Node.js"

# ---------------------------------------------------------------------------
# 2. Claude Code CLI  (npm global — installs to %USERPROFILE%\.local\bin\claude.exe)
# ---------------------------------------------------------------------------
Step "Claude Code CLI"
if(Have claude){ Ok "Claude Code already installed ($(claude --version 2>$null))" }
else {
  Run "npm install -g @anthropic-ai/claude-code" { npm install -g '@anthropic-ai/claude-code' | Out-Host }
  Ok "Claude Code installed"
  Warn "claude.exe installs under %USERPROFILE%\.local\bin — the hardened launcher resolves it by absolute path, but if you run 'claude' manually and it's not found, add that folder to PATH."
}

# ---------------------------------------------------------------------------
# 3. Docker Desktop  (needs a launch + usually a reboot on first install)
# ---------------------------------------------------------------------------
Step "Docker Desktop"
$dockerReady = (Have docker) -and $((try { docker compose version *> $null; $true } catch { $false }))
if($dockerReady){ Ok "Docker + Compose already installed ($(docker --version 2>$null))" }
else {
  Winget-Ensure docker "Docker.DockerDesktop" "Docker Desktop"
  Warn "Docker Desktop needs to be LAUNCHED once (and usually a REBOOT for WSL2). Start Docker Desktop, wait until it says 'running', then re-run this script — it continues from here."
  if(-not $DryRun){
    $up = $false
    for($i=0; $i -lt 40; $i++){ try { docker info *> $null; $up = $true; break } catch {}; Start-Sleep 3 }
    if(-not $up){ Fail "Docker engine not up yet. Launch Docker Desktop (reboot if prompted), then re-run this script."; exit 1 }
  }
  Ok "Docker engine up"
}

# ---------------------------------------------------------------------------
# 4. Clone / update the repo
# ---------------------------------------------------------------------------
Step "ClaudeManager source -> $InstallDir"
if(Test-Path (Join-Path $InstallDir '.git')){
  Ok "repo present — pulling latest"
  Run "git -C `"$InstallDir`" pull --ff-only" { git -C $InstallDir pull --ff-only | Out-Host }
} else {
  Run "git clone $RepoUrl `"$InstallDir`"" { git clone $RepoUrl $InstallDir | Out-Host }
  Ok "cloned"
}

# ---------------------------------------------------------------------------
# 5. Bring the stack up
# ---------------------------------------------------------------------------
Step "Starting the Manager (docker compose up -d --build)"
Run "docker compose up -d --build (in $InstallDir)" { Push-Location $InstallDir; docker compose up -d --build | Out-Host; Pop-Location }
if(-not $DryRun){
  Step "Waiting for the backend to become healthy"
  $ok = $false
  for($i=0; $i -lt 40; $i++){
    try { if((Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 3).status -eq 'ok'){ $ok = $true; break } } catch {}
    Start-Sleep 3
  }
  if($ok){ Ok "backend healthy on :3001, dashboard on :8080" } else { Fail "backend not healthy — check: docker compose logs backend"; exit 1 }
}

# ---------------------------------------------------------------------------
# 6. Retrieve the generated API key
# ---------------------------------------------------------------------------
Step "Your API key"
$claudeDir = Join-Path $env:USERPROFILE '.claude'
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
$apiKey = $null
if(-not $DryRun){
  Push-Location $InstallDir
  $logs = (docker compose logs backend 2>$null | Out-String)
  Pop-Location
  $m = [regex]::Match($logs, 'API Key[^:]*:\s*([a-f0-9]{64})')
  if($m.Success){
    $apiKey = $m.Groups[1].Value
    Set-Content -Path (Join-Path $claudeDir 'agent-manager-key') -Value $apiKey -NoNewline
    Set-Content -Path (Join-Path $claudeDir 'agent-server-url') -Value 'http://localhost:3001' -NoNewline
    Ok "saved to ~\.claude\agent-manager-key"
  } else {
    Warn "couldn't auto-read the key. Get it with:  docker compose logs backend | Select-String 'API Key'"
  }
} else { Ok "[dry-run] would read the generated key from backend logs and save it" }

# ---------------------------------------------------------------------------
# 7. Register the host launcher to run at logon (so agents survive reboots)
# ---------------------------------------------------------------------------
Step "Launcher auto-start at logon"
$launcherJs = Join-Path $InstallDir 'launcher\launcher.js'
# Run in the USER's interactive session (needed for wt.exe / a live desktop), 30s after logon
# to let Docker Desktop + the desktop shell come up (the hardened launcher also waits internally).
$action  = "cmd /c node `"$launcherJs`""
Run "register Scheduled Task 'ClaudeManager-Launcher' (logon, user context)" {
  $act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c node `"$launcherJs`""
  $trg = New-ScheduledTaskTrigger -AtLogOn
  $trg.Delay = 'PT30S'
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName 'ClaudeManager-Launcher' -Action $act -Trigger $trg -Settings $set -RunLevel Limited -Force | Out-Null
}
Ok "launcher will start at logon (also start it now with:  node `"$launcherJs`")"

# ---------------------------------------------------------------------------
# 8. Optional: Tailscale
# ---------------------------------------------------------------------------
Step "Remote access via Tailscale (optional)"
$wantTs = 'n'
if(-not $DryRun){ $wantTs = Read-Host "Set up Tailscale for phone access? [y/N]" }
if($wantTs -match '^(y|Y)'){
  Winget-Ensure tailscale "tailscale.tailscale" "Tailscale"
  Warn "IMPORTANT: sign in with a PERSONAL email (not a work/org email) or your phone won't see this machine."
  Run "tailscale up" { tailscale up | Out-Host }
  Run "tailscale serve --bg 8080" { tailscale serve --bg 8080 | Out-Host }
  Ok "Tailscale serving the dashboard. Find your address with 'tailscale status'."
} else { Ok "skipped (you can run this later)" }

# ---------------------------------------------------------------------------
# 9. Final walkthrough
# ---------------------------------------------------------------------------
Step "Almost done — final steps"
Write-Host ""
Write-Host "  ClaudeManager is running." -ForegroundColor Green
Write-Host "  Dashboard:   http://localhost:8080   (paste the API key below on first load)"
if($apiKey){ Write-Host "  API key:     $apiKey" }
Write-Host ""
Write-Host "  To LAUNCH agents from the dashboard:"
Write-Host "    1. Log in to Claude Code (one time, opens a browser):  claude"
Write-Host "    2. The launcher is registered to auto-start at logon; start it now with:"
Write-Host "         node `"$launcherJs`""
Write-Host ""
Write-Host "  A machine that only VIEWS the dashboard (e.g. your phone) needs none of this —"
Write-Host "  just the Tailscale address in a browser."
Write-Host ""
Ok "install-windows.ps1 complete"
