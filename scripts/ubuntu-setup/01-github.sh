#!/bin/bash
set -euo pipefail
echo "=== 01: GitHub Authentication ==="

# Install git if not already present
if ! command -v git &>/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y git
fi

# Install GitHub CLI
if ! command -v gh &>/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y gh
fi

# Authenticate with GitHub
echo ""
echo "Launching GitHub browser authentication..."
echo "(A browser window will open — log in as alex@reach.industries)"
echo ""
gh auth login --web --git-protocol https

# Set git identity
git config --global user.name "alex"
git config --global user.email "alex@reach.industries"
git config --global credential.helper store

echo ""
gh auth status
echo ""
echo "✓ GitHub authentication complete"
echo "  You can now clone, pull, push to all your repos"
