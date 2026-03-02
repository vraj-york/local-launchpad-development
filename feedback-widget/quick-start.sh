#!/bin/bash

echo "🚀 Feedback Widget - Quick Start"
echo "================================"
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "✅ Dependencies installed successfully"
echo ""

# Build the widget
echo "🔨 Building the widget..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "✅ Widget built successfully"
echo ""

# Check if dist file exists
if [ -f "dist/feedback-widget.min.js" ]; then
    FILE_SIZE=$(ls -lh dist/feedback-widget.min.js | awk '{print $5}')
    echo "📦 Bundle size: $FILE_SIZE"
else
    echo "❌ Build file not found"
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Open public/test.html in your browser to test the widget"
echo "2. Or run 'npm run serve' to start a dev server"
echo "3. Press Ctrl+Shift+F to open the feedback widget"
echo ""
echo "For integration instructions, see BUILD_INSTRUCTIONS.md"
