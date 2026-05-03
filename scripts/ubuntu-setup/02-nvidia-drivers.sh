#!/bin/bash
set -euo pipefail
echo "=== 02: Nvidia Drivers ==="

# Remove any existing nvidia/nouveau drivers
sudo apt-get remove -y --purge '*nvidia*' 2>/dev/null || true
sudo apt-get autoremove -y

# Add graphics PPA for latest stable drivers
sudo add-apt-repository -y ppa:graphics-drivers/ppa
sudo apt-get update -y

# Install recommended driver (auto-detect)
echo "Detecting recommended Nvidia driver..."
RECOMMENDED=$(ubuntu-drivers devices 2>/dev/null | grep recommended | awk '{print $3}' | head -1)
if [ -n "$RECOMMENDED" ]; then
  echo "Installing $RECOMMENDED..."
  sudo apt-get install -y "$RECOMMENDED"
else
  # Fallback: install nvidia-driver-550 (current LTS-recommended)
  echo "Auto-detect failed, installing nvidia-driver-550..."
  sudo apt-get install -y nvidia-driver-550
fi

# Install CUDA toolkit for ML workloads
sudo apt-get install -y nvidia-cuda-toolkit

# Install nvidia-container-toolkit for Docker GPU passthrough
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update -y
sudo apt-get install -y nvidia-container-toolkit

echo "✓ Nvidia drivers installed"
echo "NOTE: Reboot required before nvidia-smi will work"
