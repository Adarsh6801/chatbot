#!/usr/bin/env bash
set -euo pipefail

# One-time setup script for a fresh Ubuntu/Debian AWS EC2 instance.
# Keeps costs minimal by running Docker + Caddy + Postgres + Redis directly on the single instance.

if [ ! -f /swapfile ]; then
  echo "Creating 2GB swapfile so Next.js/Docker builds never OOM on small EC2 instances..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker and Docker Compose plugin..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "Setup complete. Next steps:"
echo "1. Point DNS A records for WEB_DOMAIN and ADMIN_DOMAIN to this EC2 public IP."
echo "2. Clone your repository into /opt/chatbot (or \$HOME/chatbot) and create a production .env file."
echo "3. Open ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) in your AWS EC2 Security Group."
echo "4. Run: docker compose -f docker-compose.prod.yml up -d --build"
