<#
.SYNOPSIS
  Wire up a fresh git worktree so pnpm verify works without a full pnpm install.

.DESCRIPTION
  A new git worktree shares source files but not node_modules or local.env.
  This script creates directory junctions from the main repo's node_modules
  into the worktree and copies local.env so that pnpm verify runs immediately.

  Must be run after `git worktree add` and before the first `pnpm verify`.

.PARAMETER WorktreePath
  Path to the worktree directory. Use a path inside the main repo under .worktrees/
  so it stays within the Codex sandbox boundary (e.g. .worktrees/utv2-809-fix).
  Absolute paths outside the repo also work (for manual use).

.PARAMETER MainRepoPath
  Absolute path to the main repo. Defaults to the repo root derived from
  git-common-dir (works correctly when called from inside any worktree).

.EXAMPLE
  pwsh scripts/ops/worktree-setup.ps1 .worktrees/utv2-809-fix
#>
param(
  [Parameter(Mandatory)][string]$WorktreePath,
  [string]$MainRepoPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolve main repo root from git if not supplied
if (-not $MainRepoPath) {
  $gitCommonDir = git rev-parse --git-common-dir 2>$null
  if (-not $gitCommonDir) { throw "Not inside a git repository." }
  # git-common-dir is .git inside the main worktree; go one level up
  $MainRepoPath = Split-Path (Resolve-Path $gitCommonDir) -Parent
}

$WorktreePath = (Resolve-Path $WorktreePath).Path
$MainRepoPath = (Resolve-Path $MainRepoPath).Path

if ($WorktreePath -eq $MainRepoPath) {
  Write-Host "Worktree path is the main repo — nothing to do."
  exit 0
}

function New-Junction {
  param([string]$Dest, [string]$Target)
  if (-not (Test-Path $Target)) { return }
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  $parent = Split-Path $Dest -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $null = cmd /c "mklink /J `"$Dest`" `"$Target`"" 2>&1
}

Write-Host "Setting up worktree: $WorktreePath"
Write-Host "Main repo:           $MainRepoPath"

# 1. Root node_modules (.bin, .pnpm, hoisted packages)
New-Junction "$WorktreePath\node_modules" "$MainRepoPath\node_modules"

# 2. Per-app and per-package node_modules
$workspaceDirs = @(
  "apps\worker", "apps\api", "apps\ingestor", "apps\alert-agent",
  "apps\discord-bot", "apps\command-center", "apps\qa-agent", "apps\smart-form",
  "packages\db", "packages\domain", "packages\config", "packages\contracts",
  "packages\events", "packages\observability", "packages\alert-runtime",
  "packages\intelligence", "packages\verification"
)

foreach ($dir in $workspaceDirs) {
  New-Junction "$WorktreePath\$dir\node_modules" "$MainRepoPath\$dir\node_modules"
}

# 3. local.env (gitignored secrets needed by env:check and tests)
$srcEnv = "$MainRepoPath\local.env"
$dstEnv = "$WorktreePath\local.env"
if ((Test-Path $srcEnv) -and (-not (Test-Path $dstEnv))) {
  Copy-Item $srcEnv $dstEnv
  Write-Host "Copied local.env"
}

Write-Host "Worktree setup complete. Run 'pnpm verify' to confirm."
