$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$destination = Join-Path $projectRoot "artifacts\release\Mora-Desktop-$version-source.zip"
if (Test-Path -LiteralPath $destination) { throw "Archive already exists: $destination" }

$rootFiles = @('.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'Open Mora Desktop.cmd', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')
$files = @(git -C $projectRoot ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'Could not list public source files.' }
$files = @($files | Where-Object { $_ -in $rootFiles -or $_ -match '^(src|tests|scripts|docs|muse-plugins|\.github)/' } | Sort-Object -Unique)
if ($files.Count -eq 0) { throw 'No source files found.' }
foreach ($relative in $files) {
    if ($relative -match '(?i)(^|/)(\.git|node_modules|artifacts|dist|backups?|user-data|sessions|\.superpowers)(/|$)|AGENTS\.override|(^|/)(preferences|conversations|auth|credentials|secrets)\.(json|jsonl)|\.(pem|pfx|key|bak|log)$|(^|/)\.env($|\.)') { throw "Private or generated file: $relative" }
    $absolute = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $absolute.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Source outside project: $relative" }
    if ((Get-Item -LiteralPath $absolute).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked source file: $relative" }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
$archive = [IO.Compression.ZipFile]::Open($destination, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in $files) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectRoot $relative), "mora-desktop/$relative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$check = [IO.Compression.ZipFile]::OpenRead($destination)
try {
    $actual = @($check.Entries.FullName | Sort-Object)
    $expected = @($files | ForEach-Object { "mora-desktop/$_" } | Sort-Object)
    if (@(Compare-Object $expected $actual).Count) { throw 'Archive membership differs from the source list.' }
} finally { $check.Dispose() }
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($destination))" | Set-Content -LiteralPath "$destination.sha256" -Encoding ascii
Write-Output "PASS source archive: $($files.Count) public files; membership checked; SHA-256 written"
Write-Output $destination
