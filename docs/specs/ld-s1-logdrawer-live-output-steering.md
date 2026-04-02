# LD-S1: LogDrawer — Live Output + Agent Steering
**Epic:** Agent Visibility  
**Status:** Ready to implement  
**Investigation report:** `docs/eval-logdrawer-steering.md`

## Problem

Two bugs make "View Output" useless for all task-runner agents.

### Bug 1: Log file is 0 bytes for the entire agent run (the real root cause)

`task-runner.js` spawns Claude with `--print` mode. `--print` **buffers all output internally and writes nothing to stdout until the agent exits** (5–20 minutes). The log file stays at 0 bytes throughout the entire run. LogDrawer polls every 2s, reads 0 bytes, shows "Agent is starting up..." forever. 23 of 57 agent log files from today are exactly 0 bytes — all task-runner spawned.

The `fromByte >= size` guard in `sprint:readLog` is a secondary issue, but irrelevant until the root cause is fixed.

### Bug 2: Steering is a no-op (two independent failures)

1. **Wrong process map**: `steerAgent()` in `local-agents.ts` looks up child processes in `activeAgentsById`. Task-runner agents are spawned in a **separate Node.js process** — they're never in that map. Lookup returns `undefined`, returns error immediately.
2. **Stdin is closed**: Task-runner calls `child.stdin.end()` immediately after writing the prompt. Even if we got the child reference, `child.stdin.destroyed = true`.

## Solution

### Fix 1: Switch task-runner from `--print` to interactive stream-json mode

Remove `--print`. Add `--output-format stream-json --input-format stream-json --verbose`. Don't call `stdin.end()`. Write initial prompt as a JSON message instead of plain text.

This immediately fixes Bug 1: log file starts filling with token-by-token stream-json events as the agent thinks and acts.

**`extractPrUrl()` still works**: PR URLs appear as text content inside JSON string values in the log file — the existing regex still matches against raw log text. No parsing change needed.

### Fix 2: Task-runner keeps child refs + exposes `POST /agents/:id/steer`

Store each running child in `activeChildren: Map<agentId, ChildProcess>`. Add one new HTTP route to the existing 18799 server. This fixes Bug 2.

### Fix 3: `steerAgent` in BDE falls back to task-runner REST API

If the local process map lookup misses, try the task-runner steer endpoint. This wires up the existing LogDrawer steer input without changing the LogDrawer at all.

### Fix 4: Incremental reads (performance)

Plumb `nextByte` through preload + LogDrawer so it appends instead of re-reading multi-MB files from byte 0 every 2s. Secondary but important once logs are filling up.

## Exact Changes

### 1. `life-os/scripts/task-runner.js`

**Change A: Module-level `activeChildren` map**

Add immediately after the existing module-level constants (after `const db = ...` or similar):

```javascript
// Active agent children keyed by agent_run_id — used for steering
const activeChildren = new Map()
```

**Change B: Spawn flags — switch to interactive stream-json**

Find the `spawn(CLAUDE_BIN, [` call (currently line ~375). Replace the args array and stdin protocol:

```javascript
// BEFORE:
const child = spawn(CLAUDE_BIN, [
  '--permission-mode', 'bypassPermissions',
  '--print',
  '--add-dir', worktreeDir,
], {
  cwd: worktreeDir,
  env: { ...process.env, HOME: '/Users/RBTECHBOT' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
// ...
child.stdin.write(promptText)
child.stdin.end()
```

```javascript
// AFTER:
const child = spawn(CLAUDE_BIN, [
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--add-dir', worktreeDir,
], {
  cwd: worktreeDir,
  env: { ...process.env, HOME: '/Users/RBTECHBOT' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

// Register child for steering before writing prompt
activeChildren.set(agentId, child)   // agentId is set above at registerBdeAgent()

// Write initial prompt as JSON message (interactive format)
child.stdin.write(
  JSON.stringify({ type: 'user', message: { role: 'user', content: promptText } }) + '\n'
)
// DO NOT call child.stdin.end() — keep open for steering
```

**Important:** `agentId` is the `randomUUID()` value already generated a few lines above this in the existing code. Make sure to use that same variable.

**Change C: Clean up child ref on close**

In the existing `child.on('close', (code) => { ... })` handler, add `activeChildren.delete(agentId)` as the **first line** of the handler body:

```javascript
child.on('close', (code) => {
  activeChildren.delete(agentId)  // ← ADD THIS
  finishBdeAgent(agentId, code)
  // ... rest of existing handler unchanged ...
})
```

**Change D: Add `POST /agents/:id/steer` to the HTTP server**

Find the route dispatch section (where existing routes are matched by `req.method` and `path`). Add this new route BEFORE the final 404 handler, following the exact same pattern as the existing POST /tasks route:

```javascript
// Steer a running agent — writes a follow-up message to its stdin
if (req.method === 'POST' && /^\/agents\/[^/]+\/steer$/.test(path)) {
  if (!isAuthenticated(req)) return send(res, 401, { error: 'Unauthorized' })

  const agentId = path.split('/')[2]
  let body = ''
  req.on('data', (d) => { body += d.toString() })
  req.on('end', () => {
    try {
      const { message } = JSON.parse(body)
      if (!message || typeof message !== 'string') {
        return send(res, 400, { error: 'message required' })
      }
      const child = activeChildren.get(agentId)
      if (!child || !child.stdin || child.stdin.destroyed) {
        return send(res, 404, { error: 'Agent not active or stdin closed' })
      }
      child.stdin.write(
        JSON.stringify({ type: 'user', message: { role: 'user', content: message } }) + '\n'
      )
      log(`Steered agent ${agentId.slice(0, 8)}: "${message.slice(0, 60)}"`)
      return send(res, 200, { ok: true })
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' })
    }
  })
  return
}
```

**Note:** Check how `isAuthenticated(req)` and `send(res, ...)` are defined in the existing file. Use those exact helper functions — do not reimplement.

### 2. `src/main/local-agents.ts` — steerAgent fallback to task-runner

Find the `steerAgent` export (currently around line 307). Replace the function body:

```typescript
export async function steerAgent(agentId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  // First: try local process map (BDE-spawned agents)
  const child = activeAgentsById.get(agentId)
  if (child && child.stdin && !child.stdin.destroyed) {
    const event = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message }
    }) + '\n'
    child.stdin.write(event)
    return { ok: true }
  }

  // Fallback: task-runner REST API (for task-runner-spawned agents)
  try {
    const apiKey = process.env.SPRINT_API_KEY ?? ''
    const response = await fetch(`http://127.0.0.1:18799/agents/${agentId}/steer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ message }),
    })
    const data = await response.json() as { ok?: boolean; error?: string }
    return { ok: data.ok ?? false, error: data.error }
  } catch {
    return { ok: false, error: 'Agent not found — not in local map or task-runner' }
  }
}
```

**Note 1:** This function was previously synchronous. It's now `async`. Update the return type annotation in the function signature AND check if the call site in `agent-handlers.ts` awaits it (it should, since it calls `return steerAgent(...)` — add `await` if it's missing).

**Note 2:** `SPRINT_API_KEY` is the same env var the task-runner uses. It's already available in the BDE main process env. If there's a `getGatewayConfig()` pattern in the existing file for reading config, use that instead if it also provides the sprint key.

### 3. `src/main/handlers/agent-handlers.ts` — await the now-async steerAgent

Find where `steerAgent` is called. Make sure it's awaited:

```typescript
// BEFORE (approximately):
return steerAgent(agentId, message)

// AFTER:
return await steerAgent(agentId, message)
```

### 4. `src/preload/index.ts` — plumb nextByte through sprint.readLog

Find line 108-109. Update:

```typescript
// BEFORE:
readLog: (agentId: string): Promise<{ content: string; status: string }> =>
  ipcRenderer.invoke('sprint:readLog', agentId),

// AFTER:
readLog: (agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }> =>
  ipcRenderer.invoke('sprint:readLog', agentId, fromByte),
```

### 5. `src/preload/index.d.ts` — update sprint type declaration

Find the `sprint` interface. Update the `readLog` signature:

```typescript
readLog(agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }>
```

### 6. `src/renderer/src/components/sprint/LogDrawer.tsx` — incremental reads + better empty states

**Change A: Add `fromByteRef`**

Add alongside the existing refs near the top of the component:

```typescript
const fromByteRef = useRef<number>(0)
```

**Change B: Reset `fromByteRef` on task change**

In the `useEffect` that resets state when `task?.agent_run_id` changes, add:

```typescript
fromByteRef.current = 0
setLogContent('')  // already exists
```

**Change C: Fix `fetchLog` to use incremental reads and append**

```typescript
const fetchLog = async (): Promise<void> => {
  try {
    const result = await window.api.sprint.readLog(task.agent_run_id!, fromByteRef.current)
    if (result.content) {
      setLogContent((prev) => prev + result.content)  // APPEND — not replace
      fromByteRef.current = result.nextByte
    }
    setAgentStatus(result.status)
  } catch {
    // Non-critical
  }
}
```

**Change D: Faster poll when active**

Replace `const LOG_POLL_INTERVAL = 2_000` with:

```typescript
const LOG_POLL_INTERVAL = task?.status === 'active' ? 750 : 5_000
```

Or make it a constant pair:
```typescript
const LOG_POLL_INTERVAL_ACTIVE = 750
const LOG_POLL_INTERVAL_DONE = 5_000
```

Use `LOG_POLL_INTERVAL_ACTIVE` in the `setInterval` call for active tasks.

**Change E: Better empty state rendering**

Replace the current "Agent is starting up..." fallback:

```tsx
// BEFORE:
) : (
  <div className="log-drawer__empty">Agent is starting up...</div>
)

// AFTER:
) : (
  <div className="log-drawer__empty">
    {agentStatus === 'running' ? (
      <span className="log-drawer__waiting">
        <span className="log-drawer__spinner" aria-hidden="true">◌</span>
        Agent running — waiting for output…
      </span>
    ) : agentStatus === 'done' || agentStatus === 'failed' ? (
      <span>No output captured for this run.</span>
    ) : (
      <span>Agent is starting up…</span>
    )}
  </div>
)
```

Add CSS in `sprint.css`:
```css
.log-drawer__waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bde-text-dim);
  font-size: 13px;
}

.log-drawer__spinner {
  display: inline-block;
  animation: spin 1.2s linear infinite;
  opacity: 0.6;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

## Files to Change

| File | Repo | What Changes |
|------|------|-------------|
| `scripts/task-runner.js` | life-os | `activeChildren` map, interactive spawn (remove `--print`, stream-json flags, JSON stdin), `POST /agents/:id/steer` endpoint, cleanup on close |
| `src/main/local-agents.ts` | BDE | `steerAgent` becomes async, adds task-runner REST fallback |
| `src/main/handlers/agent-handlers.ts` | BDE | Await the now-async `steerAgent` |
| `src/preload/index.ts` | BDE | `sprint.readLog` signature update (fromByte + nextByte) |
| `src/preload/index.d.ts` | BDE | Type declaration update |
| `src/renderer/src/components/sprint/LogDrawer.tsx` | BDE | `fromByteRef`, incremental append, 750ms poll, better empty states |
| `src/renderer/src/assets/sprint.css` | BDE | Spinner + waiting state CSS |

## Out of Scope
- Streaming via WebSocket or SSE (polling at 750ms is sufficient for v1)
- Killing a running agent from LogDrawer
- "Pause autopilot" UI toggle — steer input already exists and is shown when `status=active`
- Changing ChatThread to a terminal aesthetic
- BDE-spawned agent changes (steering already works for those)

## ⚠️ Critical: Task Runner Must Be Restarted After Merge

Only agents spawned AFTER the restart will use interactive mode. Previously-started agents keep `--print` behavior.

```bash
# Restart task runner after merging life-os PR
pkill -f task-runner.js && sleep 1 && \
node ~/Documents/Repositories/life-os/scripts/task-runner.js >> /tmp/task-runner.log 2>&1 &
```

Verify it started: `grep "API+SSE server listening" /tmp/task-runner.log | tail -1`

## Test Plan
1. Queue a new task, immediately open LogDrawer → should show "◌ Agent running — waiting for output…"
2. Within 5–10 seconds log content should start appearing (Claude thinking + tool calls streaming in)
3. Content grows incrementally — no re-reading from byte 0
4. While task is active: type a steer message, hit Send → no error toast, message appears in the thread
5. Verify steer message actually reaches the agent: check `grep "Steered agent" /tmp/task-runner.log`
6. For a done task: LogDrawer shows full output correctly
7. Verify `POST /agents/:id/steer` requires Bearer auth (curl without header → 401)

## PR Command

Two separate PRs (cross-repo change):

**life-os PR first:**
```bash
cd ~/Documents/Repositories/life-os
git checkout -b feat/task-runner-stream-json-steering
# ... make changes ...
git add scripts/task-runner.js
git commit -m "feat: stream-json spawn mode + agent steering endpoint (POST /agents/:id/steer)"
git push origin HEAD
gh api repos/RyanJBirkeland/life-os/pulls --method POST \
  -f title="feat: task runner stream-json mode + POST /agents/:id/steer" \
  -f body="Switches Claude Code spawn from --print (no streaming) to interactive stream-json mode. Log files now fill in real-time. Keeps stdin open for steering. Adds activeChildren map and POST /agents/:id/steer endpoint so BDE can send mid-run corrections. See docs/eval-logdrawer-steering.md for full investigation." \
  -f head="$(git branch --show-current)" -f base=main --jq ".html_url"
```

**BDE PR (can be simultaneous):**
```bash
cd ~/Documents/Repositories/BDE
git checkout -b fix/logdrawer-live-output-steering
# ... make changes ...
git add src/
git commit -m "fix: LogDrawer live output + agent steering — incremental reads, steer routes to task-runner"
git push origin HEAD
gh api repos/RyanJBirkeland/BDE/pulls --method POST \
  -f title="fix: LogDrawer live output + agent steering" \
  -f body="Fixes the 'Agent is starting up...' bug that persisted for the entire run. Root cause (--print buffering) fixed in life-os. This PR: incremental log reads with nextByte, 750ms poll when active, better waiting state UI, steerAgent now falls back to task-runner REST API so mid-run corrections actually reach the agent. See docs/eval-logdrawer-steering.md." \
  -f head="$(git branch --show-current)" -f base=main --jq ".html_url"
```
