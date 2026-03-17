# LogDrawer + Steering — Investigation Report

## Bug 1: "Agent is starting up..." — Root Cause

**Root cause:** The task-runner (`life-os/scripts/task-runner.js`) spawns Claude with `--print` mode (line 377), which produces **zero stdout/stderr output until the agent finishes**. The log file stays at 0 bytes for the entire run, so LogDrawer perpetually shows the empty state.

### Full trace

1. Task-runner claims a queued task and calls `spawnAgent(task)` (`task-runner.js:584`)
2. Agent is spawned with `--print` flag (`task-runner.js:375-383`):
   ```js
   spawn(CLAUDE_BIN, ['--permission-mode', 'bypassPermissions', '--print', '--add-dir', worktreeDir], ...)
   ```
3. Prompt is written to stdin as **plain text**, then `child.stdin.end()` is called (`task-runner.js:410-411`)
4. `--print` mode: Claude processes the entire request internally, then writes a single final result to stdout at exit. **No streaming.**
5. Task-runner creates a log file (`createAgentLogPath`, line 88-95) and writes stdout/stderr chunks to it (`task-runner.js:399-408`), but no chunks ever arrive until the agent exits
6. Task-runner writes `agent_run_id` to `sprint_tasks` table (`task-runner.js:393`) — this happens immediately after spawn, so LogDrawer can find the agent record
7. The `agent_runs` row has `status = 'running'` and `log_path` pointing to the 0-byte file

**In the renderer:**

8. LogDrawer polls `window.api.sprint.readLog(agent_run_id)` every 2s (`LogDrawer.tsx:10,33`)
9. Preload sends `ipcRenderer.invoke('sprint:readLog', agentId)` — note: **no `fromByte` arg** (`preload/index.ts:108-109`)
10. Handler reads from `agent_runs` table, opens the log file (`sprint.ts:180-201`)
11. File is 0 bytes: `fromByte (0) >= size (0)` → returns `{ content: '', status: 'running', nextByte: 0 }` (`sprint.ts:193`)
12. LogDrawer sets `logContent = ''`, `agentStatus = 'running'` (`LogDrawer.tsx:34-35`)
13. `parseStreamJson('')` → `{ items: [], isStreaming: false }` — empty string produces no lines (`stream-parser.ts:39-46`)
14. `hasStreamJson = false` (items.length === 0), `hasPlainText = false` (logContent.trim().length === 0) (`LogDrawer.tsx:64-65`)
15. Renders: `<div className="log-drawer__empty">Agent is starting up...</div>` (`LogDrawer.tsx:133`)

This persists for the **entire** agent run (often 5-20 minutes). When the agent finally exits, `--print` dumps plain text to stdout, which gets written to the log file. At that point:
- `parseStreamJson` tries JSON.parse on each line, fails, and wraps them as `{ kind: 'plain' }` items
- LogDrawer renders via ChatThread, which may not render `plain` items well

### Confirmed with live data

```
# Active task with 0-byte log — currently stuck on "Agent is starting up..."
6acb849b-dd60-40f3-b614-2eeb1b69dd9f | status: running | log: 0 bytes | source: external

# 23 of 57 agent logs from today are 0 bytes — all from task-runner (source: external)
```

### Secondary issue: preload type mismatch

The preload declares `sprint.readLog` as:
```ts
readLog: (agentId: string): Promise<{ content: string; status: string }>
```

But the handler returns `{ content, status, nextByte }` and accepts `(agentId, fromByte?)`. The preload:
1. Never passes `fromByte`, so every poll re-reads the **entire** log file from byte 0
2. Omits `nextByte` from the return type

For BDE-spawned agents with stream-json logs (up to 3.4MB observed), this means re-reading megabytes every 2 seconds. Not the root cause of Bug 1, but a performance problem.

---

## Bug 2: Steering is a no-op — Root Cause

**Root cause:** Two independent failures make steering completely broken for task-runner agents:

### Failure 1: Wrong process — agent lives in task-runner, not BDE

1. User types in steer input, presses Enter (`LogDrawer.tsx:69-81`)
2. Calls `window.api.steerAgent(task.agent_run_id, msg)` (`LogDrawer.tsx:77`)
3. Preload sends `ipcRenderer.invoke('agent:steer', { agentId, message })` (`preload/index.ts:68-69`)
4. Handler calls `steerAgent(agentId, message)` from `local-agents.ts` (`agent-handlers.ts:34-37`)
5. `steerAgent` looks up `activeAgentsById.get(agentId)` (`local-agents.ts:308`)
6. **This map is only populated by `spawnClaudeAgent()`** (`local-agents.ts:261`) — the BDE Electron main process spawn function
7. Task-runner is a **separate Node.js process** with its own child process references. BDE Electron has **no reference** to task-runner's children
8. `activeAgentsById.get(agentId)` returns `undefined`
9. Returns `{ ok: false, error: 'Agent not found or stdin closed' }` (`local-agents.ts:309`)

### Failure 2: stdin is closed — `--print` mode

Even if we somehow got the child reference:
1. Task-runner calls `child.stdin.end()` immediately after writing the prompt (`task-runner.js:411`)
2. `--print` mode does not accept follow-up stdin messages
3. `child.stdin.destroyed` would be `true`
4. The steer attempt would still fail at the `child.stdin.destroyed` check (`local-agents.ts:309`)

### Note on BDE-spawned agents

Steering **would** work for agents spawned via BDE's `spawnClaudeAgent()` because:
- They use `--input-format stream-json` (accepts stdin messages)
- stdin is **not** closed after the initial message
- The child is registered in `activeAgentsById`
- Message format is correct: `{ type: "user", message: { role: "user", content: "..." } }`

But the Sprint → LogDrawer flow is for task-runner agents, not BDE-spawned agents.

---

## Data Flow: Log file -> LogDrawer

```
task-runner.js                    BDE Electron (main)              BDE Renderer
───────────────                   ───────────────────              ────────────
1. claimTask(id)
   → status='active'
   → broadcast SSE

2. spawnAgent(task)
   → spawn claude --print
   → createAgentLogPath(uuid)
     → ~/.bde/agent-logs/DATE/UUID/output.log (0 bytes)
   → registerBdeAgent()
     → INSERT INTO agent_runs (status='running', log_path=...)
   → UPDATE sprint_tasks SET agent_run_id=UUID

3. child.stdin.write(prompt)
   child.stdin.end()            ◄── stdin closed forever

4. [WAIT 5-20 min]              sprint:readLog handler             LogDrawer
   stdout: nothing              ← readLog(agentId)          ← poll every 2s
   log file: 0 bytes              → open(log_path)            → content=''
                                   → size=0, fromByte=0       → items=[]
                                   → return {content:'',      → "Agent is
                                      status:'running'}          starting up..."
                                                              ▲ STUCK HERE

5. Agent exits
   → stdout dumps result text
   → appendFileSync(logPath)   ← readLog                    ← poll
   → finishBdeAgent(id, code)    → reads full file             → content=text
     → status='done'             → return {content:text,       → plain items
                                    status:'done'}             → ChatThread
```

### Breakage points

| # | Where | What breaks |
|---|-------|-------------|
| A | `--print` flag | No streaming output — log stays 0 bytes during run |
| B | `stdin.end()` | Prevents any follow-up messages |
| C | Preload omits `fromByte` | Re-reads entire file every poll (perf, not correctness) |
| D | Preload omits `nextByte` | Can't do incremental reads even if wanted |
| E | Plain text output | `parseStreamJson` wraps as `plain` items — no tool use, no structured chat |

---

## Data Flow: Steer input -> Agent stdin

```
LogDrawer                   Preload                    Main Process              task-runner
─────────                   ───────                    ────────────              ────────────
1. user types msg
   handleSteerSend()

2. steerAgent(
     agent_run_id,          invoke('agent:steer',
     msg)                     {agentId, message})

3.                                                     steerAgent(id, msg)
                                                       activeAgentsById
                                                         .get(agentId)
                                                       → undefined ◄── BREAK 1
                                                         (child lives in
                                                          task-runner process)

4.                                                     return {ok:false,
                                                        error:'Agent not
                                                        found or stdin
                                                        closed'}
                                                                                 child.stdin
5. toast.error(...)                                                              .destroyed
   ◄── user sees                                                                 = true
       error toast                                                               ◄── BREAK 2
```

### Breakage points

| # | Where | What breaks |
|---|-------|-------------|
| 1 | `activeAgentsById` map | Only populated by BDE's `spawnClaudeAgent()`, not task-runner |
| 2 | `child.stdin.end()` | Task-runner closes stdin immediately — `--print` doesn't accept follow-ups |
| 3 | Process boundary | Child process belongs to task-runner (separate Node.js process), not BDE Electron |

---

## Architecture: --print vs Interactive mode

### BDE's `spawnClaudeAgent()` (`local-agents.ts:239-288`)

```
Mode:     Interactive (stream-json)
Flags:    --output-format stream-json --input-format stream-json --verbose --include-partial-messages
stdin:    OPEN — initial message sent as JSON, stdin stays open
Output:   Stream-json events (content_block_delta, tool_use, result, etc.)
Steering: YES — send { type: "user", message: { role: "user", content: "..." } } to stdin
Tracking: Registered in activeAgentsById + activeAgentProcesses maps
Exit:     Emits result event, then exits
Log size: Large (3.4MB observed) — every token streamed
```

### Task-runner's `spawnAgent()` (`task-runner.js:358-446`)

```
Mode:     One-shot (--print)
Flags:    --permission-mode bypassPermissions --print --add-dir <worktree>
stdin:    CLOSED — prompt written as plain text, then stdin.end()
Output:   Plain text final result only (dumped at exit)
Steering: NO — stdin is closed, --print doesn't accept follow-ups
Tracking: Registered in BDE DB but NOT in BDE's in-memory maps
Exit:     Exits after writing result to stdout
Log size: Tiny (0 bytes during run, ~100-500 bytes after exit)
```

### What happens if we remove `--print` from task-runner?

| Aspect | Current (`--print`) | Without `--print` (interactive) |
|--------|--------------------|---------------------------------|
| Output format | Plain text at exit | Need `--output-format stream-json` |
| Streaming | None during run | Real-time token streaming |
| stdin | Must call `.end()` | Must NOT call `.end()` |
| Initial prompt | Plain text to stdin | JSON message to stdin |
| Agent exit | Exits after output | Exits after emitting `result` event |
| Log file during run | 0 bytes | Growing continuously |
| PR URL extraction | `extractPrUrl(plainText)` | Must parse stream-json for text blocks, then extract |
| Follow-up messages | Impossible | Possible via stdin JSON messages |

### Risks of changing to interactive mode

1. **Exit behavior**: Claude Code in stream-json mode still exits after completing the conversation turn. The agent should still exit cleanly. LOW RISK.
2. **Output parsing**: `extractPrUrl()` currently scans plain text. With stream-json, need to reconstruct text from `content_block_delta` events or `result` event. MEDIUM RISK.
3. **stdin management**: Must not call `.end()`. Must send initial prompt as JSON. LOW RISK — just different protocol.
4. **`--print` reads stdin differently**: `--print` reads ALL stdin as the prompt (hence `.end()` to signal EOF). Interactive mode reads line-delimited JSON messages. Can't just remove `--print` without also changing the stdin protocol.

### Can you steer a `--print` session?

**No.** `--print` mode:
1. Reads stdin until EOF (`.end()`)
2. Processes the input as a single prompt
3. Writes the result to stdout
4. Exits

There is no mechanism for follow-up messages. stdin must be closed for `--print` to even begin processing.

---

## Fix Recommendations

### Fix 1: Switch task-runner from `--print` to interactive stream-json mode [HIGH IMPACT, MEDIUM RISK]

**File:** `life-os/scripts/task-runner.js`

**Changes needed:**

1. **Line 375-383** — Change spawn flags:
   ```js
   // FROM:
   spawn(CLAUDE_BIN, ['--permission-mode', 'bypassPermissions', '--print', '--add-dir', worktreeDir], ...)
   // TO:
   spawn(CLAUDE_BIN, [
     '--permission-mode', 'bypassPermissions',
     '--output-format', 'stream-json',
     '--input-format', 'stream-json',
     '--verbose',
     '--add-dir', worktreeDir
   ], ...)
   ```

2. **Line 410-411** — Change stdin protocol:
   ```js
   // FROM:
   child.stdin.write(promptText)
   child.stdin.end()
   // TO:
   child.stdin.write(JSON.stringify({
     type: 'user',
     message: { role: 'user', content: promptText }
   }) + '\n')
   // DO NOT call stdin.end()
   ```

3. **Line 305-308** — Update `extractPrUrl()` to handle stream-json output:
   Need to either parse the accumulated output for JSON `text` blocks, or (simpler) keep scanning the raw log text since PR URLs will appear in text content that's embedded in JSON strings — `extractPrUrl` regex would still match inside JSON string values.

4. **Store child references** for steering — see Fix 3.

This alone fixes Bug 1 (log output streams in real-time) but does NOT fix Bug 2 (steering still crosses process boundary).

### Fix 2: Fix preload `sprint.readLog` to support incremental reads [LOW RISK]

**File:** `src/preload/index.ts`, lines 108-109

```ts
// FROM:
readLog: (agentId: string): Promise<{ content: string; status: string }> =>
  ipcRenderer.invoke('sprint:readLog', agentId),

// TO:
readLog: (agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }> =>
  ipcRenderer.invoke('sprint:readLog', agentId, fromByte),
```

**File:** `src/renderer/src/components/sprint/LogDrawer.tsx`

Add `nextByte` state and pass `fromByte` on each poll. Append content instead of replacing.

This is a performance fix — avoids re-reading multi-MB log files every 2 seconds.

### Fix 3: Add steering endpoint to task-runner [MEDIUM RISK — enables Bug 2 fix]

**File:** `life-os/scripts/task-runner.js`

1. Keep a `Map<string, ChildProcess>` of active agent children keyed by `agent_run_id`
2. Add REST endpoint: `POST /agents/:id/steer` that writes to the child's stdin
3. In BDE, route `agent:steer` to the task-runner REST API when the agent is `source: 'external'`

**File:** `src/main/local-agents.ts`, `steerAgent()` function (line 307-318)

```ts
// Fallback: if not in local map, try task-runner REST API
if (!child) {
  const res = await fetch(`http://127.0.0.1:18799/agents/${agentId}/steer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ message })
  })
  return res.ok ? { ok: true } : { ok: false, error: 'Task-runner steer failed' }
}
```

### Fix 4: Alternative — move agent spawning into BDE [HIGH RISK, HIGH REWARD]

Instead of task-runner spawning agents, have BDE's main process do it. This would:
- Put child processes in BDE's `activeAgentsById` map (steering works)
- Use stream-json mode (live output works)
- Eliminate the cross-process problem entirely

But requires significant refactoring of the task-runner's queue/worktree/reconciliation logic into BDE.

### Recommended order

1. **Fix 1** (stream-json in task-runner) — immediately fixes "Agent is starting up..." for all future runs
2. **Fix 2** (incremental reads) — performance improvement, quick win
3. **Fix 3** (steer endpoint) — enables steering for task-runner agents
4. **Fix 4** (consolidate spawning) — long-term, consider after Fix 3 is validated

---

## Open Questions

1. **`extractPrUrl` with stream-json**: The PR URL appears inside text content which is embedded in JSON strings. The regex `https:\/\/github\.com\/[^\s]+\/pull\/\d+` would still match against the raw log text (URLs appear inside `"text":"..."` JSON values). Need Ryan to confirm this is acceptable or if proper JSON parsing is needed.

2. **Agent exit with stream-json**: Does Claude Code in stream-json mode reliably exit after completing a single-turn conversation? (BDE's `spawnClaudeAgent` uses it and seems to exit fine, so likely yes — but task-runner has no `result` event handler to confirm completion.)

3. **Task-runner SSE port**: Is `18799` always available? The steer fallback in Fix 3 assumes the task-runner is reachable at this address.

4. **Concurrent DB access**: Both BDE and task-runner write to `bde.db`. Currently works via WAL mode + busy_timeout. Adding steer traffic through task-runner REST API doesn't change DB access patterns, but worth noting.

5. **`[bde-spawn]` prefix**: Some BDE-spawned logs start with `[bde-spawn] Starting: <uuid>`. This is not valid JSON and gets parsed as a `plain` item. Where is this prefix written? It's not in the current `spawnClaudeAgent()` code — may be from an older version. Not harmful but worth cleaning up.

6. **Should LogDrawer differentiate source?**: BDE-spawned agents (source='bde') have rich stream-json output and steering works. Task-runner agents (source='external') have plain text and no steering. Should the UI adapt based on source? (e.g., hide steer input for external agents until Fix 3 lands)
