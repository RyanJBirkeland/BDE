# Real-Time Sprint Board Architecture Evaluation

> **Status: PARTIALLY IMPLEMENTED (2026-03-16)**
> Phase 0 (file watcher on `bde.db`) shipped and is the current sync mechanism (`src/main/index.ts:19-47`).
> Supabase has been fully replaced by local SQLite (`~/.bde/bde.db`).
> SSE (Phases 1-4) remains a future optimization option — polling + file watcher is sufficient for current scale.
> PR status polling interval is now 60s (was proposed as 15s in this doc).

**Date:** 2026-03-16
**Author:** Architecture Review (automated)
**Scope:** BDE Sprint Board ↔ Task Runner data synchronization

---

## 1. Current Architecture

### System Overview

Two independent processes share a SQLite database (`~/.bde/bde.db`):

1. **Task Runner** (`life-os/scripts/task-runner.js`) — a Node.js daemon that polls the `sprint_tasks` table for queued work, spawns Claude Code agents in git worktrees, and writes status updates back to SQLite.
2. **BDE Electron App** — reads `sprint_tasks` via IPC handlers in the main process, renders a Kanban board in the renderer, and polls for changes on intervals.

Neither process knows the other exists. SQLite WAL mode enables concurrent read/write access.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TASK RUNNER PROCESS                              │
│  (life-os/scripts/task-runner.js)                                       │
│                                                                         │
│  ┌──────────┐    poll every     ┌──────────┐   spawn    ┌───────────┐  │
│  │ poll()   │───30s (default)──▶│  SQLite   │◀──────────│ Claude    │  │
│  │ loop     │    read queued    │  Queries  │  write     │ Agent     │  │
│  └──────────┘    claim task     └─────┬─────┘  status    │ (child)   │  │
│                                       │        pr_url    └───────────┘  │
│                                       │                                 │
│                                       ▼                                 │
│                            ┌──────────────────┐                         │
│                            │  ~/.bde/bde.db   │                         │
│                            │  (WAL mode)      │                         │
│                            │                  │                         │
│                            │  sprint_tasks    │                         │
│                            │  agent_runs      │                         │
│                            └────────┬─────────┘                         │
│                                     │                                   │
└─────────────────────────────────────┼───────────────────────────────────┘
                                      │
                          ════════════╪══════════════
                           No direct  │  communication
                           channel    │  between processes
                          ════════════╪══════════════
                                      │
┌─────────────────────────────────────┼───────────────────────────────────┐
│                        BDE ELECTRON APP                                 │
│                                     │                                   │
│  ┌──────────────────────────────────┼─────────────────────────────┐     │
│  │              MAIN PROCESS        │                             │     │
│  │                                  ▼                             │     │
│  │  ┌──────────────┐     ┌──────────────────┐                    │     │
│  │  │  sprint:list │────▶│  getDb()         │                    │     │
│  │  │  sprint:create│    │  SELECT/INSERT/  │                    │     │
│  │  │  sprint:update│◀───│  UPDATE/DELETE   │                    │     │
│  │  │  sprint:delete│    └──────────────────┘                    │     │
│  │  │  sprint:readLog│                                           │     │
│  │  └──────┬───────┘                                             │     │
│  │         │ ipcMain.handle()                                    │     │
│  └─────────┼─────────────────────────────────────────────────────┘     │
│            │                                                           │
│            │ IPC (invoke/handle)                                       │
│            │                                                           │
│  ┌─────────┼─────────────────────────────────────────────────────┐     │
│  │         │        PRELOAD BRIDGE                               │     │
│  │         ▼                                                     │     │
│  │  window.api.sprint.list()                                     │     │
│  │  window.api.sprint.create()                                   │     │
│  │  window.api.sprint.update()                                   │     │
│  │  window.api.sprint.readLog()                                  │     │
│  └─────────┬─────────────────────────────────────────────────────┘     │
│            │                                                           │
│  ┌─────────┼─────────────────────────────────────────────────────┐     │
│  │         │        RENDERER PROCESS                             │     │
│  │         ▼                                                     │     │
│  │  ┌──────────────────┐                                         │     │
│  │  │  SprintCenter    │    Adaptive Polling:                    │     │
│  │  │  (React state)   │    ├─ 5s  when tasks are 'active'      │     │
│  │  │                  │    ├─ 30s when idle                     │     │
│  │  │  tasks[]         │    ├─ 15s PR status checks (gh CLI)    │     │
│  │  │  prMergedMap{}   │    └─ 2s  agent log (LogDrawer open)   │     │
│  │  └────────┬─────────┘                                         │     │
│  │           │ props                                              │     │
│  │           ▼                                                    │     │
│  │  ┌──────────────────┐                                         │     │
│  │  │  KanbanBoard     │                                         │     │
│  │  │  ├─ KanbanColumn │ × 4 (Backlog, Sprint, Active, Done)    │     │
│  │  │  │  └─ TaskCard[]│                                         │     │
│  │  │  ├─ LogDrawer    │                                         │     │
│  │  │  ├─ SpecDrawer   │                                         │     │
│  │  │  └─ PRSection    │                                         │     │
│  │  └──────────────────┘                                         │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Polling Intervals Summary

| What                     | Interval                      | Where              | Trigger                               |
| ------------------------ | ----------------------------- | ------------------ | ------------------------------------- |
| Task Runner poll loop    | 30s (env: `POLL_INTERVAL_MS`) | task-runner.js:427 | `setInterval`                         |
| Sprint task list refresh | 5s (active) / 30s (idle)      | SprintCenter.tsx   | `useEffect` + `setInterval`           |
| PR merge status check    | 15s                           | SprintCenter.tsx   | `setInterval`                         |
| Agent log tailing        | 2s                            | LogDrawer.tsx      | `setInterval` (only when drawer open) |
| PR list from GitHub      | 60s                           | PRList.tsx         | `setInterval`                         |

---

## 2. Pain Points

| #   | Pain Point                                                                                                                                                                                                                                                                              | Impact                            | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------- |
| 1   | **Stale data window: up to 30s in idle mode** — when task runner changes a task from `queued` → `active`, BDE won't see it for up to 30s if no tasks were previously active. The adaptive polling helps once tasks are active (5s), but the transition from idle→active is the slowest. | User sees stale Kanban state      | Medium   |
| 2   | **Missed state transitions** — if a task goes `queued` → `active` → `done` within a single 30s idle window (fast agent execution), BDE skips the `active` state entirely. User never sees the task move to Active column.                                                               | Confusing UX — task jumps columns | Medium   |
| 3   | **SQLite concurrent write contention** — both processes open the same DB. WAL mode mitigates read/write concurrency, but simultaneous writes (e.g., user drags a task in BDE while task runner claims it) can produce `SQLITE_BUSY`. Neither process retries on busy.                   | Potential silent data loss        | High     |
| 4   | **No write conflict detection** — if task runner sets `status = 'active'` at the same moment the user drags it to `done`, last write wins. No optimistic concurrency control (no version column, no `updated_at` check).                                                                | Data corruption (silent)          | High     |
| 5   | **Task runner restart → BDE unaware** — when task runner restarts, it reconciles orphaned tasks (resetting dead ones to `queued`). BDE doesn't know about the restart and may show stale `active` status for up to 30s.                                                                 | Misleading status display         | Low      |
| 6   | **Polling overhead on idle** — every 30s, BDE fetches the entire `sprint_tasks` table. With many tasks, this is wasteful bandwidth through IPC when nothing has changed.                                                                                                                | Minor perf waste                  | Low      |
| 7   | **Optimistic update divergence** — SprintCenter does optimistic updates (immediately mutates local state, then writes to DB). If the DB write fails or task runner concurrently changed the same row, the optimistic state diverges from truth until the next poll.                     | Temporary UI lie                  | Medium   |
| 8   | **No change detection** — BDE fetches the full task list every poll, diffs nothing, and replaces the entire `tasks[]` array. This can cause unnecessary re-renders and flicker (e.g., selected task gets replaced with a new object reference).                                         | Minor UX flicker                  | Low      |

---

## 3. Alternative Approaches

### 3a. File Watcher on `bde.db` (fs.watch / chokidar)

**Mechanism:** Electron main process watches `~/.bde/bde.db` (and WAL/SHM files) for filesystem changes. On change, push an IPC event to renderer to trigger a refresh.

| Aspect                     | Detail                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros**                   | Zero changes to task runner. Works with any process that writes to the DB. Simple to implement.                                                                                                                                                                                                                                                            |
| **Cons**                   | Coarse-grained — fires on ANY table change, not just `sprint_tasks`. WAL mode complicates this: writes go to `-wal` file first, then checkpoint to main DB, so timing is unpredictable. `fs.watch` on macOS (FSEvents) can batch/delay notifications. No payload — still requires a full SELECT after notification. False positives from BDE's own writes. |
| **Complexity**             | **S** — ~30 lines in main process                                                                                                                                                                                                                                                                                                                          |
| **Correctness on restart** | Good — file watcher survives task runner restarts since it watches the file, not the process.                                                                                                                                                                                                                                                              |
| **Verdict**                | Viable as a quick improvement over polling but unreliable for latency-sensitive updates due to WAL checkpointing behavior and lack of granularity.                                                                                                                                                                                                         |

### 3b. `better-sqlite3` update_hook()

**Mechanism:** `better-sqlite3` exposes SQLite's `sqlite3_update_hook()` which fires a callback on every INSERT/UPDATE/DELETE **in the same process**. Only the process that opened the DB connection receives the hook.

| Aspect                     | Detail                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros**                   | Row-level granularity (table name, row ID, operation type). Zero latency for changes made by the same process.                                                                                                                                                                                    |
| **Cons**                   | **Fundamental limitation: does NOT fire for changes made by OTHER processes.** Task runner writes are invisible to BDE's update_hook, and vice versa. This makes it useless for the cross-process notification problem. Would only help BDE detect its own writes (which it already knows about). |
| **Complexity**             | **S** — but solves the wrong problem                                                                                                                                                                                                                                                              |
| **Correctness on restart** | N/A                                                                                                                                                                                                                                                                                               |
| **Verdict**                | **Not viable.** SQLite update hooks are per-connection, not cross-process. This is a dead end for BDE↔task runner sync.                                                                                                                                                                           |

### 3c. Unix Domain Socket (UDS)

**Mechanism:** Task runner creates a UDS server (e.g., `/tmp/bde-task-runner.sock`). Electron main process connects as client. Task runner pushes JSON messages on every status change (`{ type: 'task:updated', taskId, status, ... }`).

| Aspect                     | Detail                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros**                   | Real-time push with zero latency. Structured payloads — can include the changed fields, avoiding a full DB re-read. Lightweight, no HTTP overhead. Well-suited for same-machine IPC. Can be bidirectional (BDE could send commands to task runner).                                |
| **Cons**                   | Requires changes to BOTH processes. Must handle connection lifecycle: task runner not running, task runner restarts, socket file cleanup. Need a reconnect loop in BDE. Socket file can become stale (task runner crashes without cleanup). Slightly more complex protocol design. |
| **Complexity**             | **M** — ~100-150 lines per side (server + client), plus reconnect logic                                                                                                                                                                                                            |
| **Correctness on restart** | Requires explicit handling. BDE must detect disconnection and reconnect. Task runner must clean up stale socket on startup. During disconnection, BDE falls back to polling or queues a full refresh on reconnect.                                                                 |
| **Verdict**                | Strong candidate. Clean, fast, purpose-built for local IPC. Main cost is connection lifecycle management.                                                                                                                                                                          |

### 3d. HTTP SSE (Server-Sent Events)

**Mechanism:** Task runner runs a small HTTP server (e.g., `http://localhost:18799/events`). Electron main process subscribes with `EventSource` or `fetch` with streaming. Task runner pushes events on status changes.

| Aspect                     | Detail                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pros**                   | Standard protocol with built-in reconnection semantics (`EventSource` auto-reconnects with `Last-Event-ID`). Structured events with types. Can be monitored/debugged with curl. One-directional push (server→client) is a clean model. HTTP is well-understood.                                        |
| **Cons**                   | Requires HTTP server in task runner (adds dependency, port management). `EventSource` API is renderer-only in Electron — main process would need a custom SSE client or use `fetch` streaming. Slightly more overhead than UDS (HTTP framing). Port conflicts possible (though unlikely on localhost). |
| **Complexity**             | **M** — ~80-120 lines for SSE server, ~50 lines for client                                                                                                                                                                                                                                             |
| **Correctness on restart** | **Best in class.** SSE has built-in reconnect with `retry:` field and `Last-Event-ID` for resumption. Electron client reconnects automatically. Task runner restart = client reconnects when new server starts. No stale socket files.                                                                 |
| **Verdict**                | Strong candidate. Excellent restart semantics. Slightly heavier than UDS but more robust protocol.                                                                                                                                                                                                     |

### 3e. WebSocket (ws server in task runner, ws client in Electron main)

**Mechanism:** Task runner hosts a WebSocket server. Electron main process connects as a client. Bidirectional messaging for push notifications.

| Aspect                     | Detail                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros**                   | Bidirectional — BDE could send commands (e.g., cancel task) to task runner. Low latency. Well-supported in Node.js (`ws` package). Familiar protocol.                                                                                                                                                                                               |
| **Cons**                   | Heavier than UDS or SSE for a one-directional push use case. Requires `ws` npm dependency in task runner (or use Node.js experimental WebSocket). No built-in reconnection semantics — must implement retry logic manually. Bidirectionality is unnecessary complexity if BDE only needs to receive updates (it already writes to SQLite directly). |
| **Complexity**             | **M** — ~100 lines per side, plus reconnect logic                                                                                                                                                                                                                                                                                                   |
| **Correctness on restart** | Must be manually handled. No protocol-level reconnection like SSE. Client needs exponential backoff retry.                                                                                                                                                                                                                                          |
| **Verdict**                | Viable but over-engineered for this use case. The bidirectional capability isn't needed — BDE writes to SQLite, not to task runner.                                                                                                                                                                                                                 |

### 3f. Shared Memory / mmap

**Mechanism:** Both processes map a shared memory region. Task runner writes status updates to shared memory; BDE reads from it.

| Aspect                     | Detail                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pros**                   | Fastest possible IPC (no syscalls for read/write after setup).                                                                                                                                               |
| **Cons**                   | Enormous complexity. No Node.js native support — requires N-API addon. Must implement own serialization, synchronization (mutexes), and change notification. Fragile. Hard to debug. No structured protocol. |
| **Complexity**             | **L** — custom N-API module, shared memory layout, synchronization primitives                                                                                                                                |
| **Correctness on restart** | Terrible. Shared memory segments can leak. Process crashes leave corrupted state.                                                                                                                            |
| **Verdict**                | **Not viable.** Massive overkill for pushing ~10 status updates per hour between two local processes.                                                                                                        |

---

## 4. Comparison Matrix

| Criteria                   | File Watcher | update_hook | Unix Socket |   SSE    | WebSocket | Shared Mem  |
| -------------------------- | :----------: | :---------: | :---------: | :------: | :-------: | :---------: |
| Cross-process notification |   Partial    |   **No**    |     Yes     |   Yes    |    Yes    |     Yes     |
| Latency                    |    ~1-5s     |     N/A     |    <10ms    |  <50ms   |   <10ms   |    <1ms     |
| Payload with notification  |      No      |     N/A     |     Yes     |   Yes    |    Yes    |     Yes     |
| Restart resilience         |     Good     |     N/A     |   Manual    | **Auto** |  Manual   |    Poor     |
| Changes to task runner     |     None     |     N/A     |  ~100 LOC   | ~80 LOC  | ~100 LOC  |  ~500 LOC   |
| Changes to BDE main        |   ~30 LOC    |     N/A     |  ~100 LOC   | ~50 LOC  | ~100 LOC  |  ~500 LOC   |
| Dependencies added         |     None     |    None     |    None     |   None   |   `ws`    | N-API addon |
| Bidirectional              |      No      |     No      |     Yes     |    No    |    Yes    |     Yes     |
| Implementation size        |    **S**     |     N/A     |    **M**    |  **M**   |   **M**   |    **L**    |
| Correctness                |     Fair     |     N/A     |    Good     | **Best** |   Good    |    Poor     |

---

## 5. Recommendation: HTTP SSE (Option 3d)

### Rationale

**SSE is the right tool for this job.** Here's why:

1. **Unidirectional push is exactly the right model.** Task runner produces status changes; BDE consumes them. BDE doesn't need to send commands back — it writes directly to SQLite. SSE's one-way push maps perfectly to this data flow.

2. **Built-in reconnection is critical.** The task runner and BDE are independent processes with independent lifecycles. Task runner can restart, crash, or be stopped/started independently. SSE's `EventSource` protocol has native reconnect with `retry:` interval and `Last-Event-ID` for resumption. This eliminates an entire class of connection lifecycle bugs.

3. **No new dependencies.** Node.js `http` module is sufficient for the SSE server. Electron main process can use `fetch` with streaming or the `undici` client already bundled with Node 22.

4. **Debuggable.** `curl http://localhost:18799/events` instantly shows the event stream. No special tooling needed.

5. **Graceful degradation.** If SSE connection is down, BDE falls back to existing polling. This means the migration is additive — SSE accelerates updates but polling remains as a safety net.

6. **Minimal blast radius.** Task runner gets a small HTTP server (~80 lines). BDE main process gets an SSE client (~50 lines) that pushes events to the renderer via existing IPC. Renderer just listens for a new IPC event and triggers `loadData()`.

### Why not Unix Domain Socket?

UDS is a close second. It's slightly faster (<10ms vs <50ms), but that latency difference is imperceptible for a Kanban board UI. The critical advantage SSE has is **protocol-level reconnection**. With UDS, you must implement:

- Stale socket file detection and cleanup
- Client reconnect with backoff
- Connection state tracking
- Graceful vs. ungraceful disconnect handling

SSE gives you all of this for free.

### Why not File Watcher?

File watcher is the simplest option (S complexity, no task runner changes), but its unreliability with WAL mode makes it a poor foundation. WAL writes happen to the `-wal` file, and checkpointing to the main DB is asynchronous. You'd get notifications at unpredictable times, sometimes immediately, sometimes seconds later, sometimes not at all until a checkpoint. It also provides no payload, so you still need a full SELECT on every notification.

That said, file watcher could be a **Phase 0** quick win before investing in SSE. See migration plan below.

---

## 6. Migration Plan

### Phase 0: Quick Win — File Watcher (Optional, 1-2 hours)

A low-risk improvement that can ship immediately while SSE is being built.

**BDE main process (`src/main/index.ts`):**

```typescript
// Watch bde.db and WAL file for changes from external processes
import { watch } from 'node:fs'

const dbPath = join(homedir(), '.bde', 'bde.db')
const walPath = dbPath + '-wal'

let debounceTimer: NodeJS.Timeout | null = null

function onDbChange() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    // Notify all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('sprint:external-change')
    }
  }, 500) // debounce to avoid rapid-fire
}

watch(dbPath, onDbChange)
watch(walPath, onDbChange)
```

**BDE renderer (SprintCenter.tsx):**

```typescript
// Listen for external DB change notifications
useEffect(() => {
  const handler = () => loadData()
  window.api.onExternalSprintChange(handler) // new preload bridge method
  return () => window.api.offExternalSprintChange(handler)
}, [loadData])
```

**Preload bridge addition:**

```typescript
onExternalSprintChange: (cb: () => void) => ipcRenderer.on('sprint:external-change', cb),
offExternalSprintChange: (cb: () => void) => ipcRenderer.removeListener('sprint:external-change', cb),
```

### Phase 1: SSE Server in Task Runner (2-4 hours)

**Changes to `task-runner.js`:**

1. Add an HTTP server that serves SSE on `/events`:

```javascript
import { createServer } from 'node:http'

const SSE_PORT = parseInt(process.env.SSE_PORT || '18799', 10)
const sseClients = new Set()

function createSseServer() {
  const server = createServer((req, res) => {
    if (req.url !== '/events' || req.method !== 'GET') {
      res.writeHead(404)
      res.end()
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('retry: 3000\n\n') // reconnect after 3s

    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })

  server.listen(SSE_PORT, '127.0.0.1', () => {
    log(`SSE server listening on http://127.0.0.1:${SSE_PORT}/events`)
  })
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(msg)
  }
}
```

2. Emit events at every state transition point:

```javascript
// In claimTask():
broadcast('task:updated', { id: taskId, status: 'active' })

// In updateTask():
broadcast('task:updated', { id: taskId, ...updates })

// In spawnAgent() on close:
broadcast('task:updated', { id: task.id, status: code === 0 ? 'done' : 'cancelled', pr_url: prUrl })

// In reconcileActiveTasks():
broadcast('task:updated', { id: task.id, status: prUrl ? 'done' : 'queued' })
```

3. Call `createSseServer()` at startup (after `loadEnv()`).

### Phase 2: SSE Client in BDE Main Process (2-3 hours)

**New file: `src/main/sprint-sse.ts`:**

```typescript
import { BrowserWindow } from 'electron'

const SSE_URL = 'http://127.0.0.1:18799/events'
let abortController: AbortController | null = null

export function startSprintSseClient() {
  connect()
}

async function connect() {
  if (abortController) abortController.abort()
  abortController = new AbortController()

  try {
    const res = await fetch(SSE_URL, {
      signal: abortController.signal,
      headers: { Accept: 'text/event-stream' }
    })

    if (!res.ok || !res.body) {
      scheduleReconnect()
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = parseSSE(buffer)
      buffer = events.remainder

      for (const event of events.parsed) {
        notifyRenderer(event)
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      scheduleReconnect()
    }
  }
}

function scheduleReconnect() {
  setTimeout(connect, 3000)
}

function notifyRenderer(event: { type: string; data: unknown }) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sprint:sse-event', event)
  }
}

function parseSSE(buffer: string) {
  // Standard SSE parsing: split on double newline, extract event/data fields
  const parsed = []
  const parts = buffer.split('\n\n')
  const remainder = parts.pop() ?? '' // incomplete event stays in buffer

  for (const part of parts) {
    if (!part.trim()) continue
    let type = 'message'
    let data = ''
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (data) {
      try {
        parsed.push({ type, data: JSON.parse(data) })
      } catch {
        /* skip malformed */
      }
    }
  }

  return { parsed, remainder }
}

export function stopSprintSseClient() {
  if (abortController) abortController.abort()
}
```

**Wire into `src/main/index.ts`:**

```typescript
import { startSprintSseClient, stopSprintSseClient } from './sprint-sse'

app.whenReady().then(() => {
  // ... existing setup ...
  startSprintSseClient()
})

app.on('will-quit', () => {
  stopSprintSseClient()
})
```

### Phase 3: Renderer Integration (1-2 hours)

**Preload bridge addition (`src/preload/index.ts`):**

```typescript
onSprintSseEvent: (cb: (event: { type: string; data: unknown }) => void) =>
  ipcRenderer.on('sprint:sse-event', (_e, event) => cb(event)),
offSprintSseEvent: () => ipcRenderer.removeAllListeners('sprint:sse-event'),
```

**SprintCenter.tsx changes:**

```typescript
// Add SSE event listener alongside existing polling
useEffect(() => {
  const handler = (event: { type: string; data: any }) => {
    if (event.type === 'task:updated') {
      // Surgical update: merge the changed fields into local state
      setTasks((prev) => prev.map((t) => (t.id === event.data.id ? { ...t, ...event.data } : t)))
      // Also trigger a full refresh to ensure consistency
      // (debounced to avoid flooding on rapid updates)
      debouncedLoadData()
    }
  }
  window.api.onSprintSseEvent(handler)
  return () => window.api.offSprintSseEvent()
}, [debouncedLoadData])
```

### Phase 4: Reduce Polling (30 min)

Once SSE is confirmed working:

1. **Increase idle poll interval** from 30s → 120s (safety net only)
2. **Increase active poll interval** from 5s → 30s
3. **Keep PR polling unchanged** (15s) — this is GitHub API, not affected by SSE
4. **Keep log polling unchanged** (2s) — this reads a file, separate concern

The polling remains as a consistency backstop, not the primary update mechanism.

---

## 7. Process Lifecycle Concerns

| Scenario                      | Current Behavior                                            | With SSE                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Task runner not running       | BDE works fine, just shows stale data from last known state | SSE client fails to connect, retries every 3s silently. Polling continues as fallback. No degradation.                                 |
| Task runner restarts          | BDE unaware for up to 30s                                   | SSE connection drops, client reconnects in 3s. First reconnect triggers a full `loadData()` to catch any changes made during downtime. |
| BDE restarts                  | Fresh start, loads from DB                                  | SSE client connects on startup. No special handling needed.                                                                            |
| Both restart simultaneously   | Both read from SQLite independently                         | SSE client retries until task runner's server is ready. SQLite is the source of truth throughout.                                      |
| Task runner crashes (unclean) | Orphaned tasks recovered on next task runner start          | Same as restart — SSE reconnects. Task runner's `reconcileActiveTasks()` fires on restart, emits SSE events for each recovered task.   |
| Network partition             | N/A (same machine)                                          | N/A (localhost only)                                                                                                                   |

**Key invariant:** SQLite remains the single source of truth. SSE is an optimization for notification latency, not a replacement for the database. If SSE is down, polling ensures eventual consistency. If SSE delivers a stale event, the full `loadData()` refresh corrects it.

---

## 8. Concerns and Open Questions

1. **Port collision:** SSE server on port 18799 could conflict with other local services. Consider making it configurable via env var and having BDE read it from a well-known location (e.g., a pidfile or the task runner's `.env`).

2. **Agent log streaming:** SSE could also push agent log chunks in real time, eliminating the 2s LogDrawer polling. This is a natural Phase 5 extension but should be scoped separately — log payloads can be large.

3. **Write conflict resolution:** SSE doesn't solve the concurrent write problem (pain point #3-4). Consider adding an `updated_at` version check to `sprint:update`:

   ```sql
   UPDATE sprint_tasks SET ... WHERE id = ? AND updated_at = ?
   ```

   If `changes === 0`, the row was modified concurrently — reload and re-apply.

4. **Task runner as SSE dependency:** BDE now has a soft dependency on the task runner for real-time updates. This is acceptable because (a) polling remains as fallback, and (b) the task runner is already a de facto dependency for sprint automation.

5. **Multiple BDE instances:** If the user opens multiple BDE windows, each gets its own SSE subscription via the main process broadcast. This is correct — `BrowserWindow.getAllWindows()` handles it.
