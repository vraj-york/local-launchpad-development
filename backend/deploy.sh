#!/bin/bash

# Launchpad Backend Deployment Script for EC2
# This script handles the complete deployment process

echo "🚀 Deploying Launchpad Backend to EC2..."

# Set variables
BACKEND_DIR="/home/ubuntu/launchpad/backend"
SERVICE_NAME="launchpad-backend"

# Navigate to backend directory
cd $BACKEND_DIR

# Pull latest changes (if using git)
echo "📥 Pulling latest changes..."
# git pull origin main

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "🗄️ Running database migrations..."
npx prisma db push

# Stop existing PM2 process
echo "🛑 Stopping existing process..."
pm2 stop $SERVICE_NAME 2>/dev/null || true

# Start with PM2
echo "▶️ Starting application..."
pm2 start ecosystem.config.cjs --env production

# Save PM2 configuration
pm2 save

echo "✅ Deployment completed successfully!"
echo "📊 Current status:"
pm2 status

echo ""
echo "🔧 Useful commands:"
echo "  pm2 status                    - Check process status"
echo "  pm2 logs $SERVICE_NAME        - View logs"
echo "  pm2 restart $SERVICE_NAME     - Restart service"
echo "  pm2 stop $SERVICE_NAME        - Stop service"
echo "  pm2 monit                     - Monitor processes"
