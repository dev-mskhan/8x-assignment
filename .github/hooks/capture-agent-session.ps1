param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("userPromptSubmitted", "agentStop")]
    [string] $Event
)

$ErrorActionPreference = "Stop"

# ---- Settings ---------------------------------------------------------------
$projectName = "8x-assignment"
$author      = "dev-mskhan"
$toolName    = "github-copilot-cli"
# -----------------------------------------------------------------------------
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDirectory = Join-Path $repositoryRoot ".agent-logs"
$stateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "$projectName-agent-logs"

function ConvertTo-UtcDateTime {
    param($Value)
    if ($null -eq $Value) { return [DateTime]::UtcNow }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime }
    try {
        return [DateTimeOffset]::Parse(
            [string]$Value, $invariant,
            [System.Globalization.DateTimeStyles]::AssumeUniversal).UtcDateTime
    } catch {
        return [DateTime]::UtcNow
    }
}

function Format-Iso {
    param([DateTime] $Utc)
    return $Utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $invariant)
}

# Stored times may come back from the state file as strings (5.1) or DateTime objects (7+).
function Format-StoredTime {
    param($Value)
    if ($Value -is [string] -and $Value -eq "unknown") { return "unknown" }
    return Format-Iso (ConvertTo-UtcDateTime $Value)
}

function Add-Line {
    param([System.Text.StringBuilder] $Builder, [string] $Text = "")
    [void]$Builder.Append($Text).Append("`n")
}

# The CLI may still hold events.jsonl open for writing, which makes File.ReadAllLines fail
# with a sharing violation on Windows. Open it with ReadWrite sharing instead.
function Read-SharedLines {
    param([string] $Path)
    $stream = New-Object System.IO.FileStream(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite)
    try {
        $reader = New-Object System.IO.StreamReader($stream, $utf8NoBom)
        $text = $reader.ReadToEnd()
    } finally {
        $stream.Dispose()
    }
    return ($text -split "\r?\n")
}

# Finds the last non-empty final assistant message of the current turn, and the model that was
# active when it was produced (session.start.selectedModel, then session.model_change.newModel).
function Get-FinalExchange {
    param([string] $Path)

    $events = New-Object System.Collections.ArrayList
    foreach ($line in @(Read-SharedLines -Path $Path)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { [void]$events.Add(($line | ConvertFrom-Json)) } catch { continue }
    }

    $turnId = $null
    foreach ($e in $events) {
        if ($e.type -eq "user.message") { $turnId = $e.data.turnId }
    }

    $currentModel = $null
    $final = $null
    $finalModel = $null
    foreach ($e in $events) {
        $d = $e.data
        if ($e.type -eq "session.start" -or $e.type -eq "session.resume") {
            if (-not [string]::IsNullOrWhiteSpace([string]$d.selectedModel)) { $currentModel = [string]$d.selectedModel }
        } elseif ($e.type -eq "session.model_change") {
            if (-not [string]::IsNullOrWhiteSpace([string]$d.newModel)) { $currentModel = [string]$d.newModel }
        } elseif ($e.type -eq "assistant.message") {
            if ($null -ne $turnId -and $d.turnId -ne $turnId) { continue }
            if ($d.phase -and $d.phase -ne "final_answer") { continue }
            if ($d.content -isnot [string] -or [string]::IsNullOrWhiteSpace($d.content)) { continue }
            $final = $e
            $finalModel = $currentModel
            if (-not [string]::IsNullOrWhiteSpace([string]$d.model)) { $finalModel = [string]$d.model }
        }
    }

    if ($null -eq $final) { return $null }
    return [pscustomobject]@{ Message = $final; Model = $finalModel }
}

# ---- Read and validate the hook payload -------------------------------------
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8NoBom)
$payloadJson = $reader.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($payloadJson)) {
    [Console]::Error.WriteLine("Agent capture hook received an empty payload for '$Event'.")
    exit 1
}

try {
    $payload = $payloadJson | ConvertFrom-Json
} catch {
    [Console]::Error.WriteLine("Agent capture hook received invalid JSON for '$Event': $($_.Exception.Message)")
    exit 1
}

if ([string]::IsNullOrWhiteSpace([string]$payload.sessionId)) {
    [Console]::Error.WriteLine("Agent capture hook payload is missing sessionId.")
    exit 1
}

$safeSessionId = [regex]::Replace([string]$payload.sessionId, "[^A-Za-z0-9_-]", "")
if ([string]::IsNullOrWhiteSpace($safeSessionId)) {
    [Console]::Error.WriteLine("Agent capture hook received an invalid sessionId.")
    exit 1
}
# The format shows the full id in the front matter and the short id everywhere else.
$shortSessionId = $safeSessionId
if ($shortSessionId.Length -gt 8) { $shortSessionId = $shortSessionId.Substring(0, 8) }

# ---- Load per-session state -------------------------------------------------
[System.IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
$statePath = Join-Path $stateDirectory "$safeSessionId.json"
$state = $null
if ([System.IO.File]::Exists($statePath)) {
    try {
        $state = [System.IO.File]::ReadAllText($statePath, $utf8NoBom) | ConvertFrom-Json
    } catch {
        [Console]::Error.WriteLine("Could not read pending capture state: $($_.Exception.Message)")
        exit 1
    }
}

function Save-State {
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 100), $utf8NoBom)
}

# ---- userPromptSubmitted: remember the prompt until the turn ends -----------
if ($Event -eq "userPromptSubmitted") {
    if ($payload.prompt -isnot [string]) {
        [Console]::Error.WriteLine("Prompt capture payload has no string prompt.")
        exit 1
    }

    $promptMs = 0
    try { $promptMs = [long]$payload.timestamp } catch { $promptMs = 0 }
    if ($promptMs -le 0) { $promptMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

    if ($null -eq $state) {
        $state = [pscustomobject]@{
            sessionId     = [string]$payload.sessionId
            entries       = @()
            pendingPrompt = $null
            lastMessageId = $null
        }
    }

    # A previous prompt that never got a final response (turn interrupted) must not be lost.
    if ($null -ne $state.pendingPrompt) {
        $earlier = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$state.pendingPrompt.timestamp).UtcDateTime
        $orphan = [pscustomobject]@{
            promptTime   = Format-Iso $earlier
            responseTime = "unknown"
            model        = "unknown"
            interrupted  = $true
            prompt       = [string]$state.pendingPrompt.content
            response     = "[no final response was captured for this prompt]"
        }
        $state.entries = @($state.entries) + @($orphan)
    }

    $state | Add-Member -Force -NotePropertyName pendingPrompt -NotePropertyValue ([pscustomobject]@{
        content   = [string]$payload.prompt
        timestamp = [long]$promptMs
    })
    Save-State
    exit 0
}

# ---- agentStop: pair the pending prompt with the final response -------------
$transcriptPath = [string]$payload.transcriptPath
if ([string]::IsNullOrWhiteSpace($transcriptPath) -or -not [System.IO.File]::Exists($transcriptPath)) {
    [Console]::Error.WriteLine("Agent stop payload does not reference an available transcript.")
    exit 1
}

# The final message may not be flushed to the transcript the instant the hook fires.
$found = $null
for ($attempt = 1; $attempt -le 5 -and $null -eq $found; $attempt++) {
    $found = Get-FinalExchange -Path $transcriptPath
    if ($null -eq $found -and $attempt -lt 5) { Start-Sleep -Milliseconds 400 }
}
if ($null -eq $found) {
    [Console]::Error.WriteLine("No final assistant response was found for session '$safeSessionId'.")
    exit 1
}

$finalMessage = $found.Message
$messageId = [string]$finalMessage.data.messageId
if ($null -ne $state -and $messageId -and $messageId -eq [string]$state.lastMessageId) {
    exit 0   # duplicate stop event for a response that is already logged
}
if ($null -eq $state -or $null -eq $state.pendingPrompt) {
    [Console]::Error.WriteLine("No pending prompt exists for session '$safeSessionId'.")
    exit 1
}

$promptTime = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$state.pendingPrompt.timestamp).UtcDateTime
$responseTime = ConvertTo-UtcDateTime $finalMessage.timestamp
$model = [string]$found.Model
if ([string]::IsNullOrWhiteSpace($model)) { $model = "unknown (not exposed by transcript)" }

$entry = [pscustomobject]@{
    promptTime   = Format-Iso $promptTime
    responseTime = Format-Iso $responseTime
    model        = $model
    interrupted  = $false
    prompt       = [string]$state.pendingPrompt.content
    response     = [string]$finalMessage.data.content
}
$state.entries = @($state.entries) + @($entry)
$state | Add-Member -Force -NotePropertyName pendingPrompt -NotePropertyValue $null
$state | Add-Member -Force -NotePropertyName lastMessageId -NotePropertyValue $messageId

# ---- Render the session file in the required format -------------------------
$firstPromptTime = ConvertTo-UtcDateTime $state.entries[0].promptTime
$logName = "{0}_{1}.md" -f $firstPromptTime.ToString("yyyy-MM-dd_HH-mm-ss", $invariant), $safeSessionId
$logPath = Join-Path $logDirectory $logName

$models = @($state.entries | Where-Object { -not $_.interrupted } | ForEach-Object { [string]$_.model } | Select-Object -Unique)
if ($models.Count -eq 0) { $models = @("unknown") }

$b = New-Object System.Text.StringBuilder
Add-Line $b "---"
Add-Line $b "session_id: $safeSessionId"
Add-Line $b "date: $($firstPromptTime.ToString('yyyy-MM-dd', $invariant))"
Add-Line $b "author: $author"
Add-Line $b "model: $($models -join ', ')"
Add-Line $b "tool: $toolName"
Add-Line $b "project: $projectName"
Add-Line $b "total_exchanges: $(@($state.entries).Count)"
Add-Line $b "first_prompt_time: $(Format-StoredTime $state.entries[0].promptTime)"
Add-Line $b "last_prompt_time: $(Format-StoredTime $entry.promptTime)"
Add-Line $b "---"
Add-Line $b
Add-Line $b "# Session Log - $($firstPromptTime.ToString('yyyy-MM-dd', $invariant))"
Add-Line $b
Add-Line $b "Session: ``$shortSessionId`` | Project: ``$projectName`` | Author: ``$author``"
Add-Line $b
Add-Line $b "---"
Add-Line $b

$number = 0
foreach ($logged in $state.entries) {
    $number++
    Add-Line $b "[LOG_ENTRY type=PROMPT num=$number session=$shortSessionId]"
    Add-Line $b "timestamp: $(Format-StoredTime $logged.promptTime)"
    Add-Line $b "model: $($logged.model)"
    Add-Line $b
    Add-Line $b ([string]$logged.prompt)
    Add-Line $b
    Add-Line $b
    Add-Line $b "[LOG_ENTRY type=RESPONSE num=$number session=$shortSessionId]"
    Add-Line $b "timestamp: $(Format-StoredTime $logged.responseTime)"
    Add-Line $b "model: $($logged.model)"
    Add-Line $b
    Add-Line $b ([string]$logged.response)
    Add-Line $b
    Add-Line $b
}

[System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null
[System.IO.File]::WriteAllText($logPath, $b.ToString(), $utf8NoBom)
Save-State

# The logs ship with the repo: refuse to run quietly if they are being ignored.
& git -C $repositoryRoot check-ignore --no-index -q -- $logPath
if ($LASTEXITCODE -eq 0) {
    [Console]::Error.WriteLine("'.agent-logs/' is gitignored. Remove it from .gitignore; the logs must be committed.")
    exit 1
}

& git -C $repositoryRoot add -- $logPath
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("Could not stage capture file '$logPath'.")
    exit 1
}
