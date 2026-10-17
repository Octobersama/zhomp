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
$ManifestPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\install-manifest.tsv"))
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
	throw "Install manifest not found: $ManifestPath"
}
$Removed = $false
$ManifestLines = Get-Content -LiteralPath $ManifestPath -Encoding UTF8
foreach ($Line in $ManifestLines) {
	$Fields = $Line.Split([char]9)
	if ($Fields.Count -ne 4 -or [string]::IsNullOrWhiteSpace($Fields[0]) -or [string]::IsNullOrWhiteSpace($Fields[1]) -or [string]::IsNullOrWhiteSpace($Fields[2]) -or [string]::IsNullOrWhiteSpace($Fields[3])) {
		throw "Invalid install manifest row: $Line"
	}
	$RelativePath = $Fields[2]
	$NativeRelativePath = $RelativePath.Replace([char]47, [char]92)
	$Segments = $NativeRelativePath.Split([IO.Path]::DirectorySeparatorChar)
	if ([IO.Path]::IsPathRooted($NativeRelativePath) -or $RelativePath.Contains('\') -or ($Segments -contains '') -or ($Segments -contains '.') -or ($Segments -contains '..')) {
		throw "Install manifest destination must be a relative path: $RelativePath"
	}
	$File = Join-Path $HomeDir $NativeRelativePath
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
