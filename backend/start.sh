#!/bin/bash

# Zip-Sync Backend PM2 Startup Script for EC2
# This script sets up and starts the backend service using PM2

echo "🚀 Starting Zip-Sync Backend with PM2..."

# Navigate to backend directory
cd /home/ubuntu/zip-sync/backend

# Create logs directory if it doesn't exist
mkdir -p logs

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Generate Prisma client if needed
echo "🔧 Setting up Prisma..."
npx prisma generate

# Run database migrations
echo "🗄️ Running database migrations..."
npx prisma db push

# Stop any existing PM2 processes
echo "🛑 Stopping existing PM2 processes..."
pm2 stop zip-sync-backend 2>/dev/null || true
pm2 delete zip-sync-backend 2>/dev/null || true

# Start the application with PM2
echo "▶️ Starting application with PM2..."
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup

echo "✅ Zip-Sync Backend is now running with PM2!"
echo "📊 Use 'pm2 status' to check the status"
echo "📝 Use 'pm2 logs zip-sync-backend' to view logs"
echo "🔄 Use 'pm2 restart zip-sync-backend' to restart"
