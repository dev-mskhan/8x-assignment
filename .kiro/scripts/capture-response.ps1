# capture-response.ps1
# Kiro Stop hook (end of an agent turn). Receives JSON on stdin: hook_event_name, cwd, session_id
# (and assistant_response on builds that send it).
#
# Pairs the response with the prompt recorded by capture-prompt.ps1, then re-renders
# .agent-logs/<YYYY-MM-DD_HH-MM-SS>_<session-id>.md in the assignment format and stages it.
#
# Some Kiro IDE builds send neither the prompt nor the response to hooks. For those, this script
# reads Kiro's own session transcript (~/.kiro/sessions/<workspace>/<session-id>/messages.jsonl)
# and takes the last user message and the last assistant message of the turn from it. If that
# cannot be read either, the entry says so and the debug log (outside the repo) records why.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).

param()

$ErrorActionPreference = "Stop"

# ---- Settings (keep identical in capture-prompt.ps1) ----------------------
$projectName       = "8x-assignment"
$author            = "dev-mskhan"
$toolName          = "kiro"
$defaultModel      = "auto"   # Kiro does not pass the model to hooks; edit when you switch models
$sessionReuseHours = 12       # used only when the payload carries no session_id
# -----------------------------------------------------------------------------

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$invariant = [System.Globalization.CultureInfo]::InvariantCulture

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
# Layout: <repo>/.kiro/scripts/<this file>. The repo root is TWO levels above the scripts folder.
$repoRoot    = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir      = Join-Path $repoRoot ".agent-logs"
$stateDir    = Join-Path ([System.IO.Path]::GetTempPath()) "$projectName-kiro-capture"
$currentPath = Join-Path $stateDir "current-session.json"
$debugPath   = Join-Path $stateDir "capture-debug.log"
$noResponseText  = "[no final response was captured for this prompt]"
$noPromptText    = "[prompt text not available in hook payload]"
$jsonHasDateKind = (Get-Command ConvertFrom-Json).Parameters.ContainsKey("DateKind")

# ---- Helpers (shared with capture-response.ps1) -----------------------------
function Format-Iso {
    param([DateTime] $Utc)
    return $Utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", $invariant)
}

function ConvertTo-IsoString {
    param($Value)
    if ($Value -is [DateTime]) { return (Format-Iso ($Value.ToUniversalTime())) }
    return [string]$Value
}

function ConvertTo-UtcDateTime {
    param($Value)
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    try {
        return [DateTimeOffset]::Parse(
            [string]$Value, $invariant,
            [System.Globalization.DateTimeStyles]::AssumeUniversal).UtcDateTime
    } catch {
        return [DateTime]::UtcNow
    }
}

function ConvertTo-SafeId {
    param($Value)
    if ($null -eq $Value) { return "" }
    return [regex]::Replace([string]$Value, "[^A-Za-z0-9_-]", "")
}

function Read-Json {
    param([string] $Text)
    if ($jsonHasDateKind) { return ($Text | ConvertFrom-Json -DateKind String) }
    return ($Text | ConvertFrom-Json)
}

function Get-Field {
    param($Object, [string[]] $Names)
    if ($null -eq $Object) { return $null }
    foreach ($n in $Names) {
        $p = $Object.PSObject.Properties[$n]
        if ($null -ne $p -and $null -ne $p.Value) { return $p.Value }
    }
    return $null
}

# Depth-first search for the first non-empty string stored under any of the given names.
function Find-FirstString {
    param($Object, [string[]] $Names, [int] $Depth = 0)
    if ($null -eq $Object -or $Depth -gt 5 -or $Object -is [string]) { return $null }
    if ($Object -is [System.Collections.IEnumerable]) {
        foreach ($item in $Object) {
            $r = Find-FirstString $item $Names ($Depth + 1)
            if ($r) { return $r }
        }
        return $null
    }
    foreach ($n in $Names) {
        $prop = $Object.PSObject.Properties[$n]
        if ($null -ne $prop -and $prop.Value -is [string] -and $prop.Value -ne "") { return $prop.Value }
    }
    foreach ($prop in $Object.PSObject.Properties) {
        $r = Find-FirstString $prop.Value $Names ($Depth + 1)
        if ($r) { return $r }
    }
    return $null
}

function Add-Line {
    param([System.Text.StringBuilder] $Builder, [string] $Text = "")
    [void]$Builder.Append($Text).Append("`n")
}

# Diagnostics stay outside the repo (never committed).
function Write-DebugLog {
    param([string] $Message)
    try {
        [System.IO.Directory]::CreateDirectory($stateDir) | Out-Null
        $stamp = Format-Iso ([DateTime]::UtcNow)
        [System.IO.File]::AppendAllText($debugPath, "$stamp [response] $Message`n", $utf8NoBom)
    } catch { }
}

# Write to a temp file, then move into place, so a crash never leaves a half-written file.
function Write-Atomic {
    param([string] $Path, [string] $Text)
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, $Text, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Save-Json {
    param([string] $Path, $Object)
    Write-Atomic -Path $Path -Text (ConvertTo-Json -InputObject $Object -Depth 100)
}

function Read-JsonFile {
    param([string] $Path)
    if (-not [System.IO.File]::Exists($Path)) { return $null }
    try {
        return (Read-Json ([System.IO.File]::ReadAllText($Path, $utf8NoBom)))
    } catch {
        Write-DebugLog "Unreadable state file '$Path': $($_.Exception.Message)"
        try { Move-Item -LiteralPath $Path -Destination "$Path.corrupt-$([DateTime]::UtcNow.Ticks)" -Force } catch { }
        return $null
    }
}

# Renders the whole session file from state (state is the source of truth) and stages it.
# A prompt still waiting for its answer is rendered without a RESPONSE block.
function Write-SessionLog {
    param($State)

    $entries = @($State.entries | Where-Object { $null -ne $_ })
    $pending = $State.pending
    $count = $entries.Count
    if ($null -ne $pending) { $count++ }
    if ($count -eq 0) { return }

    $firstIso = ""
    $lastIso = ""
    if ($entries.Count -gt 0) {
        $firstIso = ConvertTo-IsoString $entries[0].promptTime
        $lastIso  = ConvertTo-IsoString $entries[$entries.Count - 1].promptTime
    }
    if ($null -ne $pending) {
        if ($firstIso -eq "") { $firstIso = ConvertTo-IsoString $pending.timestamp }
        $lastIso = ConvertTo-IsoString $pending.timestamp
    }

    $first = ConvertTo-UtcDateTime $firstIso
    $sid = [string]$State.sessionId
    $short = $sid
    if ($short.Length -gt 8) { $short = $short.Substring(0, 8) }
    $logPath = Join-Path $logDir ("{0}_{1}.md" -f $first.ToString("yyyy-MM-dd_HH-mm-ss", $invariant), $sid)

    $models = @($entries | Where-Object { -not $_.interrupted } | ForEach-Object { [string]$_.model } | Select-Object -Unique)
    if ($models.Count -eq 0 -and $null -ne $pending -and $pending.model) { $models = @([string]$pending.model) }
    if ($models.Count -eq 0) { $models = @($defaultModel) }

    $b = New-Object System.Text.StringBuilder
    Add-Line $b "---"
    Add-Line $b "session_id: $sid"
    Add-Line $b "date: $($first.ToString('yyyy-MM-dd', $invariant))"
    Add-Line $b "author: $author"
    Add-Line $b "model: $($models -join ', ')"
    Add-Line $b "tool: $toolName"
    Add-Line $b "project: $projectName"
    Add-Line $b "total_exchanges: $count"
    Add-Line $b "first_prompt_time: $firstIso"
    Add-Line $b "last_prompt_time: $lastIso"
    Add-Line $b "---"
    Add-Line $b
    Add-Line $b "# Session Log - $($first.ToString('yyyy-MM-dd', $invariant))"
    Add-Line $b
    Add-Line $b "Session: ``$short`` | Project: ``$projectName`` | Author: ``$author``"
    Add-Line $b
    Add-Line $b "---"
    Add-Line $b

    $n = 0
    foreach ($e in $entries) {
        $n++
        Add-Line $b "[LOG_ENTRY type=PROMPT num=$n session=$short]"
        Add-Line $b "timestamp: $(ConvertTo-IsoString $e.promptTime)"
        Add-Line $b "model: $($e.model)"
        Add-Line $b
        Add-Line $b ([string]$e.prompt)
        Add-Line $b
        Add-Line $b
        Add-Line $b "[LOG_ENTRY type=RESPONSE num=$n session=$short]"
        Add-Line $b "timestamp: $(ConvertTo-IsoString $e.responseTime)"
        Add-Line $b "model: $($e.model)"
        Add-Line $b
        Add-Line $b ([string]$e.response)
        Add-Line $b
        Add-Line $b
    }
    if ($null -ne $pending) {
        $n++
        $pendingModel = $defaultModel
        if ($pending.model) { $pendingModel = [string]$pending.model }
        Add-Line $b "[LOG_ENTRY type=PROMPT num=$n session=$short]"
        Add-Line $b "timestamp: $(ConvertTo-IsoString $pending.timestamp)"
        Add-Line $b "model: $pendingModel"
        Add-Line $b
        Add-Line $b ([string]$pending.content)
        Add-Line $b
        Add-Line $b
    }

    [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
    Write-Atomic -Path $logPath -Text $b.ToString()

    if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-DebugLog "git not found on PATH; log written but not staged."
        return
    }

    # The logs ship with the repo: refuse to run quietly if they are being ignored.
    & git -C $repoRoot check-ignore --no-index -q -- $logPath | Out-Null
    if ($LASTEXITCODE -eq 0) {
        throw "'.agent-logs/' is gitignored. Remove it from .gitignore; the logs must be committed."
    }

    # Retry briefly: the agent may be running its own git command and holding index.lock.
    $staged = $false
    for ($i = 1; $i -le 4 -and -not $staged; $i++) {
        & git -C $repoRoot add -- $logPath | Out-Null
        if ($LASTEXITCODE -eq 0) { $staged = $true } else { Start-Sleep -Milliseconds 300 }
    }
    if (-not $staged) { throw "Could not stage capture file '$logPath'." }
}

# ---- Transcript recovery (used when the payload carries no text) -------------
$skipTypes = @("tool_use", "toolUse", "tool_result", "toolResult", "thinking", "reasoning", "redacted_thinking", "image")

# The CLI/IDE may still hold the transcript open for writing: read it with ReadWrite sharing.
function Read-SharedText {
    param([string] $Path)
    $stream = New-Object System.IO.FileStream(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite)
    try {
        $r = New-Object System.IO.StreamReader($stream, $utf8NoBom)
        return $r.ReadToEnd()
    } finally {
        $stream.Dispose()
    }
}

function Find-SessionDir {
    param([string] $SessionId)
    if ([string]::IsNullOrWhiteSpace($SessionId)) { return $null }
    $userHome = [Environment]::GetFolderPath("UserProfile")
    $root = Join-Path (Join-Path $userHome ".kiro") "sessions"
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $direct = Join-Path $root $SessionId
    if (Test-Path -LiteralPath $direct -PathType Container) { return $direct }
    foreach ($ws in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
        $candidate = Join-Path $ws.FullName $SessionId
        if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
    }
    return $null
}

function Get-MessageRole {
    param($Obj)
    # Kiro transcript format: { "payload": { "type": "user" | "assistant", ... } }
    $payloadProp = $Obj.PSObject.Properties["payload"]
    if ($null -ne $payloadProp -and $null -ne $payloadProp.Value) {
        $typeProp = $payloadProp.Value.PSObject.Properties["type"]
        if ($null -ne $typeProp -and $typeProp.Value -is [string]) {
            $t = $typeProp.Value.ToLowerInvariant()
            if ($t -eq "user")      { return "user" }
            if ($t -eq "assistant") { return "assistant" }
        }
    }
    # Generic fallback: check common role/type fields at any level
    $paths = @(@("role"), @("type"), @("kind"), @("sender"), @("author"), @("message", "role"), @("data", "role"))
    foreach ($path in $paths) {
        $v = $Obj
        foreach ($seg in $path) {
            if ($null -eq $v) { break }
            $prop = $v.PSObject.Properties[$seg]
            if ($null -eq $prop) { $v = $null } else { $v = $prop.Value }
        }
        if ($v -is [string] -and $v -ne "") {
            $l = $v.ToLowerInvariant()
            if ($l -match "user|human") { return "user" }
            if ($l -match "assistant|^ai$|model|agent|bot") { return "assistant" }
        }
    }
    return ""
}

# Plain text of a message; tool calls, tool results, reasoning blocks, and non-text events are skipped.
# Kiro transcript format: { "payload": { "type": "user"|"assistant", "content": "..." } }
$skipPayloadTypes = @("turn_start", "turn_end", "steering_inclusion", "session_start",
                      "session_event", "session_metadata", "usage_summary",
                      "ContextualHookInvoked", "pending_interaction", "interaction_resolved")

function Get-MessageText {
    param($Value, [int] $Depth = 0)
    if ($null -eq $Value -or $Depth -gt 6) { return "" }
    if ($Value -is [string]) { return $Value }
    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = @()
        foreach ($item in $Value) {
            $t = Get-MessageText $item ($Depth + 1)
            if ($t -ne "") { $parts += $t }
        }
        return ($parts -join "`n")
    }
    # For Kiro transcript objects, navigate into payload first.
    $payloadProp = $Value.PSObject.Properties["payload"]
    if ($null -ne $payloadProp -and $null -ne $payloadProp.Value) {
        $payload = $payloadProp.Value
        # Skip event-type payloads that carry no human/AI text.
        $ptProp = $payload.PSObject.Properties["type"]
        if ($null -ne $ptProp -and $ptProp.Value -is [string] -and ($skipPayloadTypes -contains $ptProp.Value)) { return "" }
        # Skip reasoning/thinking blocks.
        $opProp = $payload.PSObject.Properties["operationType"]
        if ($null -ne $opProp -and $opProp.Value -is [string] -and $opProp.Value -match "Reasoning|Thinking") { return "" }
        $contentProp = $payload.PSObject.Properties["content"]
        if ($null -ne $contentProp -and $contentProp.Value -is [string] -and $contentProp.Value -ne "") {
            return $contentProp.Value
        }
    }
    $typeProp = $Value.PSObject.Properties["type"]
    if ($null -ne $typeProp -and $typeProp.Value -is [string] -and ($skipTypes -contains $typeProp.Value)) { return "" }
    foreach ($n in @("text", "content", "entries", "message", "value", "body")) {
        $prop = $Value.PSObject.Properties[$n]
        if ($null -ne $prop -and $null -ne $prop.Value) {
            $t = Get-MessageText $prop.Value ($Depth + 1)
            if ($t -ne "") { return $t }
        }
    }
    return ""
}

# Last user message with text, and the last assistant message with text after it.
function Read-SessionTranscript {
    param([string] $Path)
    $lastUser = $null
    $lastAssistant = $null
    $lineCount = 0
    foreach ($line in @((Read-SharedText $Path) -split "\r?\n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $obj = Read-Json $line } catch { continue }
        $lineCount++
        $role = Get-MessageRole $obj
        if ($role -eq "") { continue }
        $text = Get-MessageText $obj
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        if ($role -eq "user") { $lastUser = $text; $lastAssistant = $null } else { $lastAssistant = $text }
    }
    return [pscustomobject]@{ Prompt = $lastUser; Response = $lastAssistant; Lines = $lineCount }
}

function Write-TranscriptDebug {
    param([string] $Path, $Result)
    try {
        $names = (Get-ChildItem -LiteralPath (Split-Path -Parent $Path) -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ","
        $sample = @((Read-SharedText $Path) -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 3 | ForEach-Object { if ($_.Length -gt 1200) { $_.Substring(0, 1200) } else { $_ } })
        Write-DebugLog "Transcript '$Path' parsed lines=$($Result.Lines) prompt=$([bool]$Result.Prompt) response=$([bool]$Result.Response) dir=[$names] sample=[$($sample -join ' || ')]"
    } catch {
        Write-DebugLog "Transcript debug failed: $($_.Exception.Message)"
    }
}

# ---- Main -------------------------------------------------------------------
$exitCode = 0
try {
    $stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8NoBom)
    $raw = $stdin.ReadToEnd()

    $payload = $null
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        try { $payload = Read-Json $raw } catch { Write-DebugLog "Invalid JSON payload: $($_.Exception.Message)" }
    } else {
        Write-DebugLog "Empty stdin payload."
    }

    # Find the session the prompt hook recorded. The Stop payload's session_id is tried first;
    # otherwise (or if it differs) follow the current session pointer.
    $sessionId = ConvertTo-SafeId (Get-Field $payload @("session_id", "sessionId"))
    $state = $null
    if ($sessionId -ne "") { $state = Read-JsonFile (Join-Path $stateDir "$sessionId.json") }
    if ($null -eq $state) {
        $current = Read-JsonFile $currentPath
        if ($null -ne $current -and $current.sessionId) {
            $sessionId = ConvertTo-SafeId $current.sessionId
            $state = Read-JsonFile (Join-Path $stateDir "$sessionId.json")
        }
    }
    if ($null -eq $state) {
        if ($sessionId -eq "") { $sessionId = [guid]::NewGuid().ToString() }
        $state = [pscustomobject]@{ sessionId = $sessionId; entries = @(); pending = $null }
    }
    $sessionId = ConvertTo-SafeId $state.sessionId
    [System.IO.Directory]::CreateDirectory($stateDir) | Out-Null
    $statePath = Join-Path $stateDir "$sessionId.json"

    $loggedEntries = @($state.entries | Where-Object { $null -ne $_ })
    $lastLogged = ""
    if ($loggedEntries.Count -gt 0) { $lastLogged = [string]$loggedEntries[$loggedEntries.Count - 1].response }

    # 1. Payload text, if this build sends it.
    $response = Find-FirstString $payload @("assistant_response", "response", "finalResponse", "final_response", "output", "text")
    $promptText = $null
    if ($null -ne $state.pending -and [string]$state.pending.content -ne $noPromptText) {
        $promptText = [string]$state.pending.content
    }
    $model = ""

    # 2. Otherwise recover the missing text from Kiro's own session transcript.
    if ([string]::IsNullOrWhiteSpace($response) -or $null -eq $promptText) {
        $transcriptPath = $null
        $tp = [string](Get-Field $payload @("transcript_path", "transcriptPath"))
        if ($tp -and (Test-Path -LiteralPath $tp)) { $transcriptPath = $tp }
        $sessionFolder = Find-SessionDir $sessionId
        if ($null -eq $transcriptPath -and $null -ne $sessionFolder) {
            $candidate = Join-Path $sessionFolder "messages.jsonl"
            if (Test-Path -LiteralPath $candidate) { $transcriptPath = $candidate }
        }

        if ($null -ne $transcriptPath) {
            # The transcript may lag the Stop event; wait up to 8s for a fresh response to appear.
            $tr = $null
            for ($attempt = 1; $attempt -le 10; $attempt++) {
                $tr = Read-SessionTranscript $transcriptPath
                $fresh = ($null -ne $tr.Response -and $tr.Response -ne $lastLogged)
                if ($fresh -or -not [string]::IsNullOrWhiteSpace($response)) { break }
                if ($attempt -lt 10) { Start-Sleep -Milliseconds 800 }
            }
            if ([string]::IsNullOrWhiteSpace($response) -and $tr.Response) { $response = $tr.Response }
            if ($null -eq $promptText -and $tr.Prompt) { $promptText = $tr.Prompt }
            if (-not $tr.Response -or -not $tr.Prompt) { Write-TranscriptDebug $transcriptPath $tr }
        } else {
            Write-DebugLog "No transcript found for session '$sessionId' (looked in ~/.kiro/sessions)."
        }

        if ($null -ne $sessionFolder) {
            $sessionJson = Join-Path $sessionFolder "session.json"
            if (Test-Path -LiteralPath $sessionJson) {
                try { $model = [string](Find-FirstString (Read-Json (Read-SharedText $sessionJson)) @("model", "modelId", "model_id", "selectedModel")) } catch { }
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($response)) {
        $keys = ""
        if ($null -ne $payload) { $keys = ($payload.PSObject.Properties.Name -join ",") }
        $preview = [string]$raw
        if ($preview.Length -gt 2000) { $preview = $preview.Substring(0, 2000) }
        Write-DebugLog "No response text available. Payload keys: [$keys] Raw: $preview"
        $response = "[response text not available in hook payload]"
    }
    if ($null -eq $promptText) { $promptText = "[prompt was not captured by the hook]" }

    # A repeated Stop event for a response that is already logged must not create a duplicate.
    $duplicate = ($null -eq $state.pending -and $response -eq $lastLogged)

    if (-not $duplicate) {
        $now = Format-Iso ([DateTime]::UtcNow)
        $promptTime = $now
        if ($null -ne $state.pending) {
            $promptTime = ConvertTo-IsoString $state.pending.timestamp
            if ($state.pending.model) { $model = [string]$state.pending.model }
        }
        $payloadModel = [string](Find-FirstString $payload @("model", "model_id", "modelId"))
        if (-not [string]::IsNullOrWhiteSpace($payloadModel)) { $model = $payloadModel }
        if ([string]::IsNullOrWhiteSpace($model)) { $model = $defaultModel }

        $entry = [pscustomobject]@{
            promptTime   = $promptTime
            responseTime = $now
            model        = $model
            interrupted  = $false
            prompt       = $promptText
            response     = [string]$response
        }
        $state.entries = @($state.entries) + @($entry)
        $state | Add-Member -Force -NotePropertyName pending -NotePropertyValue $null

        Save-Json $statePath $state   # state first, then render
        Save-Json $currentPath ([pscustomobject]@{ sessionId = $sessionId; updated = $now })
        Write-SessionLog $state
    }
} catch {
    [Console]::Error.WriteLine("capture-response: $($_.Exception.Message)")
    Write-DebugLog "FAILED: $($_.Exception.Message)"
    $exitCode = 1
}

exit $exitCode