#!/bin/bash
set -euo pipefail
echo "=== 06: Android Development Tools ==="

# Java 17 (required for Android builds)
sudo apt-get install -y openjdk-17-jdk openjdk-17-jre
echo "JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" | sudo tee -a /etc/environment

# Android SDK command-line tools
ANDROID_HOME="$HOME/Android/sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"
cd /tmp

# Download command-line tools
TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
wget -q --show-progress "$TOOLS_URL" -O cmdline-tools.zip
unzip -q cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
rm cmdline-tools.zip

# Add to PATH
cat <<EOF >> "$HOME/.bashrc"

# Android SDK
export ANDROID_HOME="\$HOME/Android/sdk"
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/34.0.0"
EOF

export ANDROID_HOME="$HOME/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin"

# Accept licences and install SDK packages
yes | sdkmanager --licenses
sdkmanager "platform-tools" "build-tools;34.0.0" "platforms;android-34"

# Install Gradle 8.2 for native Android builds
GRADLE_VERSION="8.2"
wget -q --show-progress "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip
sudo unzip -q /tmp/gradle.zip -d /opt/gradle
rm /tmp/gradle.zip
echo "export PATH=\"\$PATH:/opt/gradle/gradle-${GRADLE_VERSION}/bin\"" >> "$HOME/.bashrc"

echo "✓ Android dev tools installed"
echo "NOTE: Run 'source ~/.bashrc' or open a new terminal before building"
