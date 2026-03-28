#!/bin/bash
# Build the ClaudeManager Android APK using Docker
# Usage: ./docker-build.sh
# Output: app-debug.apk in the current directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building ClaudeManager Android APK ==="
echo ""

# Build the APK using Docker
docker build --output type=local,dest=./build-output -f Dockerfile .

if [ -f ./build-output/app-debug.apk ]; then
    mv ./build-output/app-debug.apk ./app-debug.apk
    rm -rf ./build-output
    echo ""
    echo "=== Build successful! ==="
    echo "APK: $(pwd)/app-debug.apk"
    echo "Size: $(du -h app-debug.apk | cut -f1)"
    echo ""
    echo "To install on a connected device:"
    echo "  adb install app-debug.apk"
else
    echo "ERROR: Build failed - APK not found"
    rm -rf ./build-output
    exit 1
fi
