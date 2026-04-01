@echo off
REM ClaudeManager Startup Script
REM Runs on Windows boot via Task Scheduler
REM Starts: Docker services, Launcher, and Cam (system manager agent)

echo [%time%] ClaudeManager startup beginning...

REM Wait for Docker Desktop to be ready
echo [%time%] Waiting for Docker Desktop...
:wait_docker
docker info >nul 2>&1
if errorlevel 1 (
    timeout /t 10 /nobreak >nul
    goto wait_docker
)
echo [%time%] Docker is ready.

REM Start the Docker Compose stack
echo [%time%] Starting Docker services...
cd /d C:\Users\kuron\Research\ClaudeManager
docker compose up -d

REM Wait for backend to be healthy
echo [%time%] Waiting for backend health...
:wait_backend
curl -s http://localhost:3001/api/health >nul 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak >nul
    goto wait_backend
)
echo [%time%] Backend healthy.

REM Start the launcher in background
echo [%time%] Starting launcher...
start /min "ClaudeManager Launcher" cmd /c "cd /d C:\Users\kuron\Research\ClaudeManager\launcher && node launcher.js"

REM Wait a moment for launcher to initialize
timeout /t 5 /nobreak >nul

REM Launch Cam — the system manager agent
echo [%time%] Launching Cam (system manager agent)...
start "Cam - System Manager" wt.exe new-tab --title "Cam - System Manager" -d "C:\Users\kuron\Research\ClaudeManager" cmd /k claude --dangerously-skip-permissions "You are Cam, the ClaudeManager system manager agent. Run /session-init then begin your duties: monitor all running agents, keep system resources tidy, ensure project managers are alive and responsive, and post a status report to the session manager every 15 minutes covering: running agents, system load (CPU/disk), any issues detected. Your title should be 'Cam — System Manager'."

echo [%time%] ClaudeManager startup complete.
