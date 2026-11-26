# Run from PowerShell on the Renewal Lab host. Internet is needed only for installation.
$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot '../.local-data/speech'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$runtime = Join-Path $directory 'runtime'
$python = Join-Path $runtime 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    python -m venv $runtime
    if ($LASTEXITCODE) { throw 'Could not create the Python environment' }
}
& $python -m pip install sherpa-onnx==2.0.1 pypinyin==0.55.0 numpy
if ($LASTEXITCODE) { throw 'Could not install the speech runtime' }
$base = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/'
$expected = @{
    'model.int8.onnx'='c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'
    'tokens.txt'='f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' # SHA-256 of the public vocabulary file; gitleaks:allow
}
foreach ($name in $expected.Keys) {
    $destination = Join-Path $directory $name
    if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination).Hash -eq $expected[$name]) { continue }
    $temp = Join-Path $directory ([guid]::NewGuid().ToString() + '.tmp')
    try {
        curl.exe --fail --location --retry 2 --output $temp ($base + $name)
        if ($LASTEXITCODE -or (Get-FileHash -LiteralPath $temp).Hash -ne $expected[$name]) { throw "Download verification failed for $name" }
        Move-Item -LiteralPath $temp -Destination $destination -Force
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
    }
}
Write-Output 'Local speech model ready.'
