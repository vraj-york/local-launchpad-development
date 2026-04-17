#!/bin/bash

# Launchpad Backend startup for EC2 (systemd). Production uses Docker; see EC2_DEPLOYMENT.md.

echo "🚀 Starting Launchpad Backend..."

cd /home/ubuntu/launchpad/backend || exit 1

mkdir -p logs

if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

echo "🔧 Setting up Prisma..."
npx prisma generate

echo "🗄️ Running database migrations..."
npx prisma db push

if [ -f /etc/systemd/system/launchpad-backend.service ]; then
  sudo systemctl daemon-reload
  sudo systemctl enable --now launchpad-backend
  sudo systemctl status launchpad-backend --no-pager || true
  echo "✅ Backend is managed by systemd (launchpad-backend)."
  echo "📝 Logs: journalctl -u launchpad-backend -f"
else
  echo "[WARN] launchpad-backend.service not found in /etc/systemd/system/."
  echo "Install it: sudo cp launchpad-backend.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now launchpad-backend"
  echo "Or run in this shell: npm start"
fi
