#!/bin/bash
set -euo pipefail
echo "=== 01: System Update ==="

sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get dist-upgrade -y
sudo apt-get install -y \
  curl wget git unzip zip tar \
  build-essential pkg-config \
  software-properties-common \
  apt-transport-https ca-certificates \
  gnupg lsb-release \
  htop tmux vim nano \
  net-tools iputils-ping dnsutils \
  xdotool jq

sudo apt-get autoremove -y
sudo apt-get autoclean -y

echo "✓ System update complete"
