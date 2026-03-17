# LD-S1: LogDrawer — Live Output + Agent Steering
**Epic:** Agent Visibility  
**Status:** Ready to implement

## Problem

Three compounding bugs make "View Output" useless:

1. **Empty log file on fresh agent** — `sprint:readLog` returns empty when `fromByte (0) >= size (0)`. LogDrawer sees no content and shows "Agent is starting up..." forever — even when the agent is actively running and the file fills up on disk.

2. **Incremental reads broken** — Preload doesn't expose `nextByte`, so LogDrawer re-reads from byte 0 on every 2s poll. It works eventually but it's wasteful and masked bug #1.

3. **Steering is a no-op** — `window.api.steerAgent()` calls `local-agents.ts`'s process map. Task-runner-spawned agents aren't in that map. Also, the task runner calls `child.stdin.end()` immediately after writing the prompt — the pipe is closed before any steer message could arrive.

The vision: "View Output" should feel like opening the Claude Code session directly. See live output as it streams. Send a correction mid-run. Hand it back.

## Solution

Fix all three bugs in one PR:

1. **Fix the `fromByte >= size` guard** — don't early-exit on initial read when file is 0 bytes
2. **Plumb `nextByte` properly** — preload + LogDrawer incremental reads
3. **Task runner: interactive spawn mode** — remove `child.stdin.end()`, write prompt as JSON event, keep child ref in `activeChildren` map, add `POST /tasks/:id/steer` to HTTP server
4. **BDE main: `sprint:steerTask` IPC** — POST to task runner's steer endpoint
5. **LogDrawer UX** — faster poll, better empty states, steer wired up

## Data / RPC Shapes

### Task runner: `POST /tasks/:id/steer`

**New endpoint in task-runner.js HTTP server:**

```
POST http://127.0.0.1:18799/tasks/:id/steer
Authorization: Bearer <SPRINT_API_KEY>
Content-Type: application/json

{ "message": "add unit tests for the extractSpec function" }
```

Response (200):
```json
{ "ok": true }
```

Response (404 — task not found or not running):
```json
{ "ok": false, "error": "Task not active or agent stdin not available" }
```

### Updated preload: `sprint.readLog()`

```typescript
// Before (preload/index.ts line 108):
readLog: (agentId: string): Promise<{ content: string; status: string }>

// After:
readLog: (agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }>
```

### New preload: `sprint.steerTask()`

```typescript
steerTask: (taskId: string, message: string): Promise<{ ok: boolean; error?: string }>
```

Note: This is `sprint.steerTask(taskId, ...)` — NOT `window.api.steerAgent(agentRunId, ...)`. Task ID is what LogDrawer has. The handler converts to the right format.

## Exact Changes

### 1. `life-os/scripts/task-runner.js` — Interactive spawn + steer endpoint

**Change 1: Add `activeChildren` map at module level (after the `db` initialization):**

```javascript
// Map from task_id → ChildProcess (for active agents)
const activeChildren = new Map()
```

**Change 2: Update the spawn block — interactive mode, keep stdin open**

Find the spawn section (starts at `const child = spawn(CLAUDE_BIN, [`). Replace the spawn args and stdin handling:

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
  '--add-dir', worktreeDir,
  // NOTE: no --print — interactive mode keeps stdin open for steering
], {
  cwd: worktreeDir,
  env: { ...process.env, HOME: '/Users/RBTECHBOT' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

// Register child for steering
activeChildren.set(task.id, child)

// Write initial prompt as JSON event (interactive mode format)
const initialEvent = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: promptText }
}) + '\n'
child.stdin.write(initialEvent)
// NOTE: do NOT call child.stdin.end() — keep open for steering
```

**Change 3: Clean up child on close**

In the existing `child.on('close', ...)` handler, add at the BEGINNING of the handler (before any existing logic):

```javascript
child.on('close', (code) => {
  activeChildren.delete(task.id)  // ADD THIS LINE FIRST
  // ... rest of existing close handler unchanged ...
})
```

**Change 4: Add `POST /tasks/:id/steer` to the HTTP server**

Find the route dispatch section (where `if (req.method === 'POST' && path === '/tasks')` is). Add a new route BEFORE the 404 fallback:

```javascript
// Steer a running agent — write a follow-up message to its stdin
if (req.method === 'POST' && path.match(/^\/tasks\/[^/]+\/steer$/)) {
  const taskId = path.split('/')[2]

  if (!isAuthenticated(req)) return send(res, 401, { error: 'Unauthorized' })

  let body = ''
  req.on('data', (d) => { body += d.toString() })
  req.on('end', () => {
    try {
      const { message } = JSON.parse(body)
      if (!message || typeof message !== 'string') {
        return send(res, 400, { error: 'message is required' })
      }

      const child = activeChildren.get(taskId)
      if (!child || !child.stdin || child.stdin.destroyed) {
        return send(res, 404, { error: 'Task not active or agent stdin not available' })
      }

      const event = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message }
      }) + '\n'
      child.stdin.write(event)

      log(`Steered task ${taskId}: "${message.slice(0, 60)}..."`)
      return send(res, 200, { ok: true })
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' })
    }
  })
  return
}
```

Note: The `send()` helper and `isAuthenticated()` helper already exist in the file — use them exactly as used by the existing POST /tasks handler.

### 2. `src/main/handlers/sprint.ts` — Add `sprint:steerTask` IPC handler

Find the `safeHandle` block at the end of the sprint handler registrations. Add:

```typescript
safeHandle('sprint:steerTask', async (_e, taskId: string, message: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const { url: gatewayUrl } = await getGatewayConfig()
    // Task runner is always local — use fixed port, not tunneled gateway URL
    const taskRunnerUrl = 'http://127.0.0.1:18799'
    const apiKey = process.env.SPRINT_API_KEY ?? ''

    const response = await fetch(`${taskRunnerUrl}/tasks/${taskId}/steer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    })

    const data = await response.json() as { ok?: boolean; error?: string }
    return { ok: data.ok ?? false, error: data.error }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})
```

Note: `SPRINT_API_KEY` must already be set in the environment (it's used by the task runner). Verify how it's loaded in the existing sprint handler — use the same mechanism (likely `process.env.SPRINT_API_KEY` or a config read). Do NOT hardcode the key.

### 3. `src/preload/index.ts` — Update `sprint.readLog` + add `sprint.steerTask`

Find the `sprint` object. Make these two changes:

**Before:**
```typescript
readLog: (agentId: string): Promise<{ content: string; status: string }> =>
  ipcRenderer.invoke('sprint:readLog', agentId),
```

**After:**
```typescript
readLog: (agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }> =>
  ipcRenderer.invoke('sprint:readLog', agentId, fromByte),
steerTask: (taskId: string, message: string): Promise<{ ok: boolean; error?: string }> =>
  ipcRenderer.invoke('sprint:steerTask', taskId, message),
```

### 4. `src/preload/index.d.ts` — Update type declarations

Find the `sprint` interface. Update:
```typescript
readLog(agentId: string, fromByte?: number): Promise<{ content: string; status: string; nextByte: number }>
steerTask(taskId: string, message: string): Promise<{ ok: boolean; error?: string }>
```

### 5. `src/main/handlers/sprint.ts` — Fix the `fromByte >= size` guard

Find this block in the `sprint:readLog` handler:

```typescript
if (fromByte >= size) { await fh.close(); return { content: '', status: agent.status, nextByte: fromByte } }
```

Change to:
```typescript
// Only skip if fromByte > 0 (we've already read something before).
// When fromByte === 0 and size === 0, the agent just started — return empty but don't bail permanently.
if (fromByte > 0 && fromByte >= size) { await fh.close(); return { content: '', status: agent.status, nextByte: fromByte } }
if (size === 0) { await fh.close(); return { content: '', status: agent.status, nextByte: 0 } }
```

This way: initial read on empty file returns empty (correct), AND the next poll will re-check from byte 0 (also correct — picks up content when it appears). This is a 2-line change.

### 6. `src/renderer/src/components/sprint/LogDrawer.tsx` — Fix all 3 bugs in the renderer

#### 6a. Track `fromByte` with a ref

Add this ref at the top of the component:
```typescript
const fromByteRef = useRef<number>(0)
```

#### 6b. Fix `fetchLog` to use + update `fromByte`

In the `useEffect`, update `fetchLog`:

```typescript
const fetchLog = async (): Promise<void> => {
  try {
    const result = await window.api.sprint.readLog(task.agent_run_id!, fromByteRef.current)
    if (result.content) {
      setLogContent((prev) => prev + result.content)  // APPEND, don't replace
      fromByteRef.current = result.nextByte
    }
    setAgentStatus(result.status)
  } catch {
    // Non-critical
  }
}
```

**Important:** Change `setLogContent(result.content)` → `setLogContent((prev) => prev + result.content)`. This makes it incremental — only new bytes get appended, the full parse runs on all accumulated content.

Also reset `fromByteRef.current = 0` and `setLogContent('')` at the top of the useEffect (already resets on task change):
```typescript
setLogContent('')
fromByteRef.current = 0
```

#### 6c. Faster poll when active

Change the poll interval:
```typescript
// BEFORE:
const LOG_POLL_INTERVAL = 2_000

// AFTER:
const LOG_POLL_INTERVAL_ACTIVE = 750   // fast when agent is running
const LOG_POLL_INTERVAL_DONE = 5_000   // slow when done (just refreshing status)
```

Update the `setInterval` call:
```typescript
if (isActive) {
  pollRef.current = setInterval(fetchLog, LOG_POLL_INTERVAL_ACTIVE)
}
```

After the `close` handler fires (on task status change to done/cancelled), you might want to do one final `fetchLog` to get the tail — this already happens because `task?.status` is a dependency.

#### 6d. Better empty states

Replace the empty state rendering:

```tsx
// BEFORE:
) : (
  <div className="log-drawer__empty">Agent is starting up...</div>
)

// AFTER:
) : (
  <div className="log-drawer__empty">
    {agentStatus === 'running' ? (
      <>
        <span className="log-drawer__spinner">◌</span>
        Waiting for agent output...
      </>
    ) : agentStatus === 'done' || agentStatus === 'failed' ? (
      <span>No output captured for this run.</span>
    ) : (
      <span>Agent is starting up...</span>
    )}
  </div>
)
```

#### 6e. Wire steering to `sprint.steerTask` (not `steerAgent`)

Find `handleSteerSend`. Change:

```typescript
// BEFORE:
const result = await window.api.steerAgent(task.agent_run_id, msg)

// AFTER:
const result = await window.api.sprint.steerTask(task.id, msg)
if (result.ok) {
  // Optimistically show user message in the thread
  setSentMessages((prev) => [
    ...prev,
    { role: 'user', content: msg, timestamp: Date.now() }
  ])
}
```

Wait — `setSentMessages` is currently called BEFORE the API call (optimistic). Keep it optimistic but move the error check to remove the message on failure:

```typescript
const handleSteerSend = useCallback(async () => {
  const msg = steerInput.trim()
  if (!msg || !task?.id) return
  setSteerInput('')

  const result = await window.api.sprint.steerTask(task.id, msg)
  if (result.ok) {
    setSentMessages((prev) => [
      ...prev,
      { role: 'user', content: msg, timestamp: Date.now() }
    ])
  } else {
    toast.error(result.error ?? 'Failed to send message to agent')
  }
}, [steerInput, task?.id])
```

Note: Remove the old `task?.agent_run_id` reference in `canSteer` — it can just be `task?.status === 'active'`:
```typescript
const canSteer = task?.status === 'active'
```

### 7. CSS — spinner animation

Append to `sprint.css`:
```css
.log-drawer__spinner {
  display: inline-block;
  margin-right: 6px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

## Files to Change

| File | What Changes |
|------|-------------|
| `life-os/scripts/task-runner.js` | Interactive spawn (remove `--print`, keep stdin open), `activeChildren` map, `POST /tasks/:id/steer` endpoint |
| `src/main/handlers/sprint.ts` | Fix `fromByte >= size` guard, add `sprint:steerTask` handler |
| `src/preload/index.ts` | Update `sprint.readLog` signature, add `sprint.steerTask` |
| `src/preload/index.d.ts` | Update type declarations |
| `src/renderer/src/components/sprint/LogDrawer.tsx` | `fromByteRef`, incremental append, faster poll, better empty states, steer via `steerTask` |
| `src/renderer/src/assets/sprint.css` | Spinner animation |

## Out of Scope
- Streaming log content via SSE/WebSocket (polling is fine for v1)
- Pause/resume agent control (separate ticket)
- Killing a running agent from LogDrawer
- Showing tool call details in ChatThread (already works via stream parser)
- Changing ChatThread rendering to "terminal" aesthetic — the chat bubble UI is fine

## Test Plan
1. Queue a new task, open LogDrawer immediately — should show "Waiting for agent output..." (spinner), NOT eternal "starting up"
2. Wait ~5s — log content appears and updates every 750ms
3. After agent finishes — log content shows final result, steer input disappears
4. While agent is active: type a message in steer input, hit Send → verify message appears in the thread
5. Verify `POST /tasks/:id/steer` in task runner is protected by Bearer auth (401 without header)
6. Open an existing done task's LogDrawer — shows "No output captured" or full log content correctly

## ⚠️ Critical: Task Runner Restart Required
After pushing this PR and merging, the task runner MUST be restarted for the interactive spawn changes to take effect:
```bash
pkill -f task-runner.js && node ~/Documents/Repositories/life-os/scripts/task-runner.js >> /tmp/task-runner.log 2>&1 &
```
Any tasks queued before the restart will spawn with the old `--print` mode. Only tasks spawned AFTER restart will support steering.

## PR Command
This is a life-os + BDE cross-repo change. Two commits, two PRs:

```bash
# PR 1: life-os task-runner changes
cd ~/Documents/Repositories/life-os
git checkout -b feat/task-runner-interactive-steer
git add scripts/task-runner.js
git commit -m "feat: interactive spawn mode + POST /tasks/:id/steer endpoint"
git push origin HEAD
gh api repos/RyanJBirkeland/life-os/pulls --method POST \
  -f title="feat: task runner interactive mode + agent steering endpoint" \
  -f body="Switches Claude Code spawn from --print to interactive mode. Keeps stdin open. Adds activeChildren map. Exposes POST /tasks/:id/steer so BDE can send messages to running agents mid-execution." \
  -f head="$(git branch --show-current)" -f base=main --jq ".html_url"

# PR 2: BDE UI changes (open after life-os PR is merged or can be simultaneous)
cd ~/Documents/Repositories/BDE
git checkout -b feat/logdrawer-live-output-steering
git add src/
git commit -m "fix: LogDrawer live output (fromByte, incremental reads, 750ms poll, better empty states) + agent steering via sprint:steerTask"
git push origin HEAD
gh api repos/RyanJBirkeland/BDE/pulls --method POST \
  -f title="fix: LogDrawer — live output + agent steering" \
  -f body="Fixes 3 bugs: (1) eternal 'starting up' on empty log file, (2) incremental reads now use nextByte correctly, (3) steer now routes to task runner via sprint:steerTask instead of broken local-agents map. Also: 750ms poll interval when agent is active, better empty states." \
  -f head="$(git branch --show-current)" -f base=main --jq ".html_url"
```
