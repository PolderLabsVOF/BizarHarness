<#
.SYNOPSIS
  BizarHarness Windows installer (PowerShell, v4.4.7 — thin wrapper).

.DESCRIPTION
  Cross-platform installer for BizarHarness on Windows. v4.4.7 is a
  thin wrapper that:
    1. Installs Windows-specific system deps (Node.js, git, jq) via
       winget → choco → npm fallback.
    2. Shells to `node cli/provision.mjs --mode=install` for everything
       else (agent files, plugin copy, opencode.json patching, skills
       install, service registration via Task Scheduler, doctor check).

  Linux/macOS users should use install.sh instead.

.PARAMETER Update
  Run in update mode (equivalent to --mode=update on the unified
  provisioner; idempotent so safe to run after every npm install).

.PARAMETER DryRun
  Print all actions without executing them.

.PARAMETER NonInteractive
  Skip all prompts (CI safe).

.PARAMETER Force
  Overwrite existing files even when they match.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -DryRun
  .\install.ps1 -Update
  .\install.ps1 -NonInteractive -Force
#>

[CmdletBinding()]
param(
  [switch]$Update,
  [switch]$DryRun,
  [switch]$NonInteractive,
  [switch]$Force,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

# ── Helper functions ─────────────────────────────────────────────────────────
function Write-Note   { param([string]$Msg) Write-Host "  ✓ $Msg" -ForegroundColor Green }
function Write-Warn   { param([string]$Msg) Write-Host "  ⚠ $Msg" -ForegroundColor Yellow }
function Write-Err    { param([string]$Msg) Write-Host "  ✗ $Msg" -ForegroundColor Red }
function Write-Action { param([string]$Msg) Write-Host "  → $Msg" -ForegroundColor Cyan }
function Write-Dim    { param([string]$Msg) Write-Host "  $Msg" -ForegroundColor DarkGray }
function Write-Section{ param([string]$Msg) Write-Host "`n── $Msg ──" -ForegroundColor Cyan }
function Have-Cmd     { param([string]$Cmd) $null -ne (Get-Command $Cmd -ErrorAction SilentlyContinue) }
function Have-File    { param([string]$Path) Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue }

function Show-Usage {
  @"
install.ps1 — BizarHarness Windows installer

Usage:
  .\install.ps1                   Interactive install
  .\install.ps1 -Help             Show this help
  .\install.ps1 -DryRun           Print actions, no changes
  .\install.ps1 -NonInteractive   Skip prompts (CI safe)
  .\install.ps1 -Force            Overwrite existing files
  .\install.ps1 -Update           Run in update mode
"@
}

if ($Help) {
  Show-Usage
  exit 0
}

# ── Paths ───────────────────────────────────────────────────────────────────
$RepoDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '')).Path

# ── System dependency install (Windows) ────────────────────────────────────
# Windows tooling doesn't need apt/dnf/brew — we only need node + git + jq
# + a terminal emulator. winget is the modern path; choco is the fallback.

function Install-WindowsDeps {
  Write-Section "Checking dependencies"

  if (Have-Cmd node) {
    Write-Note "Node.js $(node --version) present"
  } else {
    Write-Action "Installing Node.js 20 LTS..."
    if (Have-Cmd winget) {
      if (-not $DryRun) { winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null }
      Write-Note "Node.js installed via winget"
    } elseif (Have-Cmd choco) {
      if (-not $DryRun) { choco install -y nodejs-lts | Out-Null }
      Write-Note "Node.js installed via choco"
    } else {
      Write-Action "Installing Node.js via npm-dist tarball fallback..."
      if (-not $DryRun) {
        $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
        $ver  = 'v20.17.0'
        $url  = "https://nodejs.org/dist/$ver/node-$ver-win-$arch.zip"
        $zip  = Join-Path $env:TEMP "node.zip"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath "$env:ProgramFiles\nodejs" -Force
        [Environment]::SetEnvironmentVariable('Path', "$env:Path;$env:ProgramFiles\nodejs", 'User')
        $env:Path = "$env:Path;$env:ProgramFiles\nodejs"
      }
      Write-Note "Node.js installed via tarball fallback"
    }
  }

  if (Have-Cmd git) { Write-Note "git present" }
  elseif (Have-Cmd winget) { if (-not $DryRun) { winget install --id Git.Git --accept-source-agreements --accept-package-agreements | Out-Null } }
  elseif (Have-Cmd choco)  { if (-not $DryRun) { choco install -y git | Out-Null } }

  if (Have-Cmd uv) { Write-Note "uv present" }
  elseif (Have-Cmd winget) { if (-not $DryRun) { winget install --id astral-sh.uv --accept-source-agreements --accept-package-agreements | Out-Null } }
}

# ── Service registration (delegated to Node) ───────────────────────────────
function Install-Service {
  Write-Section "Installing background service"
  $bin = Join-Path $RepoDir 'cli\bin.mjs'
  if (-not (Have-File $bin)) {
    Write-Warn "cli/bin.mjs not found — service registration deferred"
    return
  }
  if ($DryRun) {
    Write-Dim "would run: node $bin service install"
    return
  }
  $p = Start-Process -FilePath node -ArgumentList @($bin, 'service', 'install') -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    Write-Warn "service registration had issues (exit $($p.ExitCode))"
    Write-Dim "    manual command: node $bin service install"
  }
}

# ── Main ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ⚡ BizarHarness Installer v4.4.7" -ForegroundColor Cyan
if ($Update) { Write-Host "  Update mode" -ForegroundColor DarkGray }
Write-Host ""

$os = (Get-CimInstance Win32_OperatingSystem).Caption
Write-Note "Detected $os"

Install-WindowsDeps
Install-Service

# ── Hand off to the unified provisioner ────────────────────────────────────
$provision = Join-Path $RepoDir 'cli\provision.mjs'
if (-not (Have-File $provision)) {
  Write-Err "cli\provision.mjs not found"
  exit 1
}

$mode = if ($Update) { 'update' } else { 'install' }
$args = @('--mode', $mode)
if ($DryRun)         { $args += '--dry-run' }
if ($Force)          { $args += '--force' }
if ($NonInteractive) { $args += '--yes' }

Write-Section "Running unified provisioner"
Write-Action "node $provision $($args -join ' ')"
$allArgs = @($provision) + $args
$proc = Start-Process -FilePath node -ArgumentList $allArgs -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
  Write-Warn "provisioner exited with code $($proc.ExitCode)"
  exit $proc.ExitCode
}

Write-Host ""
Write-Host "┌────────────────────────────────────────────────────────────┐"
Write-Host "│  BizarHarness ready.                                       │"
Write-Host "│                                                            │"
Write-Host "│  Next:                                                     │"
Write-Host "│    1. Restart opencode to pick up new config                │"
Write-Host "│    2. Run /connect in opencode to add API keys              │"
Write-Host "│    3. Run 'bizar dash start' to launch the dashboard        │"
Write-Host "│    4. Visit http://localhost:4321 in your browser            │"
Write-Host "└────────────────────────────────────────────────────────────┘"
Write-Host ""

if ($DryRun) {
  Write-Warn "DRY RUN — no changes were made"
}