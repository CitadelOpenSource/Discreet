#!/bin/bash
# Build the Discreet Vite client
# Run from project root: bash scripts/build-client.sh

set -e

echo "🏗️  Building Discreet Vite client..."

# Step 1: Install npm deps
cd client-next
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Step 2: Build WASM (if crypto crate exists and wasm-pack is installed)
if command -v wasm-pack &> /dev/null && [ -d "../discreet-crypto" ]; then
  echo "🔐 Building WASM crypto module..."
  cd ../discreet-crypto
  wasm-pack build --target web --features wasm --no-default-features 2>/dev/null || echo "⚠️  WASM build skipped (optional — PBKDF2 fallback active)"
  cd ../client-next
fi

# Step 3: Build Vite
echo "⚡ Building with Vite..."
npx vite build

echo ""
echo "✅ Client built! Output: client-next/dist/"
echo "   Served at: http://localhost:3000/next/"
echo "   (Production client still at http://localhost:3000/)"
