#!/bin/bash

# Launchpad Backend Deployment Script for EC2 (non-Docker)
# Prefer Docker for production; see EC2_DEPLOYMENT.md in the repo root.

echo "🚀 Deploying Launchpad Backend to EC2..."

BACKEND_DIR="/home/ubuntu/launchpad/backend"
SERVICE_NAME="launchpad-backend"

cd "$BACKEND_DIR" || exit 1

echo "📥 Pulling latest changes..."
# git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🔧 Generating Prisma client..."
npx prisma generate

echo "🗄️ Running database migrations..."
npx prisma db push

echo "🧹 Cleaning stale feedback recording sessions..."
npm run cron:cleanup-feedback-sessions || echo "[WARN] Feedback session cleanup failed (non-fatal)."

if [ -f /etc/systemd/system/"$SERVICE_NAME".service ]; then
  echo "🔄 Restarting systemd service: $SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  echo "✅ Deployment completed."
  sudo systemctl status "$SERVICE_NAME" --no-pager || true
  echo ""
  echo "🔧 Useful commands:"
  echo "  sudo systemctl status $SERVICE_NAME"
  echo "  journalctl -u $SERVICE_NAME -f"
else
  echo "[WARN] systemd unit not installed. Copy launchpad-backend.service to /etc/systemd/system/, run:"
  echo "  sudo systemctl daemon-reload && sudo systemctl enable --now $SERVICE_NAME"
  echo "Or run locally: npm start"
fi
