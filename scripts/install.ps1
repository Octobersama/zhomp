# zhomp install (Windows PowerShell)
#
# Installs: copies the extension + dictionary, generates `zhomp.cmd`.
$ErrorActionPreference = "Stop"

# Repo dir = parent of the scripts dir.
$RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$HomeDir = $HOME
$OmpAgentExtDir = Join-Path $HomeDir ".omp\agent\extensions"
$OmpZhDir = Join-Path $HomeDir ".omp\zh"
$BunBinDir = Join-Path $HomeDir ".bun\bin"

# ── Dependency check ───────────────────────────────────────────────────────
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
	Write-Error "bun not found. Install it first: https://bun.sh"
	exit 1
}

$pkgDir = Join-Path $HomeDir ".bun\install\global\node_modules\@oh-my-pi\pi-coding-agent"
if (-not (Test-Path $pkgDir)) {
	try {
		$globalRoot = bun pm root -g 2>$null | Select-Object -First 1
		if ($globalRoot) {
			$cand = Join-Path $globalRoot "@oh-my-pi\pi-coding-agent"
			if (Test-Path $cand) { $pkgDir = $cand }
		}
	} catch { }
}
if (-not (Test-Path (Join-Path $pkgDir "src\cli.ts"))) {
	Write-Error "@oh-my-pi/pi-coding-agent global package not found. Run: bun install -g @oh-my-pi/pi-coding-agent"
	exit 1
}
Write-Host "Found omp package: $pkgDir"

# ── Install ────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $OmpAgentExtDir, $OmpZhDir, $BunBinDir | Out-Null
Copy-Item (Join-Path $RepoDir "extensions\zhomp.ts") (Join-Path $OmpAgentExtDir "zhomp.ts") -Force
Copy-Item (Join-Path $RepoDir "dict\zh-CN.json") (Join-Path $OmpZhDir "dict.json") -Force

# Generate zhomp.cmd (source-mode launcher; official `omp` stays untouched)
$cmdContent = "@echo off`r`nrem zhomp: run omp from src so the zh extension shares module instances.`r`nbun `"$pkgDir\src\cli.ts`" %*`r`n"
Set-Content -Path (Join-Path $BunBinDir "zhomp.cmd") -Value $cmdContent -Encoding ASCII

Write-Host ""
Write-Host "OK: zhomp installed"
Write-Host "  extension: $OmpAgentExtDir\zhomp.ts"
Write-Host "  dict:      $OmpZhDir\dict.json"
Write-Host "  launcher:  $BunBinDir\zhomp.cmd"
Write-Host ""
Write-Host "Usage:"
Write-Host "  zhomp           # Chinese UI (source mode; use Windows Terminal + UTF-8)"
Write-Host "  omp             # official (English, unaffected)"
Write-Host "Uninstall:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1"
