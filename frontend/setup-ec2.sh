#!/bin/bash

# Zip-Sync Frontend EC2 Setup Script
# Run this script on your EC2 instance to set up the frontend with PM2

echo "🚀 Setting up Zip-Sync Frontend on EC2..."

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
mkdir -p /home/ubuntu/zip-sync/frontend/logs

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x /home/ubuntu/zip-sync/frontend/deploy.sh
chmod +x /home/ubuntu/zip-sync/frontend/setup-ec2.sh

# Install project dependencies
echo "📦 Installing project dependencies..."
cd /home/ubuntu/zip-sync/frontend
npm install

# Setup PM2 startup
echo "⚙️ Setting up PM2 startup..."
pm2 startup
pm2 save

# Start the frontend service
echo "▶️ Starting Zip-Sync Frontend..."
cd /home/ubuntu/zip-sync/frontend
pm2 start ecosystem.config.cjs --env production

echo ""
echo "✅ Frontend setup completed successfully!"
echo ""
echo "📊 PM2 Commands:"
echo "  pm2 status                    - Check PM2 processes"
echo "  pm2 logs zip-sync-frontend   - View frontend logs"
echo "  pm2 restart zip-sync-frontend - Restart frontend with PM2"
echo "  pm2 stop zip-sync-frontend   - Stop frontend"
echo "  pm2 monit                    - Monitor processes"
echo ""
echo "🌐 Your frontend should now be running on http://43.205.121.85:5173"
echo "🔗 Make sure your backend is running on http://43.205.121.85:5000"
