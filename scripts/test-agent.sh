#!/usr/bin/env bash
# Simulated agent that registers with the Agent Manager, sends diverse updates,
# and polls for pending messages. Used for testing the full system.

set -euo pipefail

API="${API_URL:-http://localhost:3001/api}"
AGENT_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")

echo "=== Test Agent ==="
echo "ID: $AGENT_ID"
echo "API: $API"
echo ""

# Helper to POST an update
post_update() {
  local type="$1"
  local content="$2"
  local summary="$3"
  local title="${4:-}"

  local body
  if [ -n "$title" ]; then
    body=$(printf '{"type":"%s","content":%s,"summary":"%s","title":"%s"}' "$type" "$content" "$summary" "$title")
  else
    body=$(printf '{"type":"%s","content":%s,"summary":"%s"}' "$type" "$content" "$summary")
  fi

  echo "[$(date +%H:%M:%S)] Sending $type update: $summary"
  response=$(curl -s -X POST "$API/agents/$AGENT_ID/updates" \
    -H "Content-Type: application/json" \
    -d "$body")

  # Check for pending messages
  pending=$(echo "$response" | python3 -c "import sys,json; msgs=json.load(sys.stdin).get('pendingMessages',[]); [print(f'  >> Message: {m[\"content\"]}') for m in msgs]" 2>/dev/null || true)
  if [ -n "$pending" ]; then
    echo "$pending"
  fi
}

# 1. Initial registration with title
post_update "status" '{"status":"active","detail":"Agent starting up"}' "Agent initialized and ready" "Test Agent — Code Review"

sleep 2

# 2. Text update
post_update "text" '{"message":"Analyzing repository structure. Found 42 files across 8 directories."}' "Analyzed repo structure: 42 files, 8 dirs"

sleep 2

# 3. Progress update
post_update "progress" '{"percent":25,"description":"Reading source files","current":10,"total":42}' "Reading source files (10/42)"

sleep 2

# 4. Diagram update
post_update "diagram" '{"mermaid":"graph TD\n    A[Main App] --> B[Router]\n    B --> C[Dashboard]\n    B --> D[Agent Detail]\n    C --> E[Agent Cards]\n    D --> F[Timeline]\n    D --> G[Messages]"}' "Generated component dependency diagram"

sleep 2

# 5. Progress update
post_update "progress" '{"percent":60,"description":"Reviewing code quality","current":25,"total":42}' "Reviewing code quality (25/42)"

sleep 2

# 6. Error update
post_update "error" '{"message":"ESLint found 3 warnings in AgentCard.tsx: unused imports","severity":"warning","file":"src/components/AgentCard.tsx"}' "Found 3 ESLint warnings in AgentCard.tsx"

sleep 2

# 7. Text update
post_update "text" '{"message":"Fixed all linting issues. Code review complete. Summary:\n- 42 files reviewed\n- 3 issues found and fixed\n- Overall code quality: Good\n- Test coverage: 87%"}' "Code review complete: 42 files, 3 issues fixed"

sleep 2

# 8. Progress complete
post_update "progress" '{"percent":100,"description":"Review complete","current":42,"total":42}' "All files reviewed successfully"

sleep 2

# 9. Final status
post_update "status" '{"status":"completed","detail":"Task finished successfully"}' "Agent completed all tasks"

echo ""
echo "=== Test agent finished ==="
echo "Check the dashboard at http://localhost:8080"
