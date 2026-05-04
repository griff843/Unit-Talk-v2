#!/usr/bin/env pwsh
# Session-start runbook for Unit Talk V2 on Windows.
# Run once at the top of each working session before touching any branches.
#
# Usage: pwsh scripts/session-start.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "==> Pulling latest main..." -ForegroundColor Cyan
git -C $Root fetch origin
git -C $Root checkout main
git -C $Root pull --ff-only origin main

# ── Next.js junction health check ────────────────────────────────────────────
# The pnpm store has two next entries:
#   - next@14.2.29_... (stub, Playwright-only, no dist/client) — WRONG target
#   - next@14.2.35_... (full install) — CORRECT target
# After branch switches the junction can point to the stub, causing TypeScript
# to fail on useRouter / next/navigation. Check and repair before any work.

Write-Host "==> Checking Next.js junction..." -ForegroundColor Cyan

$JunctionPath = Join-Path $Root "apps\command-center\node_modules\next"
$StoreRoot    = Join-Path $Root "node_modules\.pnpm"

# Find the full Next.js install (has dist/client directory)
$FullNextDir = Get-ChildItem $StoreRoot -Directory -Filter "next@14*" |
    Where-Object { Test-Path (Join-Path $_.FullName "node_modules\next\dist\client") } |
    Select-Object -First 1

if (-not $FullNextDir) {
    Write-Warning "Cannot find full Next.js install in pnpm store. Run 'pnpm install' first."
} else {
    $CorrectTarget = Join-Path $FullNextDir.FullName "node_modules\next"

    $NeedsRepair = $false
    if (-not (Test-Path $JunctionPath)) {
        $NeedsRepair = $true
        Write-Host "   Junction missing — will create." -ForegroundColor Yellow
    } else {
        $CurrentTarget = (Get-Item $JunctionPath).Target
        if ($CurrentTarget -ne $CorrectTarget) {
            $NeedsRepair = $true
            Write-Host "   Junction points to wrong target:" -ForegroundColor Yellow
            Write-Host "     current : $CurrentTarget" -ForegroundColor Yellow
            Write-Host "     correct : $CorrectTarget" -ForegroundColor Yellow
        }
    }

    if ($NeedsRepair) {
        Write-Host "   Repairing junction..." -ForegroundColor Yellow
        if (Test-Path $JunctionPath) {
            Remove-Item $JunctionPath -Force -Recurse
        }
        New-Item -ItemType Junction -Path $JunctionPath -Target $CorrectTarget | Out-Null
        Write-Host "   Junction repaired." -ForegroundColor Green
    } else {
        Write-Host "   Junction OK -> $CorrectTarget" -ForegroundColor Green
    }
}

# ── Quick type-check to surface immediate errors ──────────────────────────────
Write-Host "==> Running type-check on main..." -ForegroundColor Cyan
Push-Location $Root
try {
    pnpm type-check
    Write-Host "   type-check passed." -ForegroundColor Green
} catch {
    Write-Warning "type-check failed on main — investigate before starting lane work."
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Session ready. Main is up to date, junction is healthy." -ForegroundColor Green
Write-Host "Next: run 'pnpm verify' on your branch before any push." -ForegroundColor Cyan
