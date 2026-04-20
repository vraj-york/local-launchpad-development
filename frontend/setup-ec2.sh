#!/bin/bash

# Launchpad Frontend EC2 setup (Node + systemd + Vite preview). Prefer Docker; see EC2_DEPLOYMENT.md.

echo "🚀 Setting up Launchpad Frontend on EC2..."

echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

if ! command -v node &> /dev/null; then
  echo "📥 Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "📁 Creating logs directory..."
mkdir -p /home/ubuntu/launchpad/frontend/logs

echo "🔧 Making scripts executable..."
chmod +x /home/ubuntu/launchpad/frontend/deploy.sh
chmod +x /home/ubuntu/launchpad/frontend/setup-ec2.sh

echo "📦 Installing project dependencies..."
cd /home/ubuntu/launchpad/frontend || exit 1
npm install

echo "🏗️ Building production assets..."
npm run build