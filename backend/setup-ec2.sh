#!/bin/bash

# Launchpad Backend EC2 setup (Node + systemd). Prefer Docker; see EC2_DEPLOYMENT.md.

echo "🚀 Setting up Launchpad Backend on EC2..."

echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

if ! command -v node &> /dev/null; then
  echo "📥 Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "📁 Creating logs directory..."
mkdir -p /home/ubuntu/launchpad/backend/logs

echo "🔧 Making scripts executable..."
chmod +x /home/ubuntu/launchpad/backend/start.sh
chmod +x /home/ubuntu/launchpad/backend/deploy.sh

echo "📦 Installing project dependencies..."
cd /home/ubuntu/launchpad/backend || exit 1
npm install

echo "🔧 Setting up Prisma..."
npx prisma generate

echo "⚙️ Installing systemd service..."
sudo cp /home/ubuntu/launchpad/backend/launchpad-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable launchpad-backend

echo "▶️ Starting Launchpad Backend..."
cd /home/ubuntu/launchpad/backend || exit 1
./start.sh

echo ""
echo "✅ Setup completed."
echo "🔧 Service commands:"
echo "  sudo systemctl start launchpad-backend"
echo "  sudo systemctl stop launchpad-backend"
echo "  sudo systemctl restart launchpad-backend"
echo "  sudo systemctl status launchpad-backend"
echo "  journalctl -u launchpad-backend -f"
