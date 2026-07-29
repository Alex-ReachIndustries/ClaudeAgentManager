@echo off
REM ClaudeManager Startup Script
REM Runs on Windows login via Task Scheduler (ClaudeManager-Startup)
REM Ensures: Docker services, PM2 (launcher+watchdog), and Cam agent are running

echo [%time%] ClaudeManager startup beginning...

REM NOTE: `ping -n <N+1> 127.0.0.1 >nul` is used below for ~N second delays instead of
REM `timeout /t N`. On this machine, PATH resolves timeout.exe to Git for Windows'
REM coreutils build (C:\Program Files\Git\usr\bin ahead of System32), which rejects the
REM `/t` flag and fails silently — the retry loops below would then spin with no delay
REM at all. `ping` isn't shadowed by any common PATH addition.

REM Wait for Docker Desktop to be ready
echo [%time%] Waiting for Docker Desktop...
:wait_docker
docker info >nul 2>&1
if errorlevel 1 (
    ping -n 11 127.0.0.1 >nul
    goto wait_docker
)
echo [%time%] Docker is ready.

REM Start the Docker Compose stack (idempotent — skips already running)
echo [%time%] Starting Docker services...
cd /d C:\Users\kuron\Research\ClaudeManager
docker compose up -d

REM Wait for backend to be healthy
echo [%time%] Waiting for backend health...
:wait_backend
curl -s http://localhost:3001/api/health >nul 2>&1
if errorlevel 1 (
    ping -n 6 127.0.0.1 >nul
    goto wait_backend
)
echo [%time%] Backend healthy.

REM Wait for the MQTT broker (port 1883) — backend depends on it (docker-compose.yml),
REM and spawning Cam before it accepts connections races the very first connect attempt.
REM Timeout after 120s so a broken/missing broker fails loudly instead of hanging forever.
REM
REM The whole bounded retry loop runs inside ONE PowerShell call rather than a batch
REM goto-loop with a hand-rolled elapsed-seconds counter: tested on this box, a batch
REM counter assuming N seconds per iteration drifted badly from real elapsed time (a
REM closed-port Test-NetConnection attempt alone can take 10+ real seconds, several times
REM longer than assumed), which would make this "120 second" timeout fire at the wrong
REM real-world time. PowerShell's Get-Date/Start-Sleep track real elapsed time directly
REM and aren't subject to the timeout.exe-vs-PATH issue noted above either.
echo [%time%] Waiting for MQTT broker (port 1883)...
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddSeconds(120); while ((Get-Date) -lt $deadline) { if ((Test-NetConnection -ComputerName localhost -Port 1883 -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 }; Start-Sleep -Seconds 3 }; exit 1"
if errorlevel 1 (
    echo [%time%] ERROR: MQTT broker on port 1883 did not become ready within 120 seconds.
    echo [%time%] Check: docker compose ps mqtt / docker compose logs mqtt
    exit /b 1
)
echo [%time%] MQTT broker is ready.

REM Ensure PM2 processes are running (launcher + watchdog)
REM PM2 resurrect is handled by PM2-AgentLauncher scheduled task,
REM but just in case, nudge it here too
echo [%time%] Ensuring PM2 processes...
pm2 resurrect >nul 2>&1

REM Wait a moment for services to initialize
ping -n 6 127.0.0.1 >nul

REM Launch Cam — the system manager agent (only if not already running)
echo [%time%] Launching Cam (system manager agent)...
start "Cam - System Manager" wt.exe new-tab --title "Cam - System Manager" -d "C:\Users\kuron\Research\ClaudeManager" cmd /k claude --dangerously-skip-permissions "You are Cam, the ClaudeManager system manager agent. Run /session-init then begin your duties: monitor all running agents, keep system resources tidy, ensure project managers are alive and responsive, and post a status report to the session manager every 15 minutes covering: running agents, system load (CPU/disk), any issues detected. Your title should be 'Cam — System Manager'."

echo [%time%] ClaudeManager startup complete.
