#!/usr/bin/env bash
# Makes Digital Kaizen start with the machine and restart if it stops.
#   sudo bash deploy/install-linux-service.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo."; exit 1; fi

DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_AS="${SUDO_USER:-root}"
NODE="$(sudo -u "$RUN_AS" bash -lc 'command -v node' || command -v node)"
if [ -z "$NODE" ]; then echo "node was not found. Install Node.js 22 or newer first."; exit 1; fi

sed -e "s|__DIR__|$DIR|" -e "s|__USER__|$RUN_AS|" -e "s|__NODE__|$NODE|" \
  "$DIR/deploy/digital-kaizen.service" > /etc/systemd/system/digital-kaizen.service

systemctl daemon-reload
systemctl enable --now digital-kaizen.service
sleep 3
systemctl --no-pager --lines=15 status digital-kaizen.service || true
echo
echo "Installed. Logs:  journalctl -u digital-kaizen -f"
