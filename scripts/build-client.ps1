# Build the Discreet Vite client (Windows PowerShell)
# Run from project root: .\scripts\build-client.ps1

Write-Host "Building Discreet Vite client..." -ForegroundColor Cyan

# Step 1: Install npm deps
Push-Location client-next
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Step 2: Build WASM (optional — must be built before npm install)
$wasmPack = Get-Command wasm-pack -ErrorAction SilentlyContinue
if ($wasmPack -and (Test-Path "..\discreet-crypto")) {
    Write-Host "Building WASM crypto module..." -ForegroundColor Yellow
    Push-Location ..\discreet-crypto
    try {
        wasm-pack build --target web --features wasm --no-default-features
        Write-Host "WASM built! npm install will link it automatically." -ForegroundColor Green
    } catch {
        Write-Host "WASM build skipped (optional — PBKDF2 fallback active)" -ForegroundColor DarkYellow
    }
    Pop-Location
}

# Step 3: Build Vite
Write-Host "Building with Vite..." -ForegroundColor Yellow
npx vite build

Pop-Location

Write-Host ""
Write-Host "Client built! Output: client-next\dist\" -ForegroundColor Green
Write-Host "  Served at: http://localhost:3000/next/" -ForegroundColor Cyan
Write-Host "  (Production client still at http://localhost:3000/)" -ForegroundColor Gray
