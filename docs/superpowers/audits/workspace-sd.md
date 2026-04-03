# Workspace Domain Audit -- Senior Developer (SD)

**Auditor:** SD lens (code quality, security, race conditions, memory leaks, error handling, performance)
**Date:** 2026-03-27
**Scope:** IDE views/components, Agents views/components, Terminal components, associated stores, `ide-fs-handlers.ts`

---

## 1. Executive Summary

The Workspace domain is generally well-structured with proper path traversal guards in `ide-fs-handlers.ts`, capped agent event stores, and good use of virtual scrolling for performance. However, there are several issues: a **symlink-based path traversal bypass** in the IDE file handler, **terminal font size zoom state that is never consumed** (dead feature), **duplicate agent event stores** (both `agentEvents.ts` and the events section of `agents.ts`), and **multiple dead components** (AgentTimeline, TimelineBar, AgentDetail, HealthBar, SteerInput, EmptyState, PaneStatusBar are unused in production). The Monaco editor lifecycle is handled correctly via `@monaco-editor/react`'s internal disposal, but xterm.js cleanup has a subtle race condition with async PTY creation.

---

## 2. Critical Issues

### 2.1 Symlink-Based Path Traversal in `ide-fs-handlers.ts` (Security)

**File:** `src/main/handlers/ide-fs-handlers.ts:15-21`

```ts
export function validateIdePath(targetPath: string, allowedRoot: string): string {
  const resolved = resolve(targetPath)
  const root = resolve(allowedRoot)
  if (!resolved.startsWith(root + '/') && resolved !== root) {
    throw new Error(`Path traversal blocked: ...`)
  }
  return resolved
}
```

`path.resolve()` does **not** resolve symlinks. A malicious symlink inside the IDE root (e.g., `~/project/evil -> /etc`) would pass validation because `resolve('/Users/ryan/project/evil/passwd')` starts with the root prefix. The resolved path is then handed directly to `readFile`, `writeFile`, `rm`, `rename`, etc.

**Impact:** Any symlink within the opened directory tree can be used to read/write/delete arbitrary files on the filesystem.

**Fix:** Use `fs.realpathSync()` or `fs.realpath()` on both `targetPath` and `allowedRoot` before the prefix check, or after resolving check with `realpath`. At minimum, stat the target and reject symlinks pointing outside root.

### 2.2 Terminal PTY Cleanup Race Condition (Resource Leak)

**File:** `src/renderer/src/components/terminal/TerminalPane.tsx:62-93`

The PTY is created asynchronously via `window.api.terminal.create(...)`, and the cleanup function (`cleanupRef.current`) is set inside the `.then()` callback. If the component unmounts before the promise resolves (e.g., user closes the tab immediately), the cleanup return function on line 86 runs, finds `cleanupRef.current` is still `null`, and the PTY process is never killed. The ResizeObserver and data listener also leak.

```ts
window.api.terminal.create({...}).then((id) => {
  // ...
  cleanupRef.current = (): void => { ... } // Set AFTER async
})

return () => {
  cleanupRef.current?.()  // null if promise hasn't resolved yet
  // ...
}
```

**Impact:** Orphaned PTY processes remain running after tab close if the close happens before the PTY is fully initialized.

**Fix:** Track the promise and kill the PTY in the cleanup path even if the ref hasn't been set yet. Use an `AbortController` or `isMounted` flag pattern:

```ts
let ptyId: number | null = null
const promise = window.api.terminal.create({...}).then((id) => { ptyId = id; ... })
return () => {
  promise.then(() => { if (ptyId) window.api.terminal.kill(ptyId) })
  ...
}
```

### 2.3 PlaygroundModal iframe `sandbox` Allows Scripts (XSS Surface)

**File:** `src/renderer/src/components/agents/PlaygroundModal.tsx:334-335`

```tsx
<iframe
  sandbox="allow-scripts"
  srcDoc={html}
```

The iframe sandbox attribute includes `allow-scripts`, which means agent-generated HTML can execute arbitrary JavaScript within the iframe. While the sandbox does block same-origin access (no `allow-same-origin`), combining `allow-scripts` with Electron's renderer process is riskier than in a standard browser -- especially if CSP is not airtight. The HTML content comes from agent output, which is untrusted.

**Impact:** Agent-generated HTML can run JS that may exploit Electron-specific behaviors, attempt to access `window.opener`, or create resource-intensive loops (CPU/memory DoS).

**Mitigation:** Consider removing `allow-scripts` entirely for pure preview, or add `allow-scripts allow-popups-to-escape-sandbox` but never `allow-same-origin`. Document this as an accepted risk if scripts are required for preview functionality.

---

## 3. Significant Issues

### 3.1 Duplicate Agent Events Stores -- Memory Waste and Confusion

**Files:**

- `src/renderer/src/stores/agentEvents.ts` (standalone store, 52 lines)
- `src/renderer/src/stores/agents.ts:362-401` (events section inside unified agents store)

Both stores implement identical event subscription, capping (2000 events), and history loading logic. Both are actively imported:

- `agentEvents.ts` is used by `AgentsView.tsx`, `AgentConsole.tsx`, `LiveActivityStrip.tsx`, `AgentOutputTab.tsx`, `TaskMonitorPanel.tsx`, `LogDrawer.tsx`
- `agents.ts` events section has `initEvents()`, `loadEventHistory()`, `clearEvents()` that duplicate the standalone store

If both `init()` / `initEvents()` are called, every agent event is stored **twice** in memory -- up to 4000 events per agent across two stores. The standalone `agentEvents.ts` should be the canonical one; the events section in `agents.ts` should be removed or should delegate to it.

### 3.2 `fileContents` State Grows Unbounded in `IDEView.tsx`

**File:** `src/renderer/src/views/IDEView.tsx:103`

```ts
const [fileContents, setFileContents] = useState<Record<string, string>>({})
```

File contents are loaded into this map when a tab becomes active, but **never evicted** when a tab is closed. The `closeTab` action removes the tab from `openTabs` but the content remains in `fileContents`. For a long-running session editing many large files, this map grows without bound.

**Impact:** Memory bloat proportional to the number of files ever opened (not just currently open). A 5MB file read once and closed still occupies memory.

**Fix:** In `handleCloseTab`, also remove the closed tab's `filePath` from `fileContents`.

### 3.3 `onDirChanged` Listener Does Not Filter by Directory

**File:** `src/renderer/src/components/ide/FileTree.tsx:34-37`

```ts
useEffect(() => {
  const unsubscribe = window.api.onDirChanged(() => loadEntries())
  return unsubscribe
}, [loadEntries])
```

The `fs:dirChanged` IPC event broadcasts a `dirPath` argument (see `ide-fs-handlers.ts:98`), but the `FileTree` listener ignores it and reloads entries on **any** change event. Since `FileTreeNode` also subscribes to this same event (via its own `FileTree` usage for children), a single file change triggers a cascade of `readDir` IPC calls for **every** expanded directory in the tree.

**Impact:** O(n) IPC calls per filesystem change where n = number of visible/expanded `FileTree` components. For a deeply expanded tree, this causes significant IPC traffic and UI jank.

**Fix:** Filter on `dirPath` -- only reload entries if the changed directory is this component's `dirPath` or a descendant of it.

### 3.4 `FileTreeNode` Selector Creates New Reference Every Render

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:44-47`

```ts
const activeFilePath = useIDEStore((s) => {
  const activeTab = s.openTabs.find((t) => t.id === s.activeTabId)
  return activeTab?.filePath ?? null
})
```

This selector returns a derived string value, which is fine for primitive equality. However, `openTabs` is an array that changes reference on every tab mutation (open, close, dirty, reorder). Since the selector reads `s.openTabs`, it runs on every store update. For a tree with hundreds of nodes, this is hundreds of selector executions per keystroke (since typing sets `isDirty`).

**Impact:** Performance degradation in large file trees. Every character typed triggers selector evaluation across all visible `FileTreeNode` instances.

**Fix:** Use a dedicated `activeFilePath` selector at a higher level (e.g., `FileSidebar`) and pass it as a prop, or memoize with a stable selector that only depends on `activeTabId`.

### 3.5 Terminal `fontSize` Store State is Never Consumed

**File:** `src/renderer/src/stores/terminal.ts:55,81,149-159`

The terminal store has `fontSize` state with `zoomIn`, `zoomOut`, and `resetZoom` actions. `IDEView.tsx` binds keyboard shortcuts to call these actions (lines 249-266). However, `TerminalPane.tsx` hardcodes `fontSize: 13` on line 43 and **never reads** `useTerminalStore.fontSize`. The zoom state changes but has no visible effect.

**Impact:** Broken feature -- Cmd+= / Cmd+- / Cmd+0 in the terminal panel appear to do nothing despite the keyboard handlers being wired.

**Fix:** Have `TerminalPane` subscribe to `useTerminalStore((s) => s.fontSize)` and apply it to the xterm instance via `term.options.fontSize = newSize` in a `useEffect`.

### 3.6 `AgentTimeline` `useMemo` Has Unstable Dependency

**File:** `src/renderer/src/components/agents/AgentTimeline.tsx:18-26`

```ts
const now = Date.now()
const timeRange = { start: sixHoursAgo, end: now }
const filteredAgents = useMemo(() => { ... }, [agents, timeRange])
```

`timeRange` is a new object literal on every render, so `useMemo` will **always** recompute. While this is dead code (see Section 5), it demonstrates a pattern that should not be replicated.

---

## 4. Minor Issues

### 4.1 `agentEvents.ts` `init()` Return Type Is Ambiguous

**File:** `src/renderer/src/stores/agentEvents.ts:8`

```ts
init: () => () => void
```

The `init` function returns a cleanup function, but the store interface makes it look like a function that returns a function. The naming doesn't clarify that the return value must be stored and called for cleanup. A more descriptive name like `subscribe` or documenting the cleanup contract would help.

### 4.2 `ConsoleHeader` Missing `void` Annotation on Async Handlers

**File:** `src/renderer/src/components/agents/ConsoleHeader.tsx:64,72`

`handleStop` and `handleCopyLog` are `async` functions used as `onClick` handlers but are not wrapped in `void`. The promise rejection would be unhandled if the `try/catch` were removed during refactoring.

### 4.3 Inconsistent Error Handling in `FileSidebar`

**File:** `src/renderer/src/components/ide/FileSidebar.tsx:29-33`

`handleNewFile` uses `window.prompt()` (synchronous browser dialog) for user input. This is functional but blocks the main thread and is inconsistent with the rest of the app's UI patterns (which use `useConfirm` modals). Same for `handleNewFolder` (line 36), `handleRename` (line 46), and `handleDelete` (line 58 uses `window.confirm`).

### 4.4 `CommandAutocomplete` Captures All Keyboard Events Globally

**File:** `src/renderer/src/components/agents/CommandAutocomplete.tsx:40-65`

The autocomplete adds a global `keydown` listener on `window` which captures Arrow, Enter, and Escape keys. This could interfere with other keyboard handlers if the autocomplete is rendered while other modals or inputs are focused.

### 4.5 `PLANNING_PROMPT_PREFIX` Hardcoded in Store

**File:** `src/renderer/src/stores/agents.ts:28-47`

The planning prompt template is a large string literal embedded in the Zustand store file. This should live in a separate constants or templates file for maintainability.

### 4.6 `LaunchpadReview` Dead "Save as Template" Button

**File:** `src/renderer/src/components/agents/LaunchpadReview.tsx:97`

```tsx
{false && (
  <button ... onClick={onSaveTemplate}>Save as Template</button>
)}
```

Permanently hidden behind `{false &&`. Should be removed or replaced with a feature flag.

### 4.7 Inline Styles Dominating Agent Components

Multiple agent components (`AgentCard.tsx`, `AgentDetail.tsx`, `AgentList.tsx`, `AgentPill.tsx`, `ConsoleHeader.tsx`, etc.) use extensive inline `style={}` objects with `tokens.*` references instead of CSS classes. This is inconsistent with the neon CSS convention documented in CLAUDE.md and makes styling harder to maintain. The `ConsoleLine.tsx` and `CommandBar.tsx` components correctly use CSS classes.

---

## 5. Dead Code Inventory

| File                                                                  | Lines                                        | Notes                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/agents/AgentTimeline.tsx`                | 1-95 (entire file)                           | Documented as dead in CLAUDE.md. Only imported by its test file.                                                                                                                                                                                                                  |
| `src/renderer/src/components/agents/TimelineBar.tsx`                  | 1-114 (entire file)                          | Only imported by `AgentTimeline.tsx` (also dead).                                                                                                                                                                                                                                 |
| `src/renderer/src/components/agents/__tests__/AgentTimeline.test.tsx` | entire file                                  | Tests dead component.                                                                                                                                                                                                                                                             |
| `src/renderer/src/components/agents/AgentDetail.tsx`                  | 1-211 (entire file)                          | Replaced by `AgentConsole.tsx`. Only imported by its test file.                                                                                                                                                                                                                   |
| `src/renderer/src/components/agents/SteerInput.tsx`                   | 1-103 (entire file)                          | Only imported by `AgentDetail.tsx` (dead). Only other import is its test.                                                                                                                                                                                                         |
| `src/renderer/src/components/agents/__tests__/AgentDetail.test.tsx`   | entire file                                  | Tests dead component.                                                                                                                                                                                                                                                             |
| `src/renderer/src/components/agents/__tests__/SteerInput.test.tsx`    | entire file                                  | Tests dead component.                                                                                                                                                                                                                                                             |
| `src/renderer/src/components/agents/HealthBar.tsx`                    | 1-69 (entire file)                           | Not imported by any production code. Only imported by its test.                                                                                                                                                                                                                   |
| `src/renderer/src/components/agents/__tests__/HealthBar.test.tsx`     | entire file                                  | Tests dead component.                                                                                                                                                                                                                                                             |
| `src/renderer/src/components/terminal/EmptyState.tsx`                 | 1-48 (entire file)                           | Not imported by any file (production or test).                                                                                                                                                                                                                                    |
| `src/renderer/src/components/terminal/PaneStatusBar.tsx`              | 1-41 (entire file)                           | Not imported by any file. Contains a TODO for CWD polling that was never implemented.                                                                                                                                                                                             |
| `src/renderer/src/stores/agents.ts:362-401`                           | events section                               | Duplicates `agentEvents.ts`. Both `initEvents`/`loadEventHistory`/`clearEvents` methods duplicate the standalone store.                                                                                                                                                           |
| `src/renderer/src/stores/agents.ts:28-47`                             | `PLANNING_PROMPT_PREFIX`                     | Exported but usage unclear -- check if `agents.ts` spawn path is actually called vs. the standalone `localAgents` store.                                                                                                                                                          |
| `src/renderer/src/stores/terminal.ts:55,149-159`                      | `fontSize`, `zoomIn`, `zoomOut`, `resetZoom` | State exists and keyboard shortcuts are wired, but no component reads the value. Dead feature.                                                                                                                                                                                    |
| `src/renderer/src/components/agents/LaunchpadReview.tsx:97-101`       | "Save as Template" button                    | Permanently hidden behind `{false &&`.                                                                                                                                                                                                                                            |
| `src/renderer/src/components/agents/ChatBubble.tsx`                   | 1-70 (entire file)                           | Only imported by `ChatRenderer.tsx`, which is itself only used in `AgentDetail.tsx` (dead) pathway -- **correction**: `ChatRenderer` is also used by `AgentOutputTab.tsx`, `LogDrawer.tsx`, and `TaskMonitorPanel.tsx`, so `ChatBubble` is live.                                  |
| `src/renderer/src/components/agents/ToolCallBlock.tsx`                | 1-187 (entire file)                          | Only imported by `ChatRenderer.tsx` which is live. However, `ToolCallBlock` is only used via the `ChatRenderer` code path, NOT via `ConsoleLine.tsx` (which has its own inline tool rendering). So `ToolCallBlock` is live but **redundant** with `ConsoleLine`'s tool rendering. |
| `src/renderer/src/components/agents/ThinkingBlock.tsx`                | 1-83 (entire file)                           | Same situation as `ToolCallBlock` -- live via `ChatRenderer`, redundant with `ConsoleLine`.                                                                                                                                                                                       |

**Total dead files (safe to delete):** 9 component files + 4 test files = 13 files
**Dead store sections:** events in `agents.ts`, `fontSize`/zoom in `terminal.ts`
