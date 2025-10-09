#!/bin/bash

# Zip-Sync Frontend Deployment Script for EC2
# This script handles the complete deployment process

echo "🚀 Deploying Zip-Sync Frontend to EC2..."

# Set variables
FRONTEND_DIR="/home/ubuntu/zip-sync/frontend"
SERVICE_NAME="zip-sync-frontend"

# Navigate to frontend directory
cd $FRONTEND_DIR

# Pull latest changes (if using git)
echo "📥 Pulling latest changes..."
# git pull origin main

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install

# Build the application
echo "🔨 Building the application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please check the build errors above."
    exit 1
fi

# Stop existing PM2 process
echo "🛑 Stopping existing process..."
pm2 stop $SERVICE_NAME 2>/dev/null || true

# Start with PM2
echo "▶️ Starting frontend application..."
pm2 start ecosystem.config.cjs --env production

# Save PM2 configuration
pm2 save

echo "✅ Frontend deployment completed successfully!"
echo "📊 Current status:"
pm2 status $SERVICE_NAME

echo ""
echo "🔧 Useful commands:"
echo "  pm2 status                    - Check process status"
echo "  pm2 logs $SERVICE_NAME        - View frontend logs"
echo "  pm2 restart $SERVICE_NAME     - Restart frontend service"
echo "  pm2 stop $SERVICE_NAME        - Stop frontend service"
echo "  pm2 monit                     - Monitor processes"
echo ""
echo "🌐 Frontend should be available at: http://43.205.121.85:5173"
