#!/bin/bash

# Zip-Sync Backend EC2 Setup Script
# Run this script on your EC2 instance to set up the backend with PM2

echo "🚀 Setting up Zip-Sync Backend on EC2..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js (if not already installed)
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 globally
echo "📥 Installing PM2 globally..."
sudo npm install -g pm2

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p /home/ubuntu/zip-sync/backend/logs

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x /home/ubuntu/zip-sync/backend/start.sh
chmod +x /home/ubuntu/zip-sync/backend/deploy.sh

# Install project dependencies
echo "📦 Installing project dependencies..."
cd /home/ubuntu/zip-sync/backend
npm install

# Setup Prisma
echo "🔧 Setting up Prisma..."
npx prisma generate

# Create systemd service (optional)
echo "⚙️ Setting up systemd service..."
sudo cp /home/ubuntu/zip-sync/backend/zip-sync-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable zip-sync-backend

# Start the service
echo "▶️ Starting Zip-Sync Backend..."
cd /home/ubuntu/zip-sync/backend
./start.sh

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "🔧 Service Management Commands:"
echo "  sudo systemctl start zip-sync-backend    - Start service"
echo "  sudo systemctl stop zip-sync-backend     - Stop service"
echo "  sudo systemctl restart zip-sync-backend  - Restart service"
echo "  sudo systemctl status zip-sync-backend   - Check status"
echo ""
echo "📊 PM2 Commands:"
echo "  pm2 status                    - Check PM2 processes"
echo "  pm2 logs zip-sync-backend    - View logs"
echo "  pm2 restart zip-sync-backend - Restart with PM2"
echo "  pm2 monit                    - Monitor processes"
echo ""
echo "🌐 Your backend should now be running on http://43.205.121.85:5000"
