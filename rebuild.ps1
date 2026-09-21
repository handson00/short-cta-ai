# Short CTA AI - Rebuild & Restart Script
# Run this from PowerShell in the project directory

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Short CTA AI - Rebuild & Restart" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean build artifacts
Write-Host "[1/3] Cleaning previous build..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item ".next" -Recurse -Force
    Write-Host "  ✓ Cleaned .next directory"
}

# Step 2: Build
Write-Host ""
Write-Host "[2/3] Building application..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Build completed successfully"

# Step 3: Start
Write-Host ""
Write-Host "[3/3] Starting application..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Application will start on http://localhost:3000" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop the server" -ForegroundColor Green
Write-Host ""

npm start
