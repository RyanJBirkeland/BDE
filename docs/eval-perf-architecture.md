# BDE Performance Architecture Evaluation

> **Status: PRE-FIX AUDIT (2026-03-16)**
> This document was written before several performance fixes shipped. Key changes since:
>
> - Issue #1 (polling storm): Sprint polling is now gated on `activeView`.
> - Issue #5 (Supabase polling): Supabase removed entirely. Sprint data is local SQLite. The `sprint:external-change` file watcher push replaces remote polling.
> - PR status polling: Now 60s via GitHub REST API (was 15s via `gh` CLI).

**Date:** 2026-03-16
**Scope:** React rendering, IPC overhead, polling, SQLite, bundle, memory leaks, Electron specifics

---

## Top 5 Performance Issues (ranked by user-perceived impact)

### 1. CRITICAL — Polling Storm: Up to 11 concurrent setInterval timers in the renderer

**Impact:** Every view sets up its own polling timers, and many run _even when the view is not visible_. At worst, the renderer is firing 11+ independent timers simultaneously:

| Timer                         | Interval  | Location                      | Runs when hidden?                                     |
| ----------------------------- | --------- | ----------------------------- | ----------------------------------------------------- |
| `fetchSessions`               | 10s       | `SessionsView.tsx:48`         | **YES** — SessionsView stays mounted (never unmounts) |
| `fetchProcesses` (`ps aux`)   | 5s        | `AgentList.tsx:45`            | **YES** — child of always-mounted SessionsView        |
| `fetchAgents` (history)       | 10s       | `AgentList.tsx:46`            | **YES** — child of always-mounted SessionsView        |
| `ChatThread` poll             | 1s or 5s  | `ChatThread.tsx:146`          | **YES** — per-pane, up to 4 in grid-4 mode            |
| `logPoller` (agent logs)      | 1s        | `logPoller.ts:48`             | YES — if an agent is selected                         |
| Sprint tasks                  | 5s or 30s | `SprintCenter.tsx:61`         | No — on-demand                                        |
| PR status poll                | 60s       | `SprintCenter.tsx:92`         | No — on-demand                                        |
| PR list poll                  | 60s       | `PRList.tsx:39`               | No — on-demand                                        |
| Git status poll               | 30s       | `DiffView.tsx:106`            | No — on-demand                                        |
| Task notifications (Supabase) | 30s       | `useTaskNotifications.ts:93`  | **YES** — always mounted in App                       |
| `LocalAgentLogViewer` tick    | 1s        | `LocalAgentLogViewer.tsx:115` | YES — `setTick(t => t+1)` just to update elapsed time |

**Worst case:** SessionsView + 4x ChatThread in grid-4 mode = **5 timers firing every 1s**, plus `fetchProcesses` spawning `ps` + `lsof` every 5s, plus Supabase polling every 30s.

**Fix:**

```typescript
// SessionsView.tsx — only poll when visible
const activeView = useUIStore((s) => s.activeView)
useEffect(() => {
  if (activeView !== 'sessions') return // <-- add this guard
  fetchSessions()
  const id = setInterval(fetchSessions, POLL_SESSIONS_INTERVAL)
  return () => clearInterval(id)
}, [fetchSessions, activeView]) // <-- add activeView dep
```

Apply the same pattern to `AgentList.tsx:42-51` (fetchProcesses + fetchAgents), and `useTaskNotifications.ts:93`.

For `LocalAgentLogViewer.tsx:115`, replace the `setTick` forced re-render with a `timeAgo` that's pure (no timer), or use `requestAnimationFrame` debounced at 1fps.

**Effort:** Quick win — 1-2 hours

---

### 2. HIGH — `getAgentProcesses()` shells out `ps` + `lsof` every 5s on the main thread

**Impact:** Every 5 seconds (via `AgentList.tsx:45`), the renderer calls `window.api.getAgentProcesses()`, which triggers IPC → main process → `local-agents.ts:180-193`:

1. `execFileAsync('ps', ['-eo', 'pid,%cpu,rss,etime,args'])` — scans all system processes
2. For each matched agent PID: `execFileAsync('lsof', ['-p', pid, '-a', '-d', 'cwd', '-F', 'n'])` — one `lsof` per agent

With 5 agent processes, that's **6 child process spawns every 5 seconds**. The `ps` output can be 100KB+ and needs regex parsing on every line.

The CWD cache (`cwdCache` at `local-agents.ts:49`) helps, but `ps` still runs every time.

**Fix:**

- **Cache the full `ps` result** with a TTL of 5s at the module level. If the IPC handler is called within the TTL, return the cached result.
- **Increase the poll interval** from 5s to 15s (process list doesn't change that fast).
- **Gate on visibility:** Only poll when SessionsView is active (see issue #1).

```typescript
// local-agents.ts — add result caching
let _cachedResult: LocalAgentProcess[] = []
let _cachedAt = 0
const CACHE_TTL = 5_000

export async function getAgentProcesses(): Promise<LocalAgentProcess[]> {
  if (Date.now() - _cachedAt < CACHE_TTL) return _cachedResult
  try {
    const candidates = await scanAgentProcesses()
    const results = await resolveProcessDetails(candidates)
    _cachedResult = results
    _cachedAt = Date.now()
    // ...rest stays same
    return results
  } catch {
    return _cachedResult
  }
}
```

**Effort:** Quick win — 30 minutes

---

### 3. HIGH — `fetchSessions()` triggers 2 redundant RPC round-trips per call, multiplied across views

**Impact:** `sessions.ts:82-91` does `Promise.allSettled([invokeTool('sessions_list'), invokeTool('subagents', ...)])` every 10s. Each `invokeTool` follows this path:

```
Renderer → IPC (ipcRenderer.invoke) → Main process (gateway-handlers.ts:6-16) → HTTP POST to gateway → JSON parse → IPC response → Renderer
```

That's **2 HTTP POSTs to the gateway + 2 IPC round-trips every 10 seconds**, even when the user is on DiffView or SprintView.

Additionally, `CostView.tsx:339` independently calls `invokeTool('sessions_list')` on its own 30s timer, duplicating the sessions_list call.

**Fix:**

- **Deduplicate:** Make `fetchSessions()` the single source of truth for session data. CostView should subscribe to `useSessionsStore((s) => s.sessions)` instead of fetching independently.
- **Debounce gateway RPC:** Add a per-tool-name deduplication layer in `rpc.ts` that coalesces identical calls within 1s:

```typescript
// rpc.ts — deduplicate in-flight calls
const inflight = new Map<string, Promise<unknown>>()

export async function invokeTool(tool: string, args = {}): Promise<unknown> {
  const key = `${tool}:${JSON.stringify(args)}`
  const existing = inflight.get(key)
  if (existing) return existing

  const promise = window.api
    .invokeTool(tool, args)
    .then(parse)
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, promise)
  return promise
}
```

- **Don't poll when hidden** (issue #1 again).

**Effort:** Medium — 2-3 hours for dedup + CostView refactor

---

### 4. MEDIUM — Synchronous `execFileSync` git operations block the main process

**Impact:** All git operations in `git.ts` use `execFileSync`:

- `gitStatus` (line 25): `execFileSync('git', ['status', '--porcelain'])`
- `gitDiffFile` (line 53-59): **Two** sequential `execFileSync` calls (unstaged + staged)
- `gitBranches` (line 94): `execFileSync('git', ['branch'])`
- `gitCommit` (line 76): `execFileSync('git', ['commit', ...])`
- `gitPush` (line 80): `spawnSync('git', ['push'])` — can take 10+ seconds!

While DiffView polls every 30s (reasonable), any `gitDiffFile` or `gitPush` call **blocks the entire main process** — no IPC handlers can respond, no window events fire, the app freezes. `gitPush` in particular can hang for 10+ seconds on large repos or slow connections.

**Fix:** Convert all git operations to async using `execFile` (already imported as `execFileAsync` in local-agents.ts):

```typescript
// git.ts
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

export async function gitStatus(cwd: string): Promise<{ files: GitFileStatus[] }> {
  const { stdout: raw } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  })
  // ...rest unchanged
}
```

**Effort:** Medium — 2-3 hours (touch every git function + update handler signatures)

---

### 5. MEDIUM — `useTaskNotifications` fetches from Supabase every 30s with hardcoded credentials

**Impact:** `useTaskNotifications.ts:56-94` contains hardcoded Supabase credentials and fires a `fetch()` to an external API every 30s — **from the renderer process** — regardless of view. This is:

1. **A performance issue:** Network requests from the renderer every 30s, parsing JSON, running in the React lifecycle
2. **A security issue:** Supabase anon key is hardcoded in client-side source (line 7)
3. **Redundant:** Sprint tasks are now in local SQLite, but this hook still hits Supabase

**Fix:** Delete the Supabase fetch entirely. Replace with a listener on the local sprint DB changes, which already exist (`sprint:external-change` in `index.ts:28`):

```typescript
// useTaskNotifications.ts — replace Supabase polling with local DB events
useEffect(() => {
  const handler = () => {
    // Check for newly-completed tasks from local DB
    window.api.sprint.list().then((tasks) => {
      for (const task of tasks) {
        if (task.status === 'done' && !seenDoneIds.current.has(task.id)) {
          seenDoneIds.current.add(task.id)
          notify('Agent task done', `Task "${task.title}" completed`)
        }
      }
    })
  }
  window.api.onExternalSprintChange(handler)
  return () => window.api.offExternalSprintChange(handler)
}, [])
```

**Effort:** Quick win — 30 minutes

---

## Additional Issues (Lower Priority)

### 6. SessionsView and TerminalView are always mounted

`App.tsx:80-85` keeps SessionsView and TerminalView permanently in the DOM with `display: none`. This means:

- Their `useEffect` hooks (polling timers) run even when invisible
- Their child components (AgentList, ChatThread, ChatPane) stay mounted with their own timers

This is intentional (preserving PTY state and chat state), but the polling timers inside these always-mounted views should be visibility-gated.

**Fix:** Use `document.visibilityState` or the `activeView` store to pause all polling when the view is hidden. The view components remain mounted but their timers pause.

### 7. ChatThread renders markdown on every poll cycle

`ChatThread.tsx:92-95` compares the last message's content string on every poll. When content changes (streaming), it calls `setMessages([...incoming])` which re-renders the entire message list. Each `renderContent()` call in `markdown.tsx` runs regex parsing.

**Fix:** Memoize individual message rendering with `React.memo` on message items, keyed by content hash. Only re-render the last message during streaming:

```tsx
const MemoizedMessage = React.memo(
  ({ msg }: { msg: ChatMessage }) => (
    <div className={`chat-msg chat-msg--${msg.role}`}>
      <span className="chat-msg__text">{renderContent(msg.content)}</span>
    </div>
  ),
  (prev, next) => prev.msg.content === next.msg.content
)
```

### 8. `getGatewayConfig()` reads config file synchronously on every RPC call

`gateway-handlers.ts:7` calls `getGatewayConfig()` on every `gateway:invoke` IPC call. `config.ts:60` does `readFileSync(configPath)` + `JSON.parse()` each time. With sessions polling every 10s (2 calls) + chat polling every 1-5s, that's ~5-10 synchronous file reads/second.

**Fix:** Cache the config at module scope with a 60s TTL:

```typescript
let _cachedConfig: GatewayConfig | null = null
let _cachedAt = 0
export function getGatewayConfig(): GatewayConfig {
  if (_cachedConfig && Date.now() - _cachedAt < 60_000) return _cachedConfig
  // ...existing logic
  _cachedConfig = { url, token }
  _cachedAt = Date.now()
  return _cachedConfig
}
```

### 9. `AgentRow` creates a new DOM element via `document.createElement` on every right-click

`AgentRow.tsx:83-110` builds a custom context menu by appending raw DOM elements — no React portal, no cleanup guarantee. The `setTimeout(() => document.addEventListener(...))` pattern can leak listeners if the component unmounts during the timeout.

**Fix:** Use a React state-driven context menu component instead of direct DOM manipulation.

### 10. No `React.memo` on any list item components

`AgentRow`, `TaskCard`, `ChatThread` message items — none of these are memoized. Every time the parent list re-renders (on poll), every row re-renders too, even if its data hasn't changed. With 20+ agents and 100+ chat messages, this adds up.

---

## Quick Wins (< 1 hour each)

| Fix                                                                | Files                               | Time |
| ------------------------------------------------------------------ | ----------------------------------- | ---- |
| Gate SessionsView polling on `activeView`                          | `SessionsView.tsx`, `AgentList.tsx` | 30m  |
| Cache `getAgentProcesses()` with 5s TTL                            | `local-agents.ts`                   | 30m  |
| Delete Supabase fetch in `useTaskNotifications.ts`                 | `useTaskNotifications.ts`           | 30m  |
| Cache `getGatewayConfig()` with 60s TTL                            | `config.ts`                         | 15m  |
| Remove `setTick` forced re-render in `LocalAgentLogViewer.tsx:115` | `LocalAgentLogViewer.tsx`           | 15m  |
| Increase `POLL_PROCESSES_INTERVAL` from 5s to 15s                  | `constants.ts` (or `AgentList.tsx`) | 5m   |

## Bigger Refactors (> 1 hour)

| Fix                                                             | Files                                       | Time |
| --------------------------------------------------------------- | ------------------------------------------- | ---- |
| Convert all `execFileSync` git ops to async                     | `git.ts`, `git-handlers.ts`, `DiffView.tsx` | 2-3h |
| Deduplicate `sessions_list` RPC across stores/views             | `rpc.ts`, `CostView.tsx`, `sessions.ts`     | 2-3h |
| Add `React.memo` to `AgentRow`, `TaskCard`, message items       | Multiple components                         | 2-3h |
| Replace per-ChatThread polling with WebSocket push from gateway | `ChatThread.tsx`, `gateway.ts`              | 4-6h |
| Consolidate all polling into a single "data sync" layer         | New `lib/sync.ts`, all stores               | 6-8h |

---

## Summary

The root cause of the laggy feel is **excessive concurrent polling**. The app runs 11+ independent `setInterval` timers, many of which fire even when their views are hidden. The most impactful fix is visibility-gating all polling timers — this alone would eliminate ~70% of unnecessary IPC traffic and main-process work. Combined with caching `ps`/`lsof` results and deduplicating RPC calls, the app should feel dramatically more responsive with ~4 hours of targeted work.
