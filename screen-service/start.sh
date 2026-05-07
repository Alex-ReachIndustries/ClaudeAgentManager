#!/bin/bash
# Start the screen interaction service
# Launches Xephyr :1 + openbox + Flask API on port 3002

cd "$(dirname "$0")"

# Check we're on Linux with X11
if [[ "$(uname)" != "Linux" ]]; then
    echo "screen-service: skipping (not Linux)"
    exit 0
fi

if [[ -z "$DISPLAY" ]]; then
    echo "screen-service: skipping (no DISPLAY set)"
    exit 0
fi

# Kill any existing instances
pkill -f "python3 main.py.*screen-service" 2>/dev/null
pkill -f "Xephyr :1" 2>/dev/null
sleep 0.5

# Start the service
DISPLAY="${DISPLAY:-:0}" python3 main.py &
SERVICE_PID=$!
echo "screen-service started (PID $SERVICE_PID) on port ${SCREEN_SERVICE_PORT:-3002}"
echo "$SERVICE_PID" > /tmp/screen-service.pid

# Wait for health
for i in $(seq 1 10); do
    if curl -s --max-time 1 http://localhost:${SCREEN_SERVICE_PORT:-3002}/health > /dev/null 2>&1; then
        echo "screen-service is healthy"
        exit 0
    fi
    sleep 1
done

echo "screen-service: warning — health check didn't pass within 10s"
