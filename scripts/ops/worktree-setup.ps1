<#
.SYNOPSIS
  Prepare an isolated lane worktree without sharing node_modules.

.DESCRIPTION
  Parallel Codex lanes run outside the main checkout. Package-touching lanes
  must not junction or symlink node_modules from the main checkout, because
  that makes dependency state shared across lanes. This setup runs a real
  frozen pnpm install inside the lane cwd.

.PARAMETER WorktreePath
  Path to the lane worktree directory.

.PARAMETER MainRepoPath
  Absolute path to the main repo. Defaults to the repo root derived from git.

.EXAMPLE
  pwsh scripts/ops/worktree-setup.ps1 .out/worktrees/codex__utv2-1054-lane
#>
param(
  [Parameter(Mandatory)][string]$WorktreePath,
  [string]$MainRepoPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $MainRepoPath) {
  $MainRepoPath = git rev-parse --show-toplevel 2>$null
  if (-not $MainRepoPath) { throw "Not inside a git repository." }
}

$WorktreePath = (Resolve-Path $WorktreePath).Path
$MainRepoPath = (Resolve-Path $MainRepoPath).Path

if ($WorktreePath -eq $MainRepoPath) {
  throw "Lane setup must run in an isolated lane cwd, not the main checkout."
}

$nodeModules = Join-Path $WorktreePath "node_modules"
if (Test-Path $nodeModules) {
  $item = Get-Item $nodeModules -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "node_modules must not be a junction or symlink in the lane cwd."
  }
}

$srcEnv = Join-Path $MainRepoPath "local.env"
$dstEnv = Join-Path $WorktreePath "local.env"
if ((Test-Path $srcEnv) -and (-not (Test-Path $dstEnv))) {
  Copy-Item $srcEnv $dstEnv
  Write-Host "Copied local.env"
}

Write-Host "Installing dependencies in isolated lane cwd: $WorktreePath"
pnpm install --frozen-lockfile --dir $WorktreePath
if ($LASTEXITCODE -ne 0) {
  throw "pnpm install --frozen-lockfile failed in $WorktreePath"
}

Write-Host "Lane worktree setup complete."
