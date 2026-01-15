#!/bin/bash
# Local development server startup script

set -e

echo "🚀 Starting Jette's AI App locally..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📥 Installing dependencies..."
pip install -q -r requirements.txt

# Check for .env file
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    if [ -f ".env.example" ]; then
        echo "Creating from template..."
        cp .env.example .env
        echo "❗ Please edit .env and add your GEMINI_API_KEY"
        exit 1
    else
        echo "❌ Error: .env.example not found"
        echo "Please create a .env file with your GEMINI_API_KEY"
        exit 1
    fi
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Check if GEMINI_API_KEY is set
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your-gemini-api-key-here" ]; then
    echo "❌ Error: GEMINI_API_KEY not configured in .env"
    echo "Please edit .env and add your Gemini API key"
    exit 1
fi

echo "✅ Configuration loaded"
echo "🌐 Starting server on http://localhost:8080"
echo "Press Ctrl+C to stop"
echo ""

# Run the application
python app.py
