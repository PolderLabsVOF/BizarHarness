<#
.SYNOPSIS
  BizarHarness Windows installer (PowerShell).

.DESCRIPTION
  Cross-platform installer for BizarHarness on Windows. Detects
  and installs dependencies via winget → choco → npm, then
  configures agent files, the opencode plugin, and the background
  service.

  Linux/macOS users should use install.sh instead.

.PARAMETER Update
  Pull latest via git, re-install config, re-install service.

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

#Requires -Version 5.1
Set-StrictMode -Version Latest

param(
  [switch]$Update,
  [switch]$DryRun,
  [switch]$NonInteractive,
  [switch]$Force
)

# ── Constants ──────────────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Resolve-Path $ScriptDir
$ConfigDir = "$env:USERPROFILE\.config\opencode"
$PluginDir = "$ConfigDir\plugins\bizar"
$OpenCodeConfig = "$ConfigDir\opencode.json"

$Host.UI.RawUI.WindowTitle = "BizarHarness Installer v3.22.0"

# ── Helper functions ───────────────────────────────────────────────────────────

function Write-Note  { Write-Host "  ✓ $($args[0])" -ForegroundColor Green }
function Write-Warn  { Write-Host "  ⚠ $($args[0])" -ForegroundColor Yellow }
function Write-Err   { Write-Host "  ✗ $($args[0])" -ForegroundColor Red }
function Write-Action{ Write-Host "  → $($args[0])" -ForegroundColor Cyan }
function Write-Dim   { Write-Host "  $($args[0])" -ForegroundColor DarkGray }
function Write-Section{ Write-Host "`n── $($args[0]) ──" -ForegroundColor Cyan }

function DryBlock {
  <#
  .SYNOPSIS
    Execute a script block only if not in dry-run mode.
  #>
  param([scriptblock]$Block, [string]$Description)
  if ($DryRun) {
    Write-Dim "  [DRY-RUN] $Description"
    return $null
  }
  return & $Block
}

function Have-Cmd {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Have-File {
  param([string]$Path)
  return [bool](Test-Path $Path -PathType Leaf)
}

# ── Usage ──────────────────────────────────────────────────────────────────────

function Show-Usage {
  @"

  install.ps1 — BizarHarness Windows installer

  Usage:
    .\install.ps1                        Interactive install
    .\install.ps1 -Help                  Show this help
    .\install.ps1 -DryRun                Dry run — print actions, no changes
    .\install.ps1 -NonInteractive         Non-interactive (CI safe)
    .\install.ps1 -Force                 Overwrite existing files
    .\install.ps1 -Update                Pull latest + re-install config + service

  On Linux/macOS, run install.sh instead.

"@
  exit 0
}

if ($args -contains '--help' -or $args -contains '-h' -or $args -contains '-Help') {
  Show-Usage
}

# ── Header ─────────────────────────────────────────────────────────────────────

Write-Host "`n  ⚡ BizarHarness Installer v3.22.0" -ForegroundColor Cyan
if ($Update) { Write-Host "  Update mode" -ForegroundColor DarkGray }
Write-Host ""

# ── Ensure Node.js ─────────────────────────────────────────────────────────────

function Ensure-Node {
  Write-Section "Node.js"
  if (Have-Cmd node) {
    $ver = node --version
    Write-Note "Node.js $ver"
    return
  }

  Write-Action "Node.js not found — installing..."

  # Try winget first
  if (Have-Cmd winget) {
    DryBlock -Description "winget install OpenJS.NodeJS.LTS" -Block {
      winget install OpenJS.NodeJS.LTS 2>$null
      if ($LASTEXITCODE -ne 0) { throw "winget install failed" }
    }
    if ((Get-Command node -ErrorAction SilentlyContinue)) {
      Write-Note "Node.js installed via winget"
      return
    }
  }

  # Try choco
  if (Have-Cmd choco) {
    DryBlock -Description "choco install nodejs -y" -Block {
      choco install nodejs -y 2>$null
      refreshenv 2>$null
    }
    if ((Get-Command node -ErrorAction SilentlyContinue)) {
      Write-Note "Node.js installed via choco"
      return
    }
  }

  # Fallback: download directly
  Write-Warn "Could not install Node.js automatically."
  Write-Warn "Download from https://nodejs.org/ and re-run this script."
  if (-not $DryRun) { exit 1 }
}

# ── Ensure git ─────────────────────────────────────────────────────────────────

function Ensure-Git {
  if (Have-Cmd git) { return }

  Write-Section "Git"
  Write-Action "Git not found — installing..."

  if (Have-Cmd winget) {
    DryBlock -Description "winget install Git.Git" -Block {
      winget install Git.Git 2>$null
    }
    if ((Get-Command git -ErrorAction SilentlyContinue)) {
      Write-Note "Git installed via winget"
      return
    }
  }

  if (Have-Cmd choco) {
    DryBlock -Description "choco install git -y" -Block {
      choco install git -y 2>$null
    }
  }

  Write-Warn "Git installation may require a restart. Continuing..."
}

# ── Verify opencode plugin ─────────────────────────────────────────────────────

function Verify-Plugin {
  Write-Section "Verifying Bizar plugin registration"

  if (-not (Have-File $OpenCodeConfig)) {
    Write-Warn "opencode.json not found at $OpenCodeConfig — plugin not registered"
    return
  }

  try {
    $json = Get-Content $OpenCodeConfig -Raw | ConvertFrom-Json
  } catch {
    Write-Warn "Could not parse opencode.json"
    return
  }

  $hasPlugin = $false
  if ($json.plugin) {
    foreach ($p in $json.plugin) {
      if ($p[0] -match 'plugins/bizar') {
        $hasPlugin = $true
        break
      }
    }
  }

  if ($hasPlugin) {
    Write-Note "Bizar plugin registered in opencode.json"
    return
  }

  Write-Action "Adding Bizar plugin entry..."

  DryBlock -Description "patch opencode.json" -Block {
    if (-not $json.plugin) {
      $json | Add-Member -MemberType NoteProperty -Name 'plugin' -Value @()
    }
    $entry = @(
      "./plugins/bizar/index.ts",
      @{
        loopThresholdWarn = 5
        loopThresholdEscalate = 8
        loopThresholdBlock = 12
        loopWindowSize = 10
      }
    )
    $json.plugin += ,$entry
    $json | ConvertTo-Json -Depth 10 | Set-Content $OpenCodeConfig -Encoding UTF8
  }

  Write-Note "opencode.json updated with Bizar plugin"
}

# ── Verify plugin directory ────────────────────────────────────────────────────

function Verify-PluginDir {
  Write-Section "Verifying plugin directory"

  if (Test-Path $PluginDir) {
    Write-Note "plugin directory exists at $PluginDir"
    return
  }

  Write-Action "Setting up plugin directory..."
  DryBlock -Description "mkdir $PluginDir + copy from repo" -Block {
    New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null
    $srcPlugin = "$RepoDir\plugins\bizar"
    if (Test-Path $srcPlugin) {
      Copy-Item "$srcPlugin\*" $PluginDir -Recurse -Force
      Write-Note "plugin files copied from repo"
    } else {
      Write-Warn "no plugin source found in repo"
    }
  }
}

# ── Install config via cli/install.mjs ─────────────────────────────────────────

function Install-Config {
  Write-Section "Installing BizarHarness config files"
  $installMjs = "$RepoDir\cli\install.mjs"

  if (-not (Test-Path $installMjs)) {
    Write-Warn "cli/install.mjs not found"
    return
  }

  Write-Action "Running cli/install.mjs..."
  DryBlock -Description "node cli/install.mjs --non-interactive" -Block {
    $result = & node $installMjs --non-interactive 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Note "config files installed"
    } else {
      Write-Warn "cli/install.mjs exited with code $LASTEXITCODE"
      $result | Out-String | Write-Dim
    }
  }
}

# ── Install background service ─────────────────────────────────────────────────

function Install-Service {
  Write-Section "Installing background service"
  $svcMjs = "$RepoDir\scripts\install-service.mjs"

  if (-not (Test-Path $svcMjs)) {
    Write-Warn "scripts/install-service.mjs not found"
    return
  }

  Write-Action "Running install-service.mjs..."
  DryBlock -Description "node scripts/install-service.mjs" -Block {
    $result = & node $svcMjs 2>&1
    $LASTEXITCODE = 0  # non-zero from service script isn't fatal
    try {
      $parsed = $result -join "`n" | ConvertFrom-Json
      if ($parsed.ok -eq $true) {
        Write-Note "service registration complete"
      } else {
        if ($parsed.skipped) {
          Write-Dim "  (service-controller not yet available)"
        }
        Write-Warn "service registration had issues: $($parsed.error)"
      }
    } catch {
      Write-Warn "could not parse service result"
    }
  }
}

# ── Check deps via check-deps.mjs ──────────────────────────────────────────────

function Check-Deps {
  Write-Section "Checking dependencies"
  $checkDeps = "$RepoDir\scripts\check-deps.mjs"

  if (-not (Test-Path $checkDeps)) {
    Write-Warn "scripts/check-deps.mjs not found"
    return
  }

  Write-Action "Running dependency detector..."
  try {
    $json = & node $checkDeps --strict 2>$null | ConvertFrom-Json
    if ($json.ok -eq $true) {
      Write-Note "all required dependencies satisfied"
      return
    }

    foreach ($m in $json.missing) {
      if ($m.name -eq 'tmux') { continue }  # optional
      Write-Warn "missing dependency: $($m.name) ($($m.required))"
    }
  } catch {
    Write-Warn "dependency detector failed: $_"
  }
}

# ── Ensure repo ────────────────────────────────────────────────────────────────

function Ensure-Repo {
  if ($Update) {
    Write-Section "Updating BizarHarness repository"
    Write-Action "Pulling latest..."
    DryBlock -Description "git pull --ff-only" -Block {
      git -C $RepoDir pull --ff-only 2>$null
    }
    Write-Note "repository updated"
    return
  }

  if (Test-Path "$RepoDir\.git") {
    Write-Note "repository already present"
    if ($Force) {
      DryBlock -Description "git pull --ff-only" -Block {
        git -C $RepoDir pull --ff-only 2>$null
      }
    }
    return
  }

  Write-Section "Cloning BizarHarness repository"
  Write-Action "Cloning..."
  DryBlock -Description "git clone https://github.com/DrB0rk/BizarHarness.git" -Block {
    git clone https://github.com/DrB0rk/BizarHarness.git $RepoDir 2>$null
  }
  Write-Note "cloned"
}

# ── Final banner ───────────────────────────────────────────────────────────────

function Write-Banner {
  Write-Section "Install complete"
  Write-Host "`n┌────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
  Write-Host "│  BizarHarness ready.                                       │" -ForegroundColor Cyan
  Write-Host "│                                                            │" -ForegroundColor Cyan
  Write-Host "│  ✓ Cross-platform installer v3.22.0                        │" -ForegroundColor Cyan
  Write-Host "│                                                            │" -ForegroundColor Cyan
  Write-Host "│  Dashboard: http://localhost:3333                          │" -ForegroundColor Cyan
  Write-Host "│                                                            │" -ForegroundColor Cyan
  Write-Host "│  Next:                                                     │" -ForegroundColor Cyan
  Write-Host "│    1. Restart opencode to pick up new config               │" -ForegroundColor Cyan
  Write-Host "│    2. Run /connect in opencode to add API keys              │" -ForegroundColor Cyan
  Write-Host "│    3. Run 'bizar dash start' to launch the dashboard       │" -ForegroundColor Cyan
  Write-Host "│    4. Visit http://localhost:3333 in your browser           │" -ForegroundColor Cyan
  Write-Host "└────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
  Write-Host ""

  if ($DryRun) {
    Write-Warn "DRY RUN — no changes were made"
  }
}

# ── Main ───────────────────────────────────────────────────────────────────────

function Main {
  Ensure-Node
  Ensure-Git
  Check-Deps
  Ensure-Repo
  Install-Config
  Verify-PluginDir
  Verify-Plugin
  Install-Service
  Write-Banner
}

Main
