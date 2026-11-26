# Obrenna-Server bootstrap for Windows (PowerShell 5.1+).
#
#   $env:OBRENNA_SITE_URL = 'https://<site>'; irm https://<site>/install/server.ps1 | iex
#
# Downloads the server bundle from the site, verifies its SHA-256 checksum,
# unpacks it and runs the installer, which installs Python and Ollama via
# winget if needed and starts the gateway (port 8787, LAN) and the control
# panel (port 8788, this computer only). Re-running upgrades in place.
& {
    $ErrorActionPreference = 'Stop'
    $site = if ($env:OBRENNA_SITE_URL) { $env:OBRENNA_SITE_URL } else { 'https://obrenna.com' }
    $site = $site.TrimEnd('/')
    $root = Join-Path $env:LOCALAPPDATA 'Obrenna\Server'
    $tmp = Join-Path $env:TEMP ('obrenna-server-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp, $root | Out-Null
    try {
        Write-Host "Downloading Obrenna-Server from $site ..."
        $archive = Join-Path $tmp 'server.tar.gz'
        Invoke-WebRequest -UseBasicParsing -Uri "$site/install/obrenna-server.tar.gz" -OutFile $archive
        $expected = ((Invoke-WebRequest -UseBasicParsing -Uri "$site/install/obrenna-server.tar.gz.sha256").Content -split '\s+')[0].Trim().ToLower()
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLower()
        if (-not $expected -or $expected -ne $actual) {
            throw 'Checksum mismatch: the downloaded server bundle is corrupt or was modified. Nothing was installed.'
        }
        $staging = Join-Path $root 'source.new'
        if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        tar.exe -xzf $archive -C $staging
        if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the server bundle (tar.exe is required; it ships with Windows 10 1803+).' }
        $source = Join-Path $root 'source'
        if (Test-Path $source) { Remove-Item -LiteralPath $source -Recurse -Force }
        Move-Item -LiteralPath $staging -Destination $source
    } finally {
        if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    }
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $source 'scripts\install.ps1') -SourcePath $source
}
