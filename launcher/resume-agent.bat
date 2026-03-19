@echo off
cd /d "%~1"
claude --dangerously-skip-permissions --resume %2 "run /session-resume and then await instructions"
