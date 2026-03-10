#!/bin/bash

echo "🚀 Starting Launchpad Frontend Development Server"
echo "================================================"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "🔧 Starting development server..."
echo "📱 Frontend will be available at: http://localhost:5173"
echo "🔗 Make sure your backend is running on: http://localhost:5000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm run dev
