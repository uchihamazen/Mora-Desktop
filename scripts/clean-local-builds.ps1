[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = Join-Path $projectRoot 'artifacts'
$targets = @()
if (Test-Path -LiteralPath $artifactRoot) {
  # These are old application builds, not conversation/profile backups.
  $targets += Get-ChildItem -LiteralPath $artifactRoot -Directory | Where-Object {
    $_.Name -like '*-release' -or $_.Name -like 'desktop-backup-*'
  } | ForEach-Object { $_.FullName }
}
$targets += @(
  'artifacts/release/win-unpacked',
  'artifacts/release/builder-debug.yml',
  'artifacts/release/Muse-Desktop-Setup-0.1.0-x64.exe.blockmap',
  'dist/win-unpacked',
  'dist/muse-desktop-0.1.0-x64.nsis.7z',
  'dist/builder-debug.yml'
) | ForEach-Object { Join-Path $projectRoot $_ }
$active = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath
foreach ($candidate in $targets) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  $target = (Resolve-Path -LiteralPath $candidate).Path
  if (-not $target.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup target is outside the project.' }
  if ($active | Where-Object { $_.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or $_.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) }) {
    throw "Close the obsolete test build first: $target"
  }
  if ($PSCmdlet.ShouldProcess($target, 'Remove obsolete local build')) { Remove-Item -LiteralPath $target -Recurse -Force }
}
Write-Output 'Cleanup retains the running dist package, Setup/checksum/source ZIP, dependencies and all chat/profile backups.'
