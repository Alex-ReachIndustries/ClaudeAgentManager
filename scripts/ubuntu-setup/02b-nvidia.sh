#!/bin/bash
set -euo pipefail
echo "=== 02b: Nvidia driver + CUDA + container toolkit ==="
# Idempotent: skips work if a working proprietary driver is already loaded.
# Bails early on machines without an Nvidia GPU.
#
# RTX 50-series (Blackwell) needs driver 570+. Mint 22 / Ubuntu 24.04 default
# Driver Manager ships 535/550 which DOES NOT support Blackwell. We add the
# graphics-drivers PPA so `ubuntu-drivers autoinstall` picks the latest stable.

# 1. Detect Nvidia GPU
if ! lspci -nn 2>/dev/null | grep -qiE 'vga.*nvidia|3d.*nvidia'; then
  echo "No Nvidia GPU detected — skipping."
  exit 0
fi
echo "Nvidia GPU detected:"
lspci -nn | grep -iE 'vga.*nvidia|3d.*nvidia'

# 2. If proprietary driver already loaded and working, skip.
if command -v nvidia-smi &>/dev/null && nvidia-smi >/dev/null 2>&1; then
  echo ""
  echo "Proprietary Nvidia driver already loaded:"
  nvidia-smi --query-gpu=driver_version,name --format=csv,noheader
  echo "Skipping driver install. Will still ensure CUDA + container toolkit are present."
  DRIVER_ALREADY_OK=1
else
  DRIVER_ALREADY_OK=0
fi

# 3. Driver install (only if not already working)
if [ "$DRIVER_ALREADY_OK" = "0" ]; then
  echo ""
  echo "Installing latest stable Nvidia driver via graphics-drivers PPA..."
  # Remove any half-installed bits / nouveau blacklist conflicts
  sudo apt-get remove -y --purge '^nvidia-.*' 2>/dev/null || true
  sudo apt-get autoremove -y

  # Add graphics-drivers PPA for newer stable drivers (needed for Blackwell)
  sudo add-apt-repository -y ppa:graphics-drivers/ppa
  sudo apt-get update -y

  # ubuntu-drivers picks the recommended driver from the PPA + base repos
  sudo apt-get install -y ubuntu-drivers-common
  echo "Available drivers:"
  sudo ubuntu-drivers list 2>&1 | grep -E 'nvidia-driver-' || true
  RECOMMENDED="$(sudo ubuntu-drivers devices 2>/dev/null | awk '/recommended/ {print $3}' | head -1)"
  if [ -n "${RECOMMENDED:-}" ]; then
    echo "Installing recommended driver: $RECOMMENDED"
    sudo apt-get install -y "$RECOMMENDED"
  else
    # Fallback — try the latest 570 series explicitly (Blackwell-capable as of 2026)
    echo "ubuntu-drivers couldn't autodetect — falling back to nvidia-driver-570"
    sudo apt-get install -y nvidia-driver-570 || sudo apt-get install -y nvidia-driver-565 || \
      { echo "ERROR: no Blackwell-capable driver could be installed. Check 'sudo ubuntu-drivers list'."; exit 1; }
  fi
fi

# 4. CUDA toolkit (for AI training — provides nvcc, libraries)
# Use the apt-shipped nvidia-cuda-toolkit (matches the kernel driver). For
# bleeding-edge CUDA, the user can later add Nvidia's CUDA repo manually.
echo ""
echo "Installing CUDA toolkit..."
sudo apt-get install -y nvidia-cuda-toolkit

# 5. nvidia-container-toolkit — lets Docker access the GPU
echo ""
echo "Installing nvidia-container-toolkit (Docker GPU passthrough)..."
if [ ! -f /etc/apt/keyrings/nvidia-container-toolkit-keyring.gpg ]; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /etc/apt/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/etc/apt/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
  sudo apt-get update -y
fi
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker runtime to know about Nvidia (only if Docker is already installed —
# 03-docker.sh runs after this, but if it's already there we wire it up now)
if command -v docker &>/dev/null; then
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker || true
  echo "Docker configured for Nvidia runtime."
else
  echo "Docker not yet installed — 03-docker.sh will need to be followed by re-running this step's configure (or run: sudo nvidia-ctk runtime configure --runtime=docker)."
fi

echo ""
if [ "$DRIVER_ALREADY_OK" = "1" ]; then
  echo "✓ CUDA + container toolkit installed (driver was already loaded)"
else
  echo "✓ Driver + CUDA + container toolkit installed"
  echo ""
  echo "REBOOT REQUIRED before nvidia-smi / NVENC will work."
  echo "After reboot, verify:"
  echo "  nvidia-smi                                       # should list the GPU"
  echo "  nvcc --version                                   # CUDA compiler"
  echo "  docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi"
fi
