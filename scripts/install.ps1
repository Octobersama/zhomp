# zhomp installer for Windows PowerShell 5.1 or later.
$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$BunCommand = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue
if (-not $BunCommand) {
	throw "Bun not found. Install it first: https://bun.sh"
}
& $BunCommand.Source --no-install --no-env-file ("--config=" + (Join-Path $RepoDir "runtime\zhomp.toml")) (Join-Path $PSScriptRoot "install.ts")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
