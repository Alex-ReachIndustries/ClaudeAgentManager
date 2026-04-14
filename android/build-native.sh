#!/bin/bash
# Build the ClaudeManager Android APK natively (no Docker)
# Requires: JDK 17 at C:/Program Files/Microsoft/jdk-17.0.18.8-hotspot
#           Android SDK at C:/Android/sdk
# Usage: ./build-native.sh [debug|release]  (default: debug)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export JAVA_HOME="C:/Program Files/Microsoft/jdk-17.0.18.8-hotspot"
export ANDROID_HOME="C:/Android/sdk"
export ANDROID_SDK_ROOT="C:/Android/sdk"

BUILD_TYPE="${1:-debug}"

echo "=== Building ClaudeManager Android APK (native) ==="
echo "Build type: $BUILD_TYPE"
echo "JAVA_HOME:  $JAVA_HOME"
echo "ANDROID_HOME: $ANDROID_HOME"
echo ""

if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease --no-daemon
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
    ./gradlew assembleDebug --no-daemon
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

if [ -f "$APK_PATH" ]; then
    cp "$APK_PATH" ./app-debug.apk
    echo ""
    echo "=== Build successful! ==="
    echo "APK: $(pwd)/app-debug.apk"
    echo "Size: $(du -h app-debug.apk | cut -f1)"
    echo ""
    echo "To install on a connected device:"
    echo "  adb install app-debug.apk"
else
    echo "ERROR: Build failed - APK not found at $APK_PATH"
    exit 1
fi
