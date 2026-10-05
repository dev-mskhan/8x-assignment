# capture-prompt.ps1
# Kiro UserPromptSubmit hook. Receives JSON on stdin: hook_event_name, cwd, prompt
# (and session_id on builds that send it).
#
# Records the prompt verbatim in per-session state, then re-renders
# .agent-logs/<YYYY-MM-DD_HH-MM-SS>_<session-id>.md in the assignment format and stages it.
#
# Some Kiro IDE builds send an EMPTY prompt to hooks (prompt: ""). In that case this script
# records the timestamp and session, and capture-response.ps1 recovers the prompt text from
# Kiro's own session transcript when the turn ends.
#
# STDOUT MUST STAY EMPTY: Kiro adds hook stdout to the model context for UserPromptSubmit.
# Exit code 2 would block the prompt, so failures use exit 1.
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).

param()

$ErrorActionPreference = "Stop"

# ---- Settings (keep identical in capture-response.ps1) ----------------------
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
        [System.IO.File]::AppendAllText($debugPath, "$stamp [prompt] $Message`n", $utf8NoBom)
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

    # Prompt text, verbatim (never trimmed): payload first, USER_PROMPT env var as a fallback.
    $prompt = Find-FirstString $payload @("prompt", "user_prompt", "userPrompt")
    if ([string]::IsNullOrEmpty($prompt)) { $prompt = $env:USER_PROMPT }
    if ([string]::IsNullOrEmpty($prompt)) {
        # Kiro sends prompt:"" — read from the session transcript directly.
        # The user message is always written before UserPromptSubmit fires.
        $payloadSessionId = ConvertTo-SafeId (Get-Field $payload @("session_id", "sessionId"))
        if ($payloadSessionId -ne "") {
            $sessionFolder = $null
            $userHome = [Environment]::GetFolderPath("UserProfile")
            $sessRoot = Join-Path (Join-Path $userHome ".kiro") "sessions"
            if (Test-Path -LiteralPath $sessRoot) {
                $direct = Join-Path $sessRoot $payloadSessionId
                if (Test-Path -LiteralPath $direct -PathType Container) { $sessionFolder = $direct }
                if ($null -eq $sessionFolder) {
                    foreach ($ws in @(Get-ChildItem -LiteralPath $sessRoot -Directory -ErrorAction SilentlyContinue)) {
                        $candidate = Join-Path $ws.FullName $payloadSessionId
                        if (Test-Path -LiteralPath $candidate -PathType Container) { $sessionFolder = $candidate; break }
                    }
                }
            }
            if ($null -ne $sessionFolder) {
                $tPath = Join-Path $sessionFolder "messages.jsonl"
                if (Test-Path -LiteralPath $tPath) {
                    try {
                        $stream = New-Object System.IO.FileStream($tPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                        $tContent = ""
                        try { $reader = New-Object System.IO.StreamReader($stream, $utf8NoBom); $tContent = $reader.ReadToEnd() } finally { $stream.Dispose() }
                        $lastUserText = ""
                        foreach ($tline in @($tContent -split "\r?\n")) {
                            if ([string]::IsNullOrWhiteSpace($tline)) { continue }
                            try {
                                $tobj = $tline | ConvertFrom-Json
                                $tpayload = $tobj.PSObject.Properties["payload"]
                                if ($null -ne $tpayload -and $null -ne $tpayload.Value) {
                                    $ttype = $tpayload.Value.PSObject.Properties["type"]
                                    if ($null -ne $ttype -and $ttype.Value -eq "user") {
                                        $tcontent = $tpayload.Value.PSObject.Properties["content"]
                                        if ($null -ne $tcontent -and $tcontent.Value -is [string] -and $tcontent.Value -ne "") {
                                            $lastUserText = $tcontent.Value
                                        }
                                    }
                                }
                            } catch { }
                        }
                        if ($lastUserText -ne "") {
                            $prompt = $lastUserText
                            Write-DebugLog "Recovered prompt from transcript: [$($prompt.Substring(0, [Math]::Min(80, $prompt.Length)))]"
                        }
                    } catch { Write-DebugLog "Transcript read failed: $($_.Exception.Message)" }
                }
            }
        }
        if ([string]::IsNullOrEmpty($prompt)) {
            $keys = ""
            if ($null -ne $payload) { $keys = ($payload.PSObject.Properties.Name -join ",") }
            $envNames = (Get-ChildItem Env: | Where-Object { $_.Name -match "KIRO|PROMPT|SESSION" } | ForEach-Object { $_.Name }) -join ","
            $preview = [string]$raw
            if ($preview.Length -gt 2000) { $preview = $preview.Substring(0, 2000) }
            Write-DebugLog "No prompt text in payload or transcript. Keys: [$keys] Env: [$envNames] Raw: $preview"
            $prompt = $noPromptText
        }
    }

    $model = [string](Get-Field $payload @("model", "model_id", "modelId"))
    if ([string]::IsNullOrWhiteSpace($model)) { $model = $defaultModel }

    # Session id: use the payload's. Some builds omit it from prompt events, so otherwise
    # follow the session recorded recently, or start a new one.
    $sessionId = ConvertTo-SafeId (Get-Field $payload @("session_id", "sessionId"))
    if ($sessionId -eq "") {
        $current = Read-JsonFile $currentPath
        if ($null -ne $current -and $current.sessionId) {
            $ageHours = ([DateTime]::UtcNow - (ConvertTo-UtcDateTime $current.updated)).TotalHours
            if ($ageHours -lt $sessionReuseHours) { $sessionId = ConvertTo-SafeId $current.sessionId }
        }
    }
    if ($sessionId -eq "") { $sessionId = [guid]::NewGuid().ToString() }

    [System.IO.Directory]::CreateDirectory($stateDir) | Out-Null
    $statePath = Join-Path $stateDir "$sessionId.json"
    $state = Read-JsonFile $statePath
    if ($null -eq $state) {
        $state = [pscustomobject]@{ sessionId = $sessionId; entries = @(); pending = $null }
    }

    $now = Format-Iso ([DateTime]::UtcNow)

    # A previous prompt that never got a response (turn interrupted) must not be lost.
    if ($null -ne $state.pending) {
        $orphan = [pscustomobject]@{
            promptTime   = ConvertTo-IsoString $state.pending.timestamp
            responseTime = "unknown"
            model        = $(if ($state.pending.model) { [string]$state.pending.model } else { "unknown" })
            interrupted  = $true
            prompt       = [string]$state.pending.content
            response     = $noResponseText
        }
        $state.entries = @($state.entries) + @($orphan)
    }

    $state | Add-Member -Force -NotePropertyName pending -NotePropertyValue ([pscustomobject]@{
        content   = [string]$prompt
        timestamp = $now
        model     = $model
    })

    Save-Json $statePath $state   # state first: the prompt is safe even if rendering fails below
    Save-Json $currentPath ([pscustomobject]@{ sessionId = $sessionId; updated = $now })
    Write-SessionLog $state
} catch {
    [Console]::Error.WriteLine("capture-prompt: $($_.Exception.Message)")
    Write-DebugLog "FAILED: $($_.Exception.Message)"
    $exitCode = 1
}

exit $exitCode