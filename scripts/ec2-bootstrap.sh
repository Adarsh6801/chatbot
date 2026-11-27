#!/usr/bin/env bash
set -euo pipefail

# One-time setup script for Ubuntu/Debian or Amazon Linux AWS EC2 instances.
# Keeps costs minimal by running Docker + Caddy + Postgres + Redis directly on the single instance.

if [ ! -f /swapfile ]; then
  echo "Creating 2GB swapfile so Next.js/Docker builds never OOM on small EC2 instances..."
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y docker
    sudo systemctl enable --now docker
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y docker
    sudo systemctl enable --now docker
  else
    curl -fsSL https://get.docker.com | sudo sh
  fi
  sudo usermod -aG docker "$USER"
fi

# Ensure Docker Compose v2 & Buildx >= 0.17.0 are installed (fixes Amazon Linux old buildx error)
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  BIN_ARCH="amd64"
else
  BIN_ARCH="arm64"
fi

PLUGIN_DIR="/usr/local/lib/docker/cli-plugins"
sudo mkdir -p "$PLUGIN_DIR"

if ! docker compose version >/dev/null 2>&1; then
  sudo curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-${ARCH}" -o "$PLUGIN_DIR/docker-compose"
  sudo chmod +x "$PLUGIN_DIR/docker-compose"
fi

sudo curl -fsSL "https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-${BIN_ARCH}" -o "$PLUGIN_DIR/docker-buildx"
sudo chmod +x "$PLUGIN_DIR/docker-buildx"

docker compose version
docker buildx version

echo "Setup complete. Next steps:"
echo "1. Point DNS A records for WEB_DOMAIN and ADMIN_DOMAIN to this EC2 public IP."
echo "2. Clone your repository into /opt/chatbot (or \$HOME/chatbot) and create a production .env file."
echo "3. Open ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) in your AWS EC2 Security Group."
echo "4. Run: docker compose -f docker-compose.prod.yml up -d --build"
