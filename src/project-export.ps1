$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$entries = [IO.File]::ReadAllText($env:MORA_EXPORT_MANIFEST, [Text.Encoding]::UTF8) | ConvertFrom-Json
$archive = [IO.Compression.ZipFile]::Open($env:MORA_EXPORT_DESTINATION, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $entries) {
        if ($item.name -match '(^/|\\|(^|/)\.\.(/|$))') { throw 'Invalid archive entry.' }
        $entry = $archive.CreateEntry($item.name, [IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $data = [Convert]::FromBase64String($item.data)
            $stream.Write($data, 0, $data.Length)
        } finally { $stream.Dispose() }
    }
} finally { $archive.Dispose() }
