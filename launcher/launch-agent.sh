#!/bin/bash
# Linux equivalent of launch-agent.bat
# Usage: launch-agent.sh <folder_path>
cd "$1"
exec claude --dangerously-skip-permissions "run /session-init and then await instructions"
