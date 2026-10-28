param([ValidateSet('en', 'pt-PT')][string]$Locale = 'en')
$ErrorActionPreference = 'Stop'
$guideIsPortuguese = $Locale -eq 'pt-PT'
$guideSceneName = if ($guideIsPortuguese) { 'scenes.pt-PT.json' } else { 'scenes.json' }
$guideScenes = Get-Content -LiteralPath (Join-Path $PSScriptRoot $guideSceneName) -Encoding UTF8 -Raw | ConvertFrom-Json
$guideAudioDir = Join-Path $PSScriptRoot $(if ($guideIsPortuguese) { '.render/pt-PT/audio' } else { '.render/audio' })
[System.IO.Directory]::CreateDirectory($guideAudioDir) | Out-Null
$guideVoice = New-Object -ComObject SAPI.SpVoice
if ($guideIsPortuguese) {
    # Use the installed pt-PT OneCore voice directly, without registry changes.
    $guidePortugueseVoice = New-Object -ComObject SAPI.SpObjectToken
    $guidePortugueseVoice.SetId('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_ptPT_Helia')
    if ($guidePortugueseVoice.GetAttribute('Language') -ne '0816') { throw 'A Portuguese (Portugal) voice is required.' }
    $guideVoice.Voice = $guidePortugueseVoice
} else {
    $guideVoices = $guideVoice.GetVoices()
    for ($guideVoiceIndex = 0; $guideVoiceIndex -lt $guideVoices.Count; $guideVoiceIndex++) {
        if ($guideVoices.Item($guideVoiceIndex).GetDescription() -match 'Zira') {
            $guideVoice.Voice = $guideVoices.Item($guideVoiceIndex)
            break
        }
    }
}
Write-Output ('Voice: {0} ({1})' -f $guideVoice.Voice.GetDescription(), $guideVoice.Voice.GetAttribute('Language'))
$guideVoice.Rate = 0
$guideVoice.Volume = 100
for ($guideSceneIndex = 0; $guideSceneIndex -lt $guideScenes.Count; $guideSceneIndex++) {
    $guideSentenceIndex = 0
    foreach ($guideSentence in $guideScenes[$guideSceneIndex].speech) {
        $guideFile = Join-Path $guideAudioDir ('{0:D2}-{1:D2}.wav' -f ($guideSceneIndex + 1), ($guideSentenceIndex + 1))
        $guideStream = New-Object -ComObject SAPI.SpFileStream
        try {
            $guideStream.Open($guideFile, 3, $false)
            $guideVoice.AudioOutputStream = $guideStream
            [void]$guideVoice.Speak([string]$guideSentence)
        } finally {
            $guideStream.Close()
        }
        $guideSentenceIndex++
    }
    Write-Output ('Narration {0}/{1}: {2}' -f ($guideSceneIndex + 1), $guideScenes.Count, $guideScenes[$guideSceneIndex].title)
}
