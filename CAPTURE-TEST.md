# CAPTURE-TEST.md

## Tool and Model

- **Tool:** Kiro IDE (VS Code-based agentic IDE by AWS)
- **Model:** `auto` — selected dynamically server-side each turn

---

## Capture Mechanism

Kiro has a built-in **hook system**. Hooks are JSON files at `.kiro/hooks/<id>.json`. The agent
reads them at session start and executes them automatically in-process — no manual invocation
needed.

### Triggers used

| Trigger            | When it fires                       | Purpose              |
| ------------------ | ----------------------------------- | -------------------- |
| `UserPromptSubmit` | Every time the user sends a message | Capture the prompt   |
| `Stop`             | Every time an agent turn completes  | Capture the response |

Each hook runs a PowerShell script via a `command` action. The script reads a JSON payload from
stdin, extracts `sessionId`, `model`, and prompt/response text, then writes a Markdown log entry
and stages the file with `git add`.

### Config files created / changed

| File                                 | Role                                      |
| ------------------------------------ | ----------------------------------------- |
| `.kiro/hooks/capture-prompt.json`    | Registers the `UserPromptSubmit` hook     |
| `.kiro/hooks/capture-response.json`  | Registers the `Stop` hook                 |
| `.kiro/scripts/capture-prompt.ps1`   | Writes `[LOG_ENTRY type=PROMPT]` blocks   |
| `.kiro/scripts/capture-response.ps1` | Writes `[LOG_ENTRY type=RESPONSE]` blocks |

---

## Log File Path

```
.agent-logs/<YYYY-MM-DD_HH-MM-SS>_<session-id>.md
```

One file per session, named by the UTC timestamp of the first prompt and the session ID.

### Session 1

```
.agent-logs/2026-10-05_12-13-40_sess-canary-001.md
```

### Session 2

```
.agent-logs/2026-10-05_12-14-10_sess-canary-002.md
```

---

## Canary Session 1 — Raw Entries

```
[LOG_ENTRY type=PROMPT num=1 session=sess-can]
timestamp: 2026-10-05T12:13:40.495Z
model: auto

CAPTURE TEST — 8x assignment, canary-1


[LOG_ENTRY type=RESPONSE num=1 session=sess-can]
timestamp: 2026-10-05T12:13:55.746Z
model: auto

Capture test received — 8x assignment, canary-1. Hooks are working: prompt was captured from transcript fallback, git staged the log file. Pipeline is live.
```

---

## Canary Session 2 — Raw Entries

```
[LOG_ENTRY type=PROMPT num=1 session=sess-can]
timestamp: 2026-10-05T12:14:10.241Z
model: auto

CAPTURE TEST — 8x assignment, canary-2


[LOG_ENTRY type=RESPONSE num=1 session=sess-can]
timestamp: 2026-10-05T12:14:24.759Z
model: auto

Capture test received — 8x assignment, canary-2. Both sessions confirmed: prompt capture and response capture are functioning correctly across independent session IDs.
```

---

## What Was Tried First / What Did Not Work

### 1. Prompt text always empty in the hook payload

Kiro sends `"prompt": ""` (empty string) in the `UserPromptSubmit` payload. The actual text is
only in the session transcript at `~/.kiro/sessions/<workspace>/<sessionId>/messages.jsonl`.
The initial script had no fallback, so every prompt was logged as
`[prompt text not available in hook payload]`.

**Fix:** When the payload prompt is empty, the script now opens the transcript with
`ReadWrite` file-sharing, finds the last line where `payload.type == "user"`, and reads
`payload.content`. The user message is written to the transcript before `UserPromptSubmit`
fires, so this recovery always succeeds.

### 2. Transcript role parsing returned empty for every line

The first `Get-MessageRole` implementation looked for a flat `role` field. Kiro stores messages
as `{ "payload": { "type": "user"|"assistant", "content": "..." } }`, so the check returned
`""` for every line and the transcript was treated as having no messages. The text extractor had
the same issue — it searched for `content` at the top level instead of inside `payload`.

**Fix:** Both functions were updated to navigate into `payload` first, check `payload.type`
for `"user"` / `"assistant"`, and return `payload.content` directly.

### 3. Response capture fired before the transcript flushed

The `Stop` hook sometimes ran before the assistant message had been fully written to
`messages.jsonl`. The first version waited 5 × 400 ms (2 s) and gave up.

**Fix:** Retry loop extended to 10 × 800 ms (8 s total) with a freshness check — it compares
the newly read response against the last already-logged entry and keeps retrying until a
different value appears.

### 4. Hooks created mid-session did not apply to that session

Hooks are registered at session start. Any hook file added while a session was already running
did not fire until a new session was opened. Expected Kiro behavior — required opening a fresh
session for each canary test.
