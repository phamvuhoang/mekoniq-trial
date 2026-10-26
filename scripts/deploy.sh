#!/bin/sh
# Mac -> Android over SSH (Termux sshd, port 8022): pack, copy, re-run the installer.
# Usage: sh scripts/deploy.sh <ip-or-tailscale-name> [termux-user]   (user = output of `whoami` in Termux)
set -e
cd "$(dirname "$0")/.."
T=${2:+$2@}${1:?Thiếu IP máy Android}
sh scripts/pack.sh
scp -P 8022 dist/robot-nodered.tar.gz "$T:"
ssh -t -p 8022 "$T" 'rm -rf ~/bundle && mkdir ~/bundle && tar xzf ~/robot-nodered.tar.gz -C ~/bundle && bash ~/bundle/termux/install.sh'
