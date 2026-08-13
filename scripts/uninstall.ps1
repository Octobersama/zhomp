# zhomp uninstall (Windows PowerShell)
#
# Removes the extension + dictionary + `zhomp.cmd` launcher.
$ErrorActionPreference = "Stop"

$HomeDir = $HOME
$OmpAgentExtFile = Join-Path $HomeDir ".omp\agent\extensions\zhomp.ts"
$OmpZhDir = Join-Path $HomeDir ".omp\zh"
$BunBinDir = Join-Path $HomeDir ".bun\bin"

$removed = $false

foreach ($f in @(
	$OmpAgentExtFile,
	(Join-Path $BunBinDir "zhomp"),
	(Join-Path $BunBinDir "zhomp.cmd")
)) {
	if (Test-Path $f) {
		Remove-Item -Force $f
		Write-Host "Removed: $f"
		$removed = $true
	}
}

# Remove the dict dir only when it contains nothing but dict.json.
if (Test-Path $OmpZhDir) {
	$remaining = @(Get-ChildItem -Force $OmpZhDir -ErrorAction SilentlyContinue).Count
	if ($remaining -eq 0) {
		Remove-Item -Force $OmpZhDir
		Write-Host "Removed empty dir: $OmpZhDir"
	} elseif ($remaining -eq 1 -and (Test-Path (Join-Path $OmpZhDir "dict.json"))) {
		Remove-Item -Force (Join-Path $OmpZhDir "dict.json")
		Remove-Item -Force $OmpZhDir
		Write-Host "Removed dict + dir: $OmpZhDir"
	}
}

if ($removed) {
	Write-Host ""
	Write-Host "OK: zhomp uninstalled, UI back to English."
} else {
	Write-Host "zhomp is not installed."
}
