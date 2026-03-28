# Multi-stage Docker build for ClaudeManager Android app
# Produces a debug APK without requiring local Android SDK or JDK installation

FROM eclipse-temurin:17-jdk-jammy AS builder

# Avoid prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip wget curl \
    && rm -rf /var/lib/apt/lists/*

# Set up Android SDK
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# Download Android command-line tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    cd /tmp && \
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip && \
    unzip -q cmdline-tools.zip && \
    mv cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm cmdline-tools.zip

# Accept licenses and install required SDK packages
RUN yes | sdkmanager --licenses > /dev/null 2>&1 && \
    sdkmanager \
    "platforms;android-34" \
    "build-tools;34.0.0" \
    "platform-tools"

# Create working directory
WORKDIR /app

# Copy Gradle wrapper files and build scripts first (for caching)
COPY gradle.properties .
COPY build.gradle.kts .
COPY settings.gradle.kts .
COPY gradle/ gradle/
COPY app/build.gradle.kts app/build.gradle.kts
COPY app/proguard-rules.pro app/proguard-rules.pro

# Generate Gradle wrapper
RUN wget -q https://services.gradle.org/distributions/gradle-8.2-bin.zip -O /tmp/gradle.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    /opt/gradle-8.2/bin/gradle wrapper --gradle-version 8.2 && \
    rm /tmp/gradle.zip

# Pre-download dependencies (cached layer)
RUN ./gradlew --no-daemon dependencies || true

# Copy persistent debug keystore for consistent signing across builds
COPY debug.keystore /root/.android/debug.keystore

# Copy source code
COPY app/src/ app/src/

# Build debug APK
RUN ./gradlew --no-daemon assembleDebug

# Output stage - just the APK
FROM scratch AS output
COPY --from=builder /app/app/build/outputs/apk/debug/app-debug.apk /app-debug.apk
