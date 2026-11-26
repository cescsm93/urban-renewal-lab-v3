param([Parameter(Mandatory=$true)][int]$BuildProcessId)

$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $ProjectRoot
$Log = Join-Path $ProjectRoot '.local-data/mineru-finalize.log'
$Audit = Join-Path $ProjectRoot '.local-data/mineru-audit.json'

while (Get-Process -Id $BuildProcessId -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 30
}

"Initial MinerU process ended: $(Get-Date -Format o)" | Add-Content -LiteralPath $Log
python scripts/restore_missing_mineru_pages.py --include-short *>> $Log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python scripts/vectorize_local_pdfs.py --database .local-data/policy-mineru-index.sqlite *>> $Log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python scripts/audit_mineru_index.py | Set-Content -LiteralPath $Audit -Encoding UTF8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
"Final audit written: $(Get-Date -Format o)" | Add-Content -LiteralPath $Log
