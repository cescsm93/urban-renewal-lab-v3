$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dir = Join-Path $root '.local-data\postgis-backups'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $dir "renewal-lab-$stamp.dump"
docker exec renewal-lab-postgis pg_dump -U renewal_lab -d renewal_lab -Fc -f /tmp/renewal-lab.dump
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
docker cp 'renewal-lab-postgis:/tmp/renewal-lab.dump' $target
if ($LASTEXITCODE -ne 0) { throw 'Failed to copy database backup.' }
docker exec renewal-lab-postgis rm /tmp/renewal-lab.dump | Out-Null
Write-Host "Backup saved: $target"
