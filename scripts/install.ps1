<#
.SYNOPSIS
  Forwarding helper that calls the root install.ps1 from the scripts/ directory.

.DESCRIPTION
  This file exists so that scripts/ can find install.ps1 when running from
  the scripts/ directory. It simply resolves and invokes the root install.ps1,
  forwarding all arguments.
#>

#Requires -Version 5.1
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path "$ScriptDir\.."
$RootInstall = "$RootDir\install.ps1"

if (-not (Test-Path $RootInstall)) {
  Write-Error "Root install.ps1 not found at $RootInstall"
  exit 1
}

# Forward all parameters to the root install.ps1
& $RootInstall @PSBoundParameters
