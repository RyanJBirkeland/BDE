# BDE Systems Performance Evaluation

> **Status: PRE-FIX AUDIT (2026-03-16)**
> Several issues identified here have been partially addressed:
>
> - P0 #2 (backdrop-filter): Replaced with solid `rgba()` backgrounds.
> - P0 #3 (log tail reads entire file): Fixed with positioned `fh.read()` via byte offset.
> - P1 #4 (no polling backpressure): Sprint polling gated on `activeView`.
> - Framer Motion stagger on large lists: Disabled for lists >10 items.
> - Remaining items (sync git ops, SQLite pragmas, config caching) still open.

**Date**: 2026-03-16
**Scope**: Process-level bottlenecks in Electron main process, IPC, child processes, SQLite, fs watchers, memory, GPU/rendering
**Electron version**: 39.2.6 (Chromium ~134, no known perf regressions for this major)

---

## 1. Main Process Blocking — Synchronous I/O

### CRITICAL: `git.ts` — All git operations use `execFileSync`/`spawnSync`

**File**: `src/main/git.ts`

Every git operation blocks the main thread:

| Function        | Call                                             | Line   |
| --------------- | ------------------------------------------------ | ------ |
| `gitStatus()`   | `execFileSync('git', ['status', '--porcelain'])` | :26    |
| `gitDiffFile()` | `execFileSync('git', ['diff', ...])` × 2 calls   | :58-59 |
| `gitStage()`    | `execFileSync('git', ['add', ...])`              | :68    |
| `gitUnstage()`  | `execFileSync('git', ['reset', 'HEAD', ...])`    | :73    |
| `gitCommit()`   | `execFileSync('git', ['commit', ...])`           | :77    |
| `gitPush()`     | `spawnSync('git', ['push'])`                     | :81    |
| `gitBranches()` | `execFileSync('git', ['branch'])`                | :95    |
| `gitCheckout()` | `execFileSync('git', ['checkout', ...])`         | :115   |

**Impact**: `git push` and `git diff` on large repos can take 2-10+ seconds. During this time, **all IPC channels are frozen** — the renderer cannot get responses to any `ipcMain.handle` call. The UI freezes completely.

`gitDiffFile()` is the worst offender: it runs **two** sequential `execFileSync` calls (unstaged + staged diff), doubling the blockage.

**Fix**: Convert to `execFile` (async) or `spawn` with promise wrappers. The `execFileAsync` pattern already exists in `local-agents.ts` — use the same approach:

```ts
const execFileAsync = promisify(execFile)

export async function gitStatus(cwd: string): Promise<{ files: GitFileStatus[] }> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  })
  // ... parse stdout
}
```

### MODERATE: `config.ts` — `readFileSync` on every config read

**File**: `src/main/config.ts`

- `getGatewayConfig()` (line :64) — reads `~/.openclaw/openclaw.json` synchronously
- `getGitHubToken()` (line :37) — reads same file synchronously
- `getSupabaseConfig()` (line :20) — reads same file synchronously
- `saveGatewayConfig()` (line :50-57) — reads then writes synchronously

These are called from IPC handlers, but `getGatewayConfig()` is also called from `gateway-handlers.ts` on every `gateway:invoke` and `gateway:getSessionHistory` call — which happen every 1-10 seconds via polling.

**Fix**: Cache config in memory (already done for `gatewayConfig` in `config-handlers.ts:5`). Extend caching to `getGitHubToken()` and `getSupabaseConfig()`. The config file changes rarely — a 60-second TTL cache or fs.watch-based invalidation would eliminate all sync reads from hot paths.

### LOW: `db.ts` — `mkdirSync` on init (one-time)

**File**: `src/main/db.ts:13` — `mkdirSync(DB_DIR, { recursive: true })` is only called once at startup. Acceptable.

### LOW: `sprint.ts` — `readFileSync` in migration (one-time)

**File**: `src/main/handlers/sprint.ts:41` — Supabase migration reads `.env` once. Non-blocking in practice.

---

## 2. IPC Channel Saturation

### Channel Count: 37 registered handlers

| Module            | Channels                                                                                                                                                                               | Count |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| agent-handlers    | `local:getAgentProcesses`, `local:spawnClaudeAgent`, `local:tailAgentLog`, `local:sendToAgent`, `local:isInteractive`, `agent:steer`, `agents:list`, `agents:readLog`, `agents:import` | 9     |
| git-handlers      | `get-repo-paths`, `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:branches`, `git:checkout`, `poll-pr-statuses`                                   | 10    |
| sprint            | `sprint:list`, `sprint:create`, `sprint:update`, `sprint:delete`, `sprint:read-spec-file`, `sprint:readLog`                                                                            | 6     |
| config-handlers   | `get-gateway-config`, `get-github-token`, `save-gateway-config`, `get-supabase-config`                                                                                                 | 4     |
| gateway-handlers  | `gateway:invoke`, `gateway:getSessionHistory`                                                                                                                                          | 2     |
| terminal-handlers | `terminal:create`, `terminal:resize`, `terminal:kill` + `ipcMain.on('terminal:write')`                                                                                                 | 4     |
| window-handlers   | `open-external`, `kill-local-agent` + `ipcMain.on('set-title')`                                                                                                                        | 3     |
| fs                | `list-memory-files`, `read-memory-file`, `write-memory-file`, `open-file-dialog`, `read-file-as-base64`, `read-file-as-text`                                                           | 6     |

37 channels is not inherently problematic, but the **polling frequency** creates saturation risk.

### HIGH: Polling storm — worst-case concurrent load

When a user has the Sessions view open with an active agent, the renderer fires these timers **simultaneously**:

| Poll target               | Interval | IPC channel               | Blocks main?                             |
| ------------------------- | -------- | ------------------------- | ---------------------------------------- |
| Agent processes (ps scan) | 5s       | `local:getAgentProcesses` | No (async execFile)                      |
| Agent history             | 10s      | `agents:list`             | Yes (sync SQLite)                        |
| Session list              | 10s      | `gateway:invoke`          | No (async fetch)                         |
| Chat history (streaming)  | 1s       | `gateway:invoke`          | No (async fetch)                         |
| Log tail                  | 1s       | `local:tailAgentLog`      | No (async readFile)                      |
| Log poller (store)        | 1s       | `agents:readLog`          | Yes (sync SQLite query + async readFile) |

**Worst case at a single 1-second tick**: Up to 3 IPC calls fire simultaneously (chat history + log tail + log poller), and every 5 seconds an additional `ps -eo` scan fires. Every 10 seconds, two more polls overlap.

**No backpressure**: None of the polling intervals check if the previous poll completed before starting a new one. If `local:getAgentProcesses` takes >5 seconds (possible with many processes + lsof lookups), polls stack up. The `setInterval` pattern fires unconditionally.

**Fix**: Replace `setInterval` with recursive `setTimeout` that only schedules the next poll after the current one completes:

```ts
function pollLoop(fn: () => Promise<void>, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const tick = async () => {
    if (stopped) return
    await fn().catch(() => {})
    if (!stopped) timer = setTimeout(tick, ms)
  }
  tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
```

ChatThread already uses this pattern correctly (recursive setTimeout). Apply it everywhere.

---

## 3. Child Process Management

### Agent Spawning (`local-agents.ts`)

**Good practices already in place**:

- `child.unref()` — won't keep Electron alive
- `detached: true` — agent survives if BDE quits
- Tracked in `activeAgentProcesses` Map and cleaned up on exit
- Reconcile stale agents every 30 seconds via `maybeReconcileStaleAgents()`

### MODERATE: `getAgentProcesses()` spawns `ps` + N × `lsof` every 5 seconds

**File**: `src/main/local-agents.ts:183-196`

Each call to `getAgentProcesses()`:

1. Runs `ps -eo pid,%cpu,rss,etime,args` — scans entire process table
2. For each matching agent process, runs `lsof -p <pid> -a -d cwd -F n` to get CWD

With 5 running agents, that's 1 ps + 5 lsof = **6 child processes spawned every 5 seconds**.

The CWD cache (`cwdCache`) mitigates repeated lsof calls for known PIDs, but new agents always trigger lsof.

**Fix**:

- The ps scan is unavoidable, but consider `proc_pidinfo` via native addon for macOS (eliminates lsof entirely)
- Increase `POLL_PROCESSES_INTERVAL` to 10s when no agents are running
- Batch lsof calls: `lsof -p pid1,pid2,pid3` in a single invocation

### MODERATE: stdout/stderr buffering for spawned agents

**File**: `src/main/local-agents.ts:257-262`

```ts
child.stdout?.on('data', (chunk: Buffer) => {
  appendAgentLog(id, chunk.toString())
})
```

`appendAgentLog()` does:

1. Sync SQLite query to get `log_path` (`agent-history.ts:158`)
2. Async `appendFile()` to disk

The SQLite query runs on every chunk. For a verbose Claude session streaming JSON, this could be 10-50 chunks/second. Each triggers a synchronous SQLite `SELECT`.

**Fix**: Cache the `log_path` at spawn time (it's immutable) and pass it directly to `appendFile`:

```ts
const logPath = meta.logPath
child.stdout?.on('data', (chunk: Buffer) => {
  appendFile(logPath, chunk.toString(), 'utf-8').catch(() => {})
})
```

### No zombie risk

Agents are `detached: true` and tracked. The `exit` handler cleans up maps. `reconcileStaleAgents()` catches any that die without triggering the handler. No zombie concern.

---

## 4. SQLite Concurrency

### WAL mode: ENABLED ✓

**File**: `src/main/db.ts:15` — `_db.pragma('journal_mode = WAL')` is set on init. Good.

### MODERATE: Missing performance pragmas

The following pragmas would improve throughput with no downside for an embedded single-process database:

```ts
_db.pragma('synchronous = NORMAL') // WAL + NORMAL is safe and 2-3× faster than FULL
_db.pragma('cache_size = -8000') // 8MB page cache (default is 2MB)
_db.pragma('busy_timeout = 5000') // Wait 5s on lock contention instead of failing
_db.pragma('temp_store = MEMORY') // Temp tables in RAM
```

Currently only `journal_mode = WAL` and `foreign_keys = ON` are set.

### All SQLite writes happen on the main thread

better-sqlite3 is synchronous by design. Every `db.prepare(...).run()` blocks the main thread. Key write paths:

- `sprint:update` — on every Kanban drag, column change, or status transition
- `updateAgentMeta()` — on every agent stdout chunk (via log path lookup, see §3)
- `markTaskDoneOnMerge()` — in git.ts PR polling path

For the current data volume (~100-500 rows), this is acceptable. If agent_runs grows to thousands of rows, consider offloading writes to a worker thread using `worker_threads` with a dedicated better-sqlite3 connection.

### No long-running transactions detected

All transactions are short (`agent-history.ts:83` migration, `agent-history.ts:277` pruning). No open cursors or unbounded iteration. Good.

---

## 5. File System Watchers

### Total watchers: 2 (minimal)

**File**: `src/main/index.ts:19-47`

Only two `fs.watch()` instances:

1. `~/.bde/bde.db` — the SQLite database file
2. `~/.bde/bde.db-wal` — the WAL file

Both fire a debounced (500ms) `sprint:external-change` event to the renderer. This is a clean, efficient implementation. No watching of large directories.

**No chokidar dependency** — uses native `fs.watch`, which is appropriate for watching 2 specific files.

---

## 6. Memory Pressure

### MODERATE: Log content accumulated in renderer memory

**File**: `src/renderer/src/lib/logPoller.ts`

The log poller accumulates log content in a Zustand store string, trimmed to `MAX_LOG_LINES = 2000` lines. At ~200 bytes/line average, that's ~400KB per active log viewer. With multiple agent log viewers open, this could reach a few MB.

The trim logic (lines 29-34) is correct — excess lines are sliced from the front. Memory pressure here is bounded.

### MODERATE: `tailAgentLog` and `readLog` read entire files

**File**: `src/main/local-agents.ts:320-330`

```ts
const buf = await readFile(safePath)
const slice = buf.subarray(fromByte)
```

This reads the **entire log file** into memory, then slices. For a 50MB agent log, this allocates 50MB on every tail poll (every 1 second).

Same pattern in `agent-history.ts:171` (`readLog`) and `sprint.ts:188` (`sprint:readLog`).

**Fix**: Use `fs.open()` + `fileHandle.read()` with a positioned read to only read new bytes:

```ts
import { open } from 'fs/promises'

export async function tailAgentLog(args: TailLogArgs): Promise<TailLogResult> {
  const safePath = validateLogPath(args.logPath)
  const fromByte = args.fromByte ?? 0
  try {
    const fh = await open(safePath, 'r')
    const stats = await fh.stat()
    const size = stats.size
    if (fromByte >= size) {
      await fh.close()
      return { content: '', nextByte: fromByte }
    }
    const buf = Buffer.alloc(size - fromByte)
    await fh.read(buf, 0, buf.length, fromByte)
    await fh.close()
    return { content: buf.toString('utf-8'), nextByte: size }
  } catch {
    return { content: '', nextByte: fromByte }
  }
}
```

### Log cleanup is adequate

- `cleanupOldLogs()` removes files >7 days old from `/tmp/bde-agents/` at startup
- `pruneOldAgents(500)` caps SQLite rows and deletes corresponding log directories
- No unbounded accumulation detected

### Worktree cleanup: N/A

No git worktree management in the codebase — agents operate on existing repo paths.

---

## 7. GPU / Rendering Process

### No Electron GPU flags configured

No `app.commandLine.appendSwitch()` calls anywhere. Electron defaults are in effect — hardware acceleration is **enabled** by default, which is correct.

### HIGH: Excessive backdrop-filter usage (65+ instances)

Backdrop filters are the single most expensive CSS property in Chromium. They force the compositor to:

1. Rasterize everything behind the element
2. Apply a gaussian blur kernel
3. Composite the result

Found in every major view's stylesheet:

- `design-system.css` — glass panel classes (blur-sm through blur-xl + saturate)
- `sessions.css` — 5 instances
- `sprint.css` — 7 instances
- `terminal.css` — 2 instances
- `cost.css`, `memory.css`, `settings.css` — 2 each

**Impact**: Every scroll, resize, or animation that intersects a backdrop-filter element triggers a full re-rasterize of the layers behind it. This is the most likely cause of perceived UI lag during normal interaction.

**Fix**:

- Replace `backdrop-filter: blur(N) saturate(120%)` with solid semi-transparent backgrounds: `background: rgba(10, 10, 10, 0.85)` for a similar dark glass look without GPU cost
- If blur aesthetic is essential, limit to modals only (not panels, cards, or list items)
- Remove the `-webkit-backdrop-filter` prefix — Electron 39 doesn't need it

### MODERATE: Framer Motion stagger on large lists

**File**: `src/renderer/src/lib/motion.ts:77-85`

```ts
staggerContainer: {
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
}
```

Applied to AgentList (up to 20 items) and potentially Kanban columns (up to 50 cards). With 20 items: `60ms delay + 20 × 40ms = 860ms` of cascading animation. During this time, each child triggers layout, paint, and composite passes.

**Fix**:

- Remove stagger from lists >10 items — fade the container instead
- Already implements `useReducedMotion()` correctly, but stagger should be opt-out for large lists regardless

### MODERATE: `AnimatePresence mode="wait"` blocks view transitions

**File**: `src/renderer/src/App.tsx:87`

`mode="wait"` means the exit animation must complete before the enter animation begins. This adds ~200ms of perceived latency on every view switch.

**Fix**: Switch to `mode="popLayout"` or remove the mode entirely for instant transitions.

### LOW: Layout animations on every Kanban card

**File**: `src/renderer/src/components/sprint/KanbanColumn.tsx:66-80`

Every task card has `layoutId={task.id}` for cross-column drag animations. With 50+ cards, Framer Motion measures layout for all of them on every render. Acceptable if `reduced` motion flag disables it (which it does), but heavy for users with animations enabled.

---

## 8. Electron Version and Config

### Electron 39.2.6 — current stable

- Chromium ~134, Node 22
- No known performance regressions for this version
- `electron-vite` 5.0 is current

### Missing quick wins in Electron config

**`electron.vite.config.ts`**: No production optimizations configured.

**BrowserWindow config** (`src/main/index.ts:51-66`):

- `backgroundColor: '#0A0A0A'` — good, prevents white flash
- `sandbox: false` — required for preload with node-pty, but noted

**Missing**:

- No `v8-cache` or `code-cache` flags
- No `webPreferences.backgroundThrottling` consideration (defaults to true, which is correct)

---

## Summary: Prioritized Fix List

### P0 — Immediate Impact (fix this week)

| #   | Issue                                     | File                                          | Fix                                                               | Effort  |
| --- | ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | ------- |
| 1   | **Sync git operations block main thread** | `src/main/git.ts`                             | Convert `execFileSync` → `execFileAsync` for all functions        | 1-2 hrs |
| 2   | **Backdrop-filter on 65+ elements**       | `*.css`                                       | Replace with solid `rgba()` backgrounds; keep blur only on modals | 2-3 hrs |
| 3   | **Log tail reads entire file**            | `local-agents.ts:324`, `agent-history.ts:171` | Use positioned `fh.read()` instead of `readFile()`                | 30 min  |

### P1 — Important (fix this sprint)

| #   | Issue                                              | File                       | Fix                                                               | Effort |
| --- | -------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- | ------ |
| 4   | **No polling backpressure**                        | All renderer polling code  | Replace `setInterval` with recursive `setTimeout` pattern         | 1 hr   |
| 5   | **SQLite query on every agent stdout chunk**       | `agent-history.ts:156-161` | Cache log_path at spawn time, pass directly                       | 15 min |
| 6   | **Missing SQLite pragmas**                         | `src/main/db.ts`           | Add `synchronous=NORMAL`, `cache_size=-8000`, `busy_timeout=5000` | 5 min  |
| 7   | **Config re-read from disk on every gateway call** | `src/main/config.ts`       | Cache `getGitHubToken()` and `getSupabaseConfig()` results        | 30 min |

### P2 — Nice to Have

| #   | Issue                                            | File                         | Fix                                       | Effort  |
| --- | ------------------------------------------------ | ---------------------------- | ----------------------------------------- | ------- |
| 8   | AnimatePresence `mode="wait"` blocks transitions | `App.tsx:87`                 | Switch to `mode="popLayout"`              | 5 min   |
| 9   | Stagger animations on 20-item lists              | `motion.ts`, `AgentList.tsx` | Disable stagger when list > 10 items      | 30 min  |
| 10  | 6 child processes every 5s for agent scan        | `local-agents.ts`            | Batch lsof, increase interval when idle   | 1 hr    |
| 11  | ChatThread renders all 100 messages              | `ChatThread.tsx`             | Virtualize with `react-window` or similar | 2-3 hrs |

### Quick Config Wins (5 minutes total)

```ts
// src/main/db.ts — after WAL pragma
_db.pragma('synchronous = NORMAL')
_db.pragma('cache_size = -8000')
_db.pragma('busy_timeout = 5000')
_db.pragma('temp_store = MEMORY')
```

---

## Appendix: IPC Call Frequency Map

```
1s   ███████████  chat history (streaming), log tail, log poller
5s   ██████       agent processes (ps+lsof), sprint list (active)
10s  ████         session list, agent history
30s  ██           git status, sprint list (idle)
60s  █            PR status poll, PR list
```

Peak concurrent IPC calls at any given second: **3-5** (when streaming + log viewing + process polling overlap).
