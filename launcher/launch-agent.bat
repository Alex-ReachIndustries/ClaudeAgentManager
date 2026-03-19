@echo off
cd /d "%~1"
claude --dangerously-skip-permissions "run /session-init and then await instructions"
