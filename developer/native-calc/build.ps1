param([string]$Compiler = 'zcc')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    # Keep the larger native UI below the existing stack-space limit. The TAP
    # BASIC loader fits below this origin; system variables remain below it.
    $origin = 24000
    & $Compiler '+zx' '-vn' '-O3' "-zorg=$origin" '-pragma-define:CRT_DISABLELOADER=1' '-pragma-define:REGISTER_SP=65280' 'calc.c' 'fill.c' 'screen.asm' '-lm' '-m' '-create-app' '-o' 'spectrum-calc.bin'
    if ($LASTEXITCODE -ne 0) { throw 'Native Spectrum Calc compilation failed.' }
    $map = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'spectrum-calc.map'))
    function Get-Symbol([string]$Name) {
        $pattern = '(?m)^' + [regex]::Escape($Name) + '\s+= \$([0-9A-Fa-f]+)'
        $match = [regex]::Match($map, $pattern)
        if (-not $match.Success) { throw "Missing native symbol: $Name" }
        return [Convert]::ToInt32($match.Groups[1].Value, 16)
    }
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'spectrum-calc.bin'))
    $end = Get-Symbol '__BSS_END_tail'
    if ($end -gt 62000 -or $origin + $bytes.Length -gt 62000) { throw 'Native program leaves insufficient stack space.' }
    $program = [ordered]@{
        origin = $origin
        main = Get-Symbol '_main'
        cells = Get-Symbol '_sheet_cells'
        cellBytes = 16384
        values = Get-Symbol '_sheet_values'
        cacheIds = Get-Symbol '_sheet_cache_ids'
        cacheSlots = 64
        errors = Get-Symbol '_sheet_errors'
        row = Get-Symbol '_sheet_row'
        col = Get-Symbol '_sheet_col'
        top = Get-Symbol '_sheet_top'
        left = Get-Symbol '_sheet_left'
        ready = Get-Symbol '_sheet_ready'
        initialized = Get-Symbol '_sheet_initialized'
        editing = Get-Symbol '_editing'
        helpActive = Get-Symbol '_help_active'
        recalculate = Get-Symbol '_recalculate'
        fillMode = Get-Symbol '_fill_mode'
        fillRow = Get-Symbol '_fill_row'
        fillCol = Get-Symbol '_fill_col'
        bssEnd = $end
        base64 = [Convert]::ToBase64String($bytes)
    }
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'program.json'), ($program | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
    Write-Host "Native Spectrum Calc generated: $($bytes.Length) bytes, RAM end $end."
} finally { Pop-Location }
