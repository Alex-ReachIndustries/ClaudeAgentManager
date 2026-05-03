#!/bin/bash
# Linux equivalent of resume-agent.bat
# Usage: resume-agent.sh <folder_path> <agent_uuid>
cd "$1"
exec claude --dangerously-skip-permissions --resume "$2" "run /session-resume and then await instructions"
