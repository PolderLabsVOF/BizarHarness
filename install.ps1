<#
.SYNOPSIS
  BizarHarness Windows installer (PowerShell, v5.x — thin wrapper).

.DESCRIPTION
  Cross-platform installer for BizarHarness on Windows. v5.x is a
  thin wrapper that:
    1. Installs Windows-specific system deps (Node.js, git, jq) via
       winget → choco → npm fallback.
    2. Shells to `node cli/provision.mjs --mode=install` for everything
       else (agent files, plugin copy, cline.json patching, skills
       install, service registration via Task Scheduler, doctor check).

  v5.x — issue #7: On first install, registers the system service that
  auto-starts the dashboard at logon. On update mode, the service is
  stopped, the upgrade runs, and the service is restarted (so the
  freshly-installed code is loaded).

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

  # LightRAG via uv tool (optional but recommended for memory graph)
  if (Have-Cmd uv) {
    $uvBinDir = Join-Path $env:LOCALAPPDATA 'uv\data\tools\.bin'
    $lightragExe = if ($env:LOCALAPPDATA) { Join-Path $uvBinDir 'lightrag-server.exe' } else { $null }
    if ($lightragExe -and (Test-Path $lightragExe -ErrorAction SilentlyContinue)) {
      Write-Note "LightRAG server present"
    } else {
      Write-Action "Installing LightRAG via uv tool..."
      if (-not $DryRun) {
        try {
          $proc = Start-Process -FilePath 'uv' -ArgumentList @('tool', 'install', 'lightrag-hku[api]') -Wait -PassThru -NoNewWindow
          if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq $null) {
            Write-Note "LightRAG installed"
          } else {
            Write-Warn "LightRAG install failed — memory graph will not be available"
            Write-Dim "  Install later: uv tool install `"lightrag-hku[api]`""
          }
        } catch {
          Write-Warn "LightRAG install failed — memory graph will not be available"
          Write-Dim "  Install later: uv tool install `"lightrag-hku[api]`""
        }
      }
    }
  } else {
    Write-Dim "  uv not found — LightRAG not installed. Install uv then run:"
    Write-Dim "    uv tool install `"lightrag-hku[api]`""
  }
}

# ── Service registration (delegated to Node) ───────────────────────────────
function Install-AgentBrowser {
  <#
  .SYNOPSIS
    v6.0.0 — Install agent-browser (native Rust CLI from vercel-labs).
  .DESCRIPTION
    Replaces the v5.x browser-harness (Python CDP wrapper). Installed via npm.
    Soft-fail: agent-browser is optional. The Node-side provisioner
    (`cli/provision.mjs:ensureAgentBrowser`) will retry on first run.
  #>
  if (Have-Cmd agent-browser) {
    $ver = (& agent-browser --version 2>$null) -join '' -replace "`n",''
    Write-Note "agent-browser $ver already installed"
    return
  }
  if (-not (Have-Cmd npm)) {
    Write-Warn "npm not available - skipping agent-browser install"
    return
  }
  Write-Action "Installing agent-browser via npm..."
  if ($DryRun) {
    Write-Dim "  [DRY RUN] would run: npm install -g agent-browser"
    return
  }
  try {
    & npm install -g agent-browser 2>&1 | Out-Null
    $ver = (& agent-browser --version 2>$null) -join '' -replace "`n",''
    Write-Note "agent-browser $ver installed"
    & agent-browser install 2>&1 | Out-Null
    Write-Note "Chrome for Testing downloaded"
  } catch {
    Write-Warn "agent-browser install failed - the browser tools will not be available"
  }
}

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
  if ($Update) {
    # v5.x — issue #7. Update mode: the provisioner will stop the
    # running service, replace files, and restart it. We don't call
    # installService here because the unit may have been registered
    # already and the provisioner is the right place to do stop/
    # reinstall/start atomically.
    Write-Dim "update mode: service restart is handled by the Node provisioner"
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
Write-Host "  ⚡ BizarHarness Installer v6.0.0" -ForegroundColor Cyan
if ($Update) { Write-Host "  Update mode" -ForegroundColor DarkGray }
Write-Host ""

$os = (Get-CimInstance Win32_OperatingSystem).Caption
Write-Note "Detected $os"

Install-WindowsDeps
Install-AgentBrowser
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
Write-Host "│    1. Restart cline to pick up new config                │"
Write-Host "│    2. Run /connect in cline to add API keys              │"
Write-Host "│    3. Run 'bizar dash start' to launch the dashboard        │"
Write-Host "│    4. Visit http://localhost:4321 in your browser            │"
Write-Host "└────────────────────────────────────────────────────────────┘"
Write-Host ""

if ($DryRun) {
  Write-Warn "DRY RUN — no changes were made"
}