$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$privateDir = Join-Path $root '.local-data'
$envFile = Join-Path $privateDir 'postgis.env'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $envFile)) {
  $bytes = [byte[]]::new(24)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  @("POSTGRES_USER=renewal_lab", "POSTGRES_DB=renewal_lab", "POSTGRES_PASSWORD=$password") |
    Set-Content -LiteralPath $envFile -Encoding ascii
}
$compose = Join-Path $PSScriptRoot 'compose.yaml'
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not running. Open Docker Desktop first.' }
docker compose -f $compose up -d
if ($LASTEXITCODE -ne 0) { throw 'PostGIS container failed to start.' }
$ready = $false
for ($i = 0; $i -lt 24; $i++) {
  docker compose -f $compose exec -T db pg_isready -U renewal_lab -d renewal_lab 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $ready) { throw 'Database initialization timed out. Check docker compose logs db.' }
docker compose -f $compose exec -T db psql -U renewal_lab -d renewal_lab -Atc 'SELECT postgis_version();'
if ($LASTEXITCODE -ne 0) { throw 'PostGIS extension validation failed.' }
Get-Content -LiteralPath (Join-Path $PSScriptRoot '002_pilot.sql') -Raw |
  docker compose -f $compose exec -T db psql -v ON_ERROR_STOP=1 -U renewal_lab -d renewal_lab
if ($LASTEXITCODE -ne 0) { throw 'PostGIS schema migration failed.' }
Get-Content -LiteralPath (Join-Path $PSScriptRoot '003_archive.sql') -Raw |
  docker compose -f $compose exec -T db psql -v ON_ERROR_STOP=1 -U renewal_lab -d renewal_lab
if ($LASTEXITCODE -ne 0) { throw 'PostGIS archive migration failed.' }
Write-Host 'Local PostGIS is ready at 127.0.0.1:5432. Credentials are in .local-data/postgis.env.'
