#!/bin/bash

# Launchpad Frontend deployment for EC2 (non-Docker). Prefer Docker; see EC2_DEPLOYMENT.md.

echo "🚀 Deploying Launchpad Frontend to EC2..."

FRONTEND_DIR="/home/ubuntu/launchpad/frontend"
SERVICE_NAME="launchpad-frontend"

cd "$FRONTEND_DIR" || exit 1

echo "📥 Pulling latest changes..."
# git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🏗️ Building production assets..."
npm run build

if [ -f /etc/systemd/system/"$SERVICE_NAME".service ]; then
  echo "🔄 Restarting systemd service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  echo "✅ Frontend deployment completed."
  sudo systemctl status "$SERVICE_NAME" --no-pager || true
  echo ""
  echo "🔧 Useful commands:"
  echo "  sudo systemctl status $SERVICE_NAME"
  echo "  journalctl -u $SERVICE_NAME -f"
else
  echo "[WARN] systemd unit not installed. After build, run preview manually:"
  echo "  npm run serve -- --host 0.0.0.0 --port 5173"
  echo "Or: sudo cp launchpad-frontend.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now $SERVICE_NAME"
fi
