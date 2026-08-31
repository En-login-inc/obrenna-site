#!/usr/bin/env pwsh

# Bootstrap script for local Docker Postgres setup (Windows / PowerShell).
# Starts Postgres and loads the auth schema. Safe to re-run.

$ErrorActionPreference = 'Stop'

# Paths resolve from the script location, not the caller's working directory.
$DbDir = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $DbDir 'docker-compose.auth.yml'
$SchemaFile = Join-Path $DbDir 'auth-schema-postgres.sql'
$Service = 'postgres-auth'
$DbUser = 'obrenna'
$DbName = 'obrenna-server-db'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'docker not found on PATH. Install Docker Desktop and retry.'
}

foreach ($f in @($ComposeFile, $SchemaFile)) {
    if (-not (Test-Path $f)) { throw "Missing required file: $f" }
}

# Splatted so switches like -d reach docker instead of being parsed by PowerShell.
$Compose = @('compose', '-f', $ComposeFile)

Write-Host 'Starting Postgres container...'
& docker @Compose up -d $Service
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }

Write-Host 'Waiting for Postgres to accept connections...'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    & docker @Compose exec -T $Service pg_isready -U $DbUser -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    & docker @Compose logs --tail 50 $Service
    throw 'Postgres did not become ready in 60s.'
}

Write-Host 'Applying schema...'
Get-Content -Raw $SchemaFile | & docker @Compose exec -T $Service psql -v ON_ERROR_STOP=1 -U $DbUser -d $DbName
if ($LASTEXITCODE -ne 0) { throw 'Schema load failed.' }

Write-Host 'Tables:'
& docker @Compose exec -T $Service psql -U $DbUser -d $DbName -c '\dt'

Write-Host "Auth database ready: postgresql://${DbUser}:obrenna@localhost:5432/$DbName"
