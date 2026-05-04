#!/bin/bash
# Sourced helper — sets DISTRO_NAME, DISTRO_VERSION, UBUNTU_CODENAME.
# Works on Ubuntu, Linux Mint (standard, NOT LMDE), Pop!_OS, Kubuntu, Xubuntu.
# Bails loudly on Debian (no PPA support) and on Mint LMDE.

set -e

if [ ! -f /etc/os-release ]; then
  echo "ERROR: /etc/os-release missing — unsupported system" >&2
  return 1 2>/dev/null || exit 1
fi
. /etc/os-release

DISTRO_NAME="${NAME:-unknown}"
DISTRO_VERSION="${VERSION_ID:-unknown}"

case "${ID:-}" in
  ubuntu)
    UBUNTU_CODENAME="${VERSION_CODENAME:-noble}"
    ;;
  linuxmint)
    if [ -f /etc/upstream-release/lsb-release ]; then
      UBUNTU_CODENAME="$(. /etc/upstream-release/lsb-release && echo "$DISTRIB_CODENAME")"
    else
      echo "WARNING: Mint detected but no /etc/upstream-release — this might be LMDE (Debian-based, NOT supported by these scripts)." >&2
      echo "If you are on LMDE, abort and reinstall with standard Linux Mint (Ubuntu base)." >&2
      UBUNTU_CODENAME="noble"
    fi
    ;;
  pop)
    UBUNTU_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-jammy}}"
    ;;
  debian)
    echo "ERROR: Debian detected. These scripts assume Ubuntu/Mint base — Debian lacks PPA support and several apt repos are different. Aborting." >&2
    return 1 2>/dev/null || exit 1
    ;;
  *)
    if [ "${ID_LIKE:-}" = "ubuntu" ] || [ "${ID_LIKE:-}" = "debian ubuntu" ]; then
      UBUNTU_CODENAME="${VERSION_CODENAME:-noble}"
    else
      echo "WARNING: Unknown distro '${ID:-}' — assuming Ubuntu-like. May fail." >&2
      UBUNTU_CODENAME="${VERSION_CODENAME:-noble}"
    fi
    ;;
esac

export DISTRO_NAME DISTRO_VERSION UBUNTU_CODENAME

echo "=== Detected: $DISTRO_NAME $DISTRO_VERSION (Ubuntu base: $UBUNTU_CODENAME) ==="
