#!/bin/bash
set -euo pipefail
echo "=== 04: Node.js 22 LTS + PM2 ==="

# Install Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Confirm versions
node --version
npm --version

# Install PM2 globally
sudo npm install -g pm2

# Set up PM2 to start on boot for current user
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | sudo bash

echo "✓ Node.js $(node --version) and PM2 $(pm2 --version) installed"
