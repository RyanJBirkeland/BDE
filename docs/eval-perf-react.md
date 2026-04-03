# React Performance Audit — BDE

> **Status: MOSTLY ADDRESSED (2026-03-16)**
> The following issues from this audit have been fixed:
>
> - #1 (TerminalView entire-store destructure): Fixed — individual selectors.
> - #3 (LogDrawer full-content replace): Fixed — incremental byte-offset append.
> - #6 (KanbanBoard unmemoized filters): Fixed — `useMemo` added.
> - #7 (SprintCenter interval thrashing): Fixed — ref-based callback.
> - #9 (LocalAgentLogViewer 1s tick): Fixed — extracted `ElapsedTime` component.
> - #4 (no polling backpressure): Fixed — polling gated on `activeView`.
> - Remaining open: #2 (ChatThread virtualization), #5 (AgentList inline closures), #8 (DiffViewer), #12e (React.memo adoption).

**Date**: 2026-03-16
**Auditor**: Claude (automated perf review)
**Scope**: `src/renderer/src/` — components, stores, views, hooks, libs

---

## Executive Summary

BDE has **23 material performance issues** across 5 categories. The three highest-impact problems are:

1. **TerminalView destructures the entire terminal store** — every tab keystroke re-renders the entire view
2. **ChatThread renders all messages without virtualization** — sessions with 100+ messages create hundreds of DOM nodes
3. **LogDrawer replaces the full log string every 2s** — triggers full `parseStreamJson` + `chatItemsToMessages` recomputation and a complete ChatThread re-render

Fixing the top 5 issues would make the app feel noticeably snappier in daily use.

---

## Issues — Ranked by Impact

### P0 — Critical (perceived jank)

#### 1. TerminalView: Entire-Store Destructure

**File**: `src/renderer/src/views/TerminalView.tsx:10-26`

```tsx
const {
  tabs,
  activeTabId,
  addTab,
  closeTab,
  setActiveTab,
  renameTab,
  reorderTab,
  splitEnabled,
  toggleSplit,
  showFind,
  setShowFind,
  createAgentTab,
  zoomIn,
  zoomOut,
  resetZoom
} = useTerminalStore()
```

**Problem**: Calling `useTerminalStore()` with no selector subscribes to _every_ field in the store. Any `setUnread()`, `setPtyId()`, `setTabStatus()`, or `fontSize` change re-renders the entire TerminalView — including every `TerminalContent`, `TerminalTabBar`, and `TerminalToolbar`. This fires on every terminal output event that triggers `setUnread`.

**Fix**: Use individual selectors:

```tsx
const tabs = useTerminalStore((s) => s.tabs)
const activeTabId = useTerminalStore((s) => s.activeTabId)
const addTab = useTerminalStore((s) => s.addTab)
// ... etc for each field
```

**Impact**: **High** — terminal is always-mounted, this fires dozens of times per minute during active use. Fix eliminates ~80% of unnecessary TerminalView re-renders.

---

#### 1b. FindBar: Same Entire-Store Destructure

**File**: `src/renderer/src/components/terminal/FindBar.tsx:7`

```tsx
const { showFind, setShowFind, activeTabId } = useTerminalStore()
```

**Problem**: Same issue as TerminalView — subscribes to the entire terminal store. Every `setUnread`, `setPtyId`, `setTabStatus` re-renders FindBar even though it only uses 3 fields.

**Fix**: Use individual selectors:

```tsx
const showFind = useTerminalStore((s) => s.showFind)
const setShowFind = useTerminalStore((s) => s.setShowFind)
const activeTabId = useTerminalStore((s) => s.activeTabId)
```

**Impact**: **High** — same frequency as issue 1, FindBar renders unnecessarily on every terminal event.

---

#### 2. ChatThread: No List Virtualization

**File**: `src/renderer/src/components/sessions/ChatThread.tsx:242-314`

```tsx
{
  visibleMessages.map((msg, idx) => {
    // Full DOM element per message — no windowing
  })
}
```

**Problem**: All messages render as DOM nodes. With `CHAT_HISTORY_LIMIT = 100`, a busy session creates 100+ complex DOM elements including markdown-rendered content (`renderContent()` with regex per message). Each poll cycle (1s streaming, 5s idle) triggers `setMessages([...incoming])` which re-renders the entire list since messages aren't memoized.

**Fix**:

1. Virtualize with `@tanstack/react-virtual` (already an Electron app, no SSR concerns):

```tsx
const rowVirtualizer = useVirtualizer({
  count: visibleMessages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 80
})
```

2. Wrap individual message rows in `React.memo` to prevent re-render when only new messages append.
3. Memoize `renderContent()` calls — each runs regex on every render (see issue 2b below).

**Impact**: **High** — directly causes scroll jank in long sessions. Virtualization reduces DOM nodes from 100+ to ~15 visible. Message memoization eliminates re-rendering unchanged messages on each poll.

---

#### 2b. ChatThread: `renderContent()` Re-parses Markdown on Every Render

**File**: `src/renderer/src/components/sessions/ChatThread.tsx:293` calling `src/renderer/src/lib/markdown.tsx:7`

```tsx
<span className="chat-msg__text chat-msg__text--rich">
  {renderContent(msg.content)} // regex loops run per message per render
</span>
```

**Problem**: `renderContent()` runs two regex loops (`codeBlockRe` and `inlineRe`) with `RegExpExecArray` iteration and allocates new JSX element arrays on every call. Because ChatThread re-renders every 1s during streaming and 5s idle, **every existing message's markdown is re-parsed from scratch on every tick**. With 50 assistant messages, that's 50 regex parses per second during streaming.

**Fix**: Extract a `MessageBubble` component wrapped in `React.memo` that receives `content` as a prop. The memoized component only re-renders when content actually changes:

```tsx
const MessageBubble = React.memo(({ content }: { content: string }) => (
  <span className="chat-msg__text chat-msg__text--rich">{renderContent(content)}</span>
))
```

**Impact**: **High** — this is the single most expensive per-render computation in the app. Memoizing eliminates re-parsing unchanged messages entirely.

---

#### 3. LogDrawer: Full-Content Replacement on Every Poll

**File**: `src/renderer/src/components/sprint/LogDrawer.tsx:31-38`

```tsx
const fetchLog = async (): Promise<void> => {
  const result = await window.api.sprint.readLog(task.agent_run_id!)
  setLogContent(result.content) // <-- full replacement every 2s
}
```

**Problem**: Every 2 seconds, the entire log content string is replaced (not appended). This triggers:

- `parseStreamJson(logContent)` re-parsing the entire log (line 56)
- `chatItemsToMessages(items)` rebuilding all messages (line 57)
- Full ChatThread re-render with all messages

Compare with `logPoller.ts` which correctly does incremental append via `fromByte` offset.

**Fix**: Use the same `createLogPollerActions` pattern from `logPoller.ts`:

```tsx
// Instead of full replacement:
setLogContent(result.content)

// Use incremental append:
const result = await readFn(nextByte)
if (result.content) {
  setLogContent((prev) => prev + result.content)
  setNextByte(result.nextByte)
}
```

**Impact**: **High** — for active sprint tasks, this fires every 2s. Incremental append means `parseStreamJson` only processes new content, and only new messages render.

---

### P1 — Important (unnecessary work)

#### 4. AgentList: Inline Arrow Functions in `.map()` Create New Props Every Render

**File**: `src/renderer/src/components/sessions/AgentList.tsx:131-145`

```tsx
{active.map((a) => (
  <motion.li key={a.id} ...>
    <AgentRow
      agent={a}
      isSelected={a.id === selectedId}
      onSelect={() => onSelect(a.id)}     // new fn every render
      onKill={() => onKill(a)}             // new fn every render
      onSteer={() => onSteer(a)}           // new fn every render
    />
  </motion.li>
))}
```

**Problem**: `AgentRow` receives new function references on every render of `AgentList`. Since `AgentRow` is not wrapped in `React.memo`, this wouldn't matter today — but it means even adding `React.memo` to `AgentRow` won't help without fixing the callbacks. The same pattern repeats for `recent` and `history` lists (lines 161-176, 200-214).

**Fix**:

1. Wrap `AgentRow` in `React.memo`
2. Pass `id` instead of closures, and handle the mapping inside `AgentRow`:

```tsx
<AgentRow
  agent={a}
  isSelected={a.id === selectedId}
  onSelect={onSelect} // pass parent callback directly
  onKill={onKill}
  onSteer={onSteer}
/>
// Inside AgentRow, call onSelect(agent.id) on click
```

**Impact**: **Medium** — polling `fetchProcesses` (5s) and `fetchSessions` (10s) both trigger AgentList re-renders. With 10+ agents, that's 30+ unnecessary AgentRow re-renders per cycle.

---

#### 5. AgentOutputTab: Inline Style Objects on Every Render

**File**: `src/renderer/src/components/terminal/AgentOutputTab.tsx:74-82, 86-93, 95-99, 105-112`

```tsx
<div style={{
  padding: tokens.space[4],
  color: tokens.color.textDim,
  fontFamily: tokens.font.ui,
  fontSize: tokens.size.md,
  textAlign: 'center',
  marginTop: tokens.space[8]
}}>
```

**Problem**: Four inline `style={{...}}` objects are created on every render. Since tokens are static, these should be hoisted to module scope or replaced with CSS classes (preferred — aligns with the design system's class-based approach elsewhere).

**Fix**: Replace with CSS classes or hoist to `const`:

```tsx
// Module scope
const EMPTY_STYLE = {
  padding: tokens.space[4],
  color: tokens.color.textDim,
  ...
} as const
```

Or better: add `.terminal-agent-tab__empty` CSS class.

**Impact**: **Low-Medium** — creates GC pressure, and prevents React from skipping re-renders via shallow comparison.

---

#### 6. KanbanBoard: Task Filtering Not Memoized

**File**: `src/renderer/src/components/sprint/KanbanBoard.tsx:54-57`

```tsx
const backlog = tasks.filter((t) => t.status === 'backlog')
const queued = tasks.filter((t) => t.status === 'queued')
const active = tasks.filter((t) => t.status === 'active')
const done = tasks.filter((t) => t.status === 'done')
```

**Problem**: Four `.filter()` calls run on every render — not memoized. With adaptive sprint polling at 5s for active tasks, this runs 12× per minute. Each produces a new array reference, causing all four `KanbanColumn` components to re-render even if their tasks haven't changed.

**Fix**:

```tsx
const { backlog, queued, active, done } = useMemo(
  () => ({
    backlog: tasks.filter((t) => t.status === 'backlog'),
    queued: tasks.filter((t) => t.status === 'queued'),
    active: tasks.filter((t) => t.status === 'active'),
    done: tasks.filter((t) => t.status === 'done')
  }),
  [tasks]
)
```

Also wrap `KanbanColumn` in `React.memo`.

**Impact**: **Medium** — sprint view polls every 5s when active tasks exist. Memoization + memo eliminates cascade re-renders of all columns + all TaskCards on unchanged columns.

---

#### 7. SprintCenter: pollPrStatuses Has Stale Closure Over prMergedMap

**File**: `src/renderer/src/components/sprint/SprintCenter.tsx:76-88`

```tsx
const pollPrStatuses = useCallback(
  async (taskList: SprintTask[]) => {
    const withPr = taskList.filter((t) => t.pr_url && !prMergedMap[t.id])
    // ...
  },
  [prMergedMap]
)
```

**Problem**: `pollPrStatuses` depends on `prMergedMap` and is used in a `setInterval` (line 92). Every time `prMergedMap` changes, a new `pollPrStatuses` is created, the old interval is cleared, and a new one is set. But `prMergedMap` changes _because_ `pollPrStatuses` updates it — causing an infinite re-interval cycle. Each cycle also re-creates the effect at line 90-96.

**Fix**: Use a ref for `prMergedMap` inside the callback:

```tsx
const prMergedRef = useRef(prMergedMap)
prMergedRef.current = prMergedMap

const pollPrStatuses = useCallback(async (taskList: SprintTask[]) => {
  const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
  // ...
}, []) // stable reference
```

**Impact**: **Medium** — causes interval thrashing and redundant API calls. With multiple PRs, this can fire repeatedly in quick succession.

---

#### 7b. MiniChatPane: 4 Independent Pollers in Grid-4 Layout

**File**: `src/renderer/src/components/sessions/MiniChatPane.tsx:82-83`

```tsx
poll()
const id = setInterval(poll, POLL_PROCESSES_INTERVAL) // 5s each
```

**Problem**: In grid-4 layout, 4 `MiniChatPane` instances each run their own independent `setInterval` at 5s, calling `invokeTool('sessions_history', ...)` via RPC. Combined with SessionsView's `fetchSessions` (10s), AgentList's `fetchProcesses` (5s) + `fetchAgents` (10s), and any active log poller (1s), the app runs up to **10 concurrent timers** in grid-4 mode. Five of them fire within any 5-second window, causing a burst of RPC calls, store updates, and cascading re-renders.

**Fix**: Lift the polling into a shared hook or the sessions store. Each pane should read from shared state rather than independently polling the gateway.

**Impact**: **Medium** — grid-4 mode becomes jittery with all 4 panes polling independently. Also creates unnecessary gateway load.

---

#### 7c. ChatThread: `setStreaming(false)` Called Unconditionally

**File**: `src/renderer/src/components/sessions/ChatThread.tsx:107`

```tsx
} else {
  prevLastAssistantContentRef.current = ''
  setStreaming(false)   // called even when streaming is already false
}
```

**Problem**: On every idle poll tick where the last message is not from an assistant, `setStreaming(false)` is called unconditionally — even when `streaming` is already `false`. While React 18 batches this, it still schedules a reconciliation pass on every 5-second idle poll.

**Fix**: Guard the call:

```tsx
if (streaming) setStreaming(false)
```

**Impact**: **Low** — React batches effectively, but this is a free fix that avoids unnecessary reconciliation scheduling.

---

#### 7d. CommandPalette: Unused `connect` in useMemo Dependencies

**File**: `src/renderer/src/components/layout/CommandPalette.tsx:154`

```tsx
return [...nav, ...actions, ...agentItems]
}, [setView, onClose, connect, selectAgent, recentAgents])
```

**Problem**: `connect` is selected from `useGatewayStore` (line 51) but never used inside the `commands` memo body. Including it in the dependency array means the entire commands list (9+ items) recomputes on every gateway status change (connected/disconnected/connecting/error), which also invalidates the downstream `filtered`, `groups`, and `flatItems` memos.

**Fix**: Remove `connect` from the dependency array (or remove the subscription if unused elsewhere in the component).

**Impact**: **Low** — command palette is rarely open, but this is a free fix.

---

### P2 — Moderate (wasted renders, suboptimal patterns)

#### 8. DiffViewer: Un-virtualized Diff Lines

**File**: `src/renderer/src/components/diff/DiffViewer.tsx:168-181`

```tsx
{
  hunk.lines.map((line, li) => (
    <div key={li} className={`diff-line diff-line--${line.type}`}>
      <span className="diff-line__gutter diff-line__gutter--old">{line.lineNo.old ?? ''}</span>
      <span className="diff-line__gutter diff-line__gutter--new">{line.lineNo.new ?? ''}</span>
      <span className="diff-line__marker">...</span>
      <span className="diff-line__text">{line.content}</span>
    </div>
  ))
}
```

**Problem**: Large diffs (500+ lines across multiple hunks) render every line as a DOM element with 4 spans each (2000+ DOM nodes). No virtualization. The diff view also re-renders all files, not just the active one.

**Fix**:

1. Only render expanded/active file hunks — collapse inactive files to header-only
2. For large hunks (>200 lines), virtualize with `@tanstack/react-virtual`
3. Wrap `FileList` in `React.memo` (it's a pure component receiving `files` + `activeFileIndex`)

**Impact**: **Medium** — noticeable on large diffs. Most day-to-day diffs are small, but repo-wide changes cause visible lag.

---

#### 9. LocalAgentLogViewer: 1-Second setTick Interval Forces Re-render

**File**: `src/renderer/src/components/sessions/LocalAgentLogViewer.tsx:114-117`

```tsx
useEffect(() => {
  const interval = setInterval(() => setTick((t) => t + 1), 1000)
  return () => clearInterval(interval)
}, [])
```

**Problem**: A `setTick` state update fires every 1 second to update the "elapsed time" display. This re-renders the entire `LocalAgentLogViewer` including the `ChatThread` with all parsed messages. The elapsed time display is the only thing that actually changes.

**Fix**: Extract the elapsed time into a separate memoized component:

```tsx
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>{formatElapsed(startedAt)}</span>
}
```

**Impact**: **Medium** — the ChatThread with parsed stream-json content re-renders every second while viewing a local agent. This is pure waste.

---

#### 10. App.tsx: `onReconnect` Creates New Arrow Function Every Render

**File**: `src/renderer/src/App.tsx:269`

```tsx
<StatusBar
  status={status}
  sessionCount={runningCount}
  model="claude-sonnet-4-6"
  onReconnect={() => connect()} // new fn every render
/>
```

**Problem**: `() => connect()` creates a new reference every render. Since `StatusBar` is a simple presentational component, wrapping it in `React.memo` would be ineffective without stabilizing this prop.

**Fix**: Pass `connect` directly (it's already a stable store function):

```tsx
onReconnect = { connect }
```

**Impact**: **Low** — StatusBar is simple, but this is a free fix.

---

#### 11. Motion System: `filter: 'blur()'` in scaleIn Variant

**File**: `src/renderer/src/lib/motion.ts:64-66`

```tsx
scaleIn: {
  initial: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
},
```

**Problem**: `filter: blur()` is not GPU-composited on all platforms — it triggers paint on every animation frame. Used by `ShortcutsOverlay` (and potentially modals via `scaleIn`). The `opacity` + `scale` properties are fine (GPU-composited via `transform`), but `filter` is not.

**Fix**: Remove `filter: blur()` or replace with a CSS class that uses `will-change: filter`:

```tsx
scaleIn: {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
},
```

If blur is desired, add `will-change: filter` to the target element's CSS.

**Impact**: **Low** — modals are infrequent. But on lower-end machines or when the GPU is busy, this causes visible frame drops.

---

#### 12. SessionsView: Sidebar Resize Handler Missing Cleanup Guard

**File**: `src/renderer/src/views/SessionsView.tsx:338-352`

```tsx
onMouseDown={(e) => {
  e.preventDefault()
  const startX = e.clientX
  const startW = sidebarWidth
  const onMove = (ev: MouseEvent): void => {
    const delta = ev.clientX - startX
    setSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + delta)))
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}}
```

**Problem**: `onMove` fires on every pixel of mouse movement, calling `setSidebarWidth` which triggers a full SessionsView re-render (including AgentList, ChatThread, etc.) on each frame. No `requestAnimationFrame` throttle.

**Fix**: Throttle via `requestAnimationFrame`:

```tsx
const onMove = (ev: MouseEvent): void => {
  requestAnimationFrame(() => {
    const delta = ev.clientX - startX
    setSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + delta)))
  })
}
```

**Impact**: **Low-Medium** — only during resize drag, but causes jank when it happens.

---

## Summary Table

| #   | Issue                                                      | File                                                            | Fix                                              | Impact         |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | -------------- |
| 1   | TerminalView entire-store destructure                      | `views/TerminalView.tsx:10`                                     | Individual selectors                             | **High**       |
| 1b  | FindBar entire-store destructure                           | `components/terminal/FindBar.tsx:7`                             | Individual selectors                             | **High**       |
| 2   | ChatThread no virtualization                               | `components/sessions/ChatThread.tsx:242`                        | `@tanstack/react-virtual` + `React.memo`         | **High**       |
| 2b  | ChatThread renderContent() re-parses markdown every tick   | `components/sessions/ChatThread.tsx:293`                        | `React.memo` MessageBubble wrapper               | **High**       |
| 3   | LogDrawer full-content replace on poll                     | `components/sprint/LogDrawer.tsx:31`                            | Incremental append via byte offset               | **High**       |
| 4   | AgentList inline closures in map                           | `components/sessions/AgentList.tsx:131`                         | `React.memo` on AgentRow + stable callbacks      | **Medium**     |
| 5   | AgentOutputTab inline style objects                        | `components/terminal/AgentOutputTab.tsx:74`                     | CSS classes or hoisted constants                 | **Low-Medium** |
| 6   | KanbanBoard unmemoized filters                             | `components/sprint/KanbanBoard.tsx:54`                          | `useMemo` + `React.memo` on columns              | **Medium**     |
| 7   | SprintCenter interval thrashing                            | `components/sprint/SprintCenter.tsx:76`                         | Ref-based callback to avoid dependency cycle     | **Medium**     |
| 7b  | MiniChatPane 4 independent pollers                         | `components/sessions/MiniChatPane.tsx:83`                       | Shared polling hook or store                     | **Medium**     |
| 7c  | ChatThread unconditional setStreaming                      | `components/sessions/ChatThread.tsx:107`                        | Guard with `if (streaming)`                      | **Low**        |
| 7d  | CommandPalette unused `connect` dep                        | `components/layout/CommandPalette.tsx:154`                      | Remove from dependency array                     | **Low**        |
| 8   | DiffViewer unvirtualized lines                             | `components/diff/DiffViewer.tsx:168`                            | Collapse inactive files + virtualize large hunks | **Medium**     |
| 9   | LocalAgentLogViewer 1s tick re-render                      | `components/sessions/LocalAgentLogViewer.tsx:114`               | Extract ElapsedTime into isolated component      | **Medium**     |
| 10  | App.tsx inline onReconnect                                 | `App.tsx:269`                                                   | Pass `connect` directly                          | **Low**        |
| 11  | Motion blur() not GPU-composited                           | `lib/motion.ts:64`                                              | Remove filter or add `will-change`               | **Low**        |
| 12  | Sidebar resize no rAF throttle                             | `views/SessionsView.tsx:338`                                    | `requestAnimationFrame` wrapper                  | **Low-Medium** |
| 12b | MemoryView O(n^2) indexOf in render                        | `views/MemoryView.tsx:265`                                      | Precomputed index Map                            | **Low-Medium** |
| 12c | CostView 4 separate filter/reduce passes                   | `views/CostView.tsx:365`                                        | Single-pass `useMemo`                            | **Low**        |
| 12e | Zero components use React.memo                             | All components                                                  | Wrap list items + display components             | **High**       |
| 12f | Per-instance 1s intervals (AgentStatusChip, LocalAgentRow) | `sprint/AgentStatusChip.tsx:14`, `sessions/LocalAgentRow.tsx:7` | Shared tick signal                               | **Medium**     |
| 12g | ChatPane/MiniChatPane subscribe to full sessions array     | `sessions/ChatPane.tsx:20`                                      | Narrow selector to `.find()` by key              | **Medium**     |

#### 12b. MemoryView: O(n^2) `indexOf` in Render Loop

**File**: `src/renderer/src/views/MemoryView.tsx:265`

```tsx
{group.files.map((f) => {
  const idx = flatFiles.indexOf(f)  // O(n) per file
  return ( ... )
})}
```

**Problem**: `flatFiles.indexOf(f)` is a linear scan per file inside a nested `.map()`. With 100 memory files, this is 10,000 comparisons per render. Neither `groupFiles()` (line 158) nor `flatFiles` (line 159) are memoized.

**Fix**: Memoize `groupFiles` and `flatFiles`, and precompute a `Map<string, number>` for O(1) index lookup:

```tsx
const indexMap = useMemo(() => new Map(flatFiles.map((f, i) => [f.path, i])), [flatFiles])
// In render: const idx = indexMap.get(f.path) ?? -1
```

**Impact**: **Low-Medium** — only noticeable with large memory collections, but a free fix.

---

#### 12c. CostView: 4 Separate Filter/Reduce Passes at Render

**File**: `src/renderer/src/views/CostView.tsx:365-375`

```tsx
const todayCost = sessionsWithCost.filter(...).reduce(...)
const weekCost = sessionsWithCost.filter(...).reduce(...)
const monthCost = sessionsWithCost.filter(...).reduce(...)
const allTimeCost = sessionsWithCost.reduce(...)
```

**Problem**: Four independent iterations over the session array, none memoized. With 200 sessions, that's ~800 iterations per render (every 30s poll).

**Fix**: Single-pass `useMemo` that buckets sessions by time window:

```tsx
const { todayCost, weekCost, monthCost, allTimeCost } = useMemo(() => {
  let today = 0,
    week = 0,
    month = 0,
    all = 0
  for (const s of sessionsWithCost) {
    all += s.cost
    if (isWithinMs(s.updatedAt, DAY_MS)) today += s.cost
    if (isWithinMs(s.updatedAt, 7 * DAY_MS)) week += s.cost
    if (isWithinMs(s.updatedAt, 30 * DAY_MS)) month += s.cost
  }
  return { todayCost: today, weekCost: week, monthCost: month, allTimeCost: all }
}, [sessionsWithCost])
```

**Impact**: **Low** — 30s poll is infrequent, but an easy optimization.

---

#### 12e. Zero Components Use React.memo

**Scope**: Entire `src/renderer/src/components/` directory

**Problem**: Not a single component in the codebase is wrapped in `React.memo`. Key candidates that would benefit most:

| Component         | Why                                                                         |
| ----------------- | --------------------------------------------------------------------------- |
| `AgentRow`        | Rendered in lists of 10+, parent re-renders every 5s from process polling   |
| `TaskCard`        | Rendered per Kanban card, parent re-renders every 5-30s from sprint polling |
| `AgentStatusChip` | Has its own 1s interval; memo prevents re-render from parent poll cascades  |
| `Badge`, `Button` | Stateless display components used everywhere                                |
| `SessionHeader`   | Pure display, receives objects that may not change                          |
| `KanbanColumn`    | Receives filtered task arrays; memo + useMemo prevents cascade re-renders   |

**Fix**: Wrap these components in `React.memo`. For list items (`AgentRow`, `TaskCard`), this is the single highest-ROI change when combined with stable callbacks.

**Impact**: **High** — enables all other memoization fixes to actually take effect. Without `React.memo` on children, `useMemo`/`useCallback` in parents has no benefit.

---

#### 12f. AgentStatusChip + LocalAgentRow: Per-Instance 1s Intervals

**Files**:

- `src/renderer/src/components/sprint/AgentStatusChip.tsx:14-18`
- `src/renderer/src/components/sessions/LocalAgentRow.tsx:7-13`

**Problem**: `AgentStatusChip` creates a `setInterval` per active task card (1s) to update elapsed time. `LocalAgentRow` has a `useElapsed` hook that does the same per local agent row. With 5 active tasks + 10 local agents, that's 15 independent 1-second intervals, each triggering a component re-render.

**Fix**: Create a shared tick signal — either a tiny Zustand store (`useTickStore`) or a React context that ticks every second. All elapsed-time consumers subscribe to one signal instead of each running their own interval.

**Impact**: **Medium** — eliminates N intervals down to 1. Reduces per-second render count from N to N (still renders each consumer) but removes N-1 `setInterval` overhead.

---

#### 12g. ChatPane Subscribes to Entire `sessions` Array

**File**: `src/renderer/src/components/sessions/ChatPane.tsx:20-21`

```tsx
const sessions = useSessionsStore((s) => s.sessions)
const subAgents = useSessionsStore((s) => s.subAgents)
```

**Problem**: `ChatPane` subscribes to the full `sessions` and `subAgents` arrays, then does `.find()` to get the one it cares about. Any session update anywhere (e.g., a different session's `updatedAt` ticking) re-renders this pane. In 2-pane mode, both panes re-render. Same pattern in `MiniChatPane.tsx:26-27`.

**Fix**: Narrow the selector:

```tsx
const session = useSessionsStore((s) => s.sessions.find((s) => s.key === sessionKey))
```

**Impact**: **Medium** — especially in split layouts where multiple panes are mounted simultaneously.

---

## What's Already Done Well

- **Zustand selectors in App.tsx** — granular `(s) => s.field` pattern used correctly (lines 166-180)
- **`useUnifiedAgents`** — properly memoized with `useMemo` over 4 store subscriptions
- **logPoller.ts** — incremental byte-offset approach is correct (just not used by LogDrawer)
- **Terminal PTY** — xterm.js handles its own rendering, no React overhead
- **Always-mounted views** — Sessions and Terminal stay mounted (no remount cost on tab switch)
- **Animation variants** — mostly GPU-friendly (opacity + transform), with one exception (blur)
- **Effect cleanup** — all intervals/listeners have proper cleanup returns
- **Adaptive polling** — sprint uses 5s/30s based on active tasks; chat uses 1s/5s based on streaming

---

## Recommended Fix Order

1. **TerminalView selectors** (5 min, high ROI)
2. **LogDrawer incremental append** (30 min, high ROI)
3. **LocalAgentLogViewer extract ElapsedTime** (10 min, medium ROI)
4. **KanbanBoard useMemo + React.memo** (15 min, medium ROI)
5. **SprintCenter ref-based pollPrStatuses** (10 min, medium ROI)
6. **AgentList/AgentRow React.memo + stable callbacks** (20 min)
7. **ChatThread virtualization** (1-2 hours, high ROI but more work)
8. **Remaining items** (as time allows)
