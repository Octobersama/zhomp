# Remove only zhomp-owned files. Bun is not required for uninstall.
$ErrorActionPreference = "Stop"
if ($env:OMP_ZH_HOME) {
	$HomeDir = $env:OMP_ZH_HOME
} elseif ($env:USERPROFILE) {
	$HomeDir = $env:USERPROFILE
} elseif ($env:HOME) {
	$HomeDir = $env:HOME
} else {
	$HomeDir = [Environment]::GetFolderPath("UserProfile")
}
if ($HomeDir -match '^/([A-Za-z])/(.*)$') { $HomeDir = $Matches[1] + ':/' + $Matches[2] }
if ($HomeDir -eq '~' -or $HomeDir.StartsWith('~/') -or $HomeDir.StartsWith('~\')) {
	$HomeDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) $HomeDir.Substring([Math]::Min(2, $HomeDir.Length))
}
$HomeDir = [IO.Path]::GetFullPath($HomeDir)
$ZhDir = Join-Path $HomeDir ".omp\zh"
$Removed = $false
$OwnedFiles = @(
	(Join-Path $HomeDir ".omp\agent\extensions\zhomp.ts"),
	(Join-Path $ZhDir "dict.json"),
	(Join-Path $ZhDir "launch.ts"),
	(Join-Path $ZhDir "host.ts"),
	(Join-Path $ZhDir "launch.json"),
	(Join-Path $ZhDir "model-ui.ts"),
	(Join-Path $ZhDir "zhomp.toml"),
	(Join-Path $HomeDir ".bun\bin\zhomp"),
	(Join-Path $HomeDir ".bun\bin\zhomp.cmd")
)
foreach ($File in $OwnedFiles) {
	if (Test-Path -LiteralPath $File) {
		$Item = Get-Item -LiteralPath $File -Force
		if ($Item.PSIsContainer) { throw "Refusing to delete a non-file target: $File" }
		Remove-Item -LiteralPath $File -Force
		Write-Host "Removed: $File"
		$Removed = $true
	}
}
if (Test-Path -LiteralPath $ZhDir -PathType Container) {
	if (@(Get-ChildItem -LiteralPath $ZhDir -Force).Count -eq 0) {
		[IO.Directory]::Delete($ZhDir)
	}
}
if ($Removed) {
	Write-Host "OK: zhomp uninstalled. User configuration, sessions and other files are unchanged."
} else {
	Write-Host "zhomp is not installed or has already been removed."
}
