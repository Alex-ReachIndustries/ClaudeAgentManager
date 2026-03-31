#!/bin/sh
# Generate Mosquitto password file from environment variables
# Run inside the Mosquitto container on first start

PASSWD_FILE=/mosquitto/config/passwd

if [ ! -f "$PASSWD_FILE" ]; then
    echo "Generating MQTT password file..."
    touch "$PASSWD_FILE"
    # Backend service account
    mosquitto_passwd -b "$PASSWD_FILE" backend "${MQTT_BACKEND_PASSWORD:-claudemanager}"
    # Agent sidecar account
    mosquitto_passwd -b "$PASSWD_FILE" agent "${MQTT_AGENT_PASSWORD:-agentsidecar}"
    # Dashboard WebSocket account
    mosquitto_passwd -b "$PASSWD_FILE" dashboard "${MQTT_DASHBOARD_PASSWORD:-dashboard}"
    echo "Password file created with 3 accounts"
else
    echo "Password file already exists, skipping generation"
fi

exec mosquitto -c /mosquitto/config/mosquitto.conf
