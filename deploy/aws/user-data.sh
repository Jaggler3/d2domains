#!/bin/bash
# EC2 user-data: base packages for the compose-based deployment.
set -euxo pipefail

# AWS CLI (Ubuntu AMIs do not ship it)
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y awscli || snap install aws-cli --classic

# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 2G swap — next.js image builds are memory-hungry on t3.small
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /srv/d2domains
# The instance role allows reading SSM; deploy-remote.sh rebuilds .env from it.
