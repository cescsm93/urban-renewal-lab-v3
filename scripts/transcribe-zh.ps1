$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$culture = [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN')
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
$stream = New-Object System.IO.MemoryStream
try {
    [Console]::OpenStandardInput().CopyTo($stream)
    $stream.Position = 0
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $engine.SetInputToWaveStream($stream)
    while ($true) {
        try { $result = $engine.Recognize() }
        catch {
            if ($stream.Position -eq $stream.Length -and $_.Exception.InnerException -is [System.InvalidOperationException]) { break }
            throw
        }
        if ($null -eq $result) { break }
        if ($result.Text) { [Console]::Write($result.Text) }
    }
} finally {
    $stream.Dispose()
    $engine.Dispose()
}
