param([string]$Source = 'artifacts/self-build/win-unpacked')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = if ([IO.Path]::IsPathRooted($Source)) { $Source } else { Join-Path $projectRoot $Source }
$sourceDirectory = (Resolve-Path -LiteralPath $sourcePath).Path
$targetDirectory = Join-Path $projectRoot 'dist'
if (-not $sourceDirectory.StartsWith((Join-Path $projectRoot 'artifacts') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Install only a verified build staged inside this project artifacts directory.'
}
foreach ($required in @('Mora Desktop.exe', 'resources/app.asar', 'resources.pak', 'icudtl.dat')) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory $required) -PathType Leaf)) { throw "Incomplete desktop package: $required" }
}
$running = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($targetDirectory + '\', [StringComparison]::OrdinalIgnoreCase)
}
if ($running) { throw 'Close Mora Desktop first. Install from an external terminal, not its own engine.' }
$installedExecutable = Join-Path $targetDirectory 'Mora Desktop.exe'
if (Test-Path -LiteralPath $installedExecutable -PathType Leaf) {
  try {
    $writeCheck = [IO.File]::Open($installedExecutable, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $writeCheck.Dispose()
  } catch { throw 'Windows refused write access to the installed EXE. Review its antivirus alert before installing; security settings were not changed.' }
}
$backupDirectory = Join-Path $projectRoot ('artifacts/desktop-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
foreach ($oldFile in @('Mora Desktop.exe', 'resources/app.asar')) {
  $oldPath = Join-Path $targetDirectory $oldFile
  if (Test-Path -LiteralPath $oldPath -PathType Leaf) {
    $backupPath = Join-Path $backupDirectory $oldFile
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
    Copy-Item -LiteralPath $oldPath -Destination $backupPath
  }
}
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $sourceDirectory -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $targetDirectory -Recurse -Force
}
foreach ($file in @('Mora Desktop.exe', 'resources/app.asar')) {
  if ((Get-FileHash -LiteralPath (Join-Path $sourceDirectory $file)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $targetDirectory $file)).Hash) {
    throw "Installed file differs from staged build: $file"
  }
}
Write-Output 'Installed verified desktop files at dist/Mora Desktop.exe; existing chat data retained. Point any old manual shortcut at the renamed EXE.'
