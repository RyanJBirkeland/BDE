# IDE -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 22 files (13 source + 9 test)
**Persona:** Reliability Engineer

---

## Cross-Reference with Synthesis Final Report

### Previously Reported -- Now Fixed

| Synthesis ID | Issue                                                        | Status                                                                                                                                                             |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-2        | Symlink-based path traversal bypass in IDE `validateIdePath` | **Fixed.** `fs.realpathSync()` added to both root and target paths at `ide-fs-handlers.ts:19-42`. Fallback logic handles non-existent paths for new file creation. |

### Previously Reported -- Still Open

| Synthesis ID         | Issue                                                                                         | Current State                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint 3 action item | Move `fileContents` from IDEView local state to IDE store (workspace-ax S3, workspace-sd 3.2) | **Still open.** `fileContents` remains as `useState<Record<string, string>>({})` in `IDEView.tsx:103`. See IDE-REL-001.                                                                                                                                                                                                                                          |
| UX-5                 | Keyboard shortcuts fire in contentEditable / Monaco editor                                    | **Still open.** IDEView registers its own keydown handler at `IDEView.tsx:276` with `capture: true`, which intercepts keys before Monaco. The Cmd+S guard at line 190 checks `focusedPanel === 'editor'` which partially mitigates, but other IDE shortcuts (Cmd+B, Cmd+J, Cmd+O) fire unconditionally when IDE view is active regardless of Monaco focus state. |

---

## Findings

### Critical

None found.

### Significant

#### IDE-REL-001: fileContents lives in component state -- data loss on unmount

**File:** `src/renderer/src/views/IDEView.tsx:103`
**Code:**

```typescript
const [fileContents, setFileContents] = useState<Record<string, string>>({})
```

**Problem:** All loaded file contents and unsaved edits are stored in React `useState` inside `IDEView`. When the user switches to another view (e.g., Dashboard via Cmd+1), the IDEView component unmounts. When they return, `fileContents` is a fresh empty `{}`. The file is re-read from disk for the active tab (line 107-115), but:

1. **Unsaved edits are silently lost.** If a user has dirty tabs and navigates away, the dirty content vanishes with no warning. The `isDirty` flag in the IDE store survives (it's in Zustand), but the actual modified content does not.
2. **All background tab contents are evicted.** Switching back forces re-reads for every tab as the user clicks through them.

**Fix:** Move `fileContents` to the IDE Zustand store (already called out in synthesis Sprint 3). At minimum, add a `beforeunload`-style guard or check dirty tabs before allowing view switches.

---

#### IDE-REL-002: File watcher has no error handler -- silent death on EMFILE/EACCES

**File:** `src/main/handlers/ide-fs-handlers.ts:144`
**Code:**

```typescript
watcher = fs.watch(dirPath, { recursive: true }, () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    broadcastDirChanged(dirPath)
    debounceTimer = null
  }, 500)
})
```

**Problem:** `fs.watch()` emits `'error'` events (e.g., EMFILE when fd limit exceeded, EACCES on permission change, or when the watched directory is deleted). No `.on('error', ...)` handler is attached. In Node.js, an unhandled `'error'` event on an `EventEmitter` throws and crashes the process. Since this runs in Electron's main process, this could crash the entire app.

**Fix:** Add an error handler:

```typescript
watcher.on('error', (err) => {
  logger.error('File watcher error:', err)
  // Optionally attempt to restart the watcher
})
```

---

#### IDE-REL-003: fileContents memory leak -- closed tabs never have their content evicted

**File:** `src/renderer/src/views/IDEView.tsx:103, 132`
**Code:**

```typescript
setFileContents((prev) => ({ ...prev, [activeTab.filePath]: content }))
```

**Problem:** When a tab is closed via `closeTab(tabId)`, the corresponding entry in `fileContents` is never removed. Over a long session opening many files, `fileContents` grows unboundedly. With the 5MB file size limit, a user opening 20 large files accumulates up to 100MB of dead strings in memory. This is especially problematic because `fileContents` is also in `handleSave`'s dependency array, so the growing record triggers increasingly expensive closure captures.

**Fix:** In `handleCloseTab`, after `closeTab(tabId)`, remove the file content:

```typescript
const tab = openTabs.find((t) => t.id === tabId)
if (tab) {
  setFileContents((prev) => {
    const next = { ...prev }
    delete next[tab.filePath]
    return next
  })
}
```

---

#### IDE-REL-004: Race condition between save and file-read on tab switch

**File:** `src/renderer/src/views/IDEView.tsx:107-115, 117-127`

**Problem:** The file-read effect (line 107) and `handleSave` (line 117) can race. Scenario:

1. User edits file A (dirty).
2. User switches to tab B. The effect fires for B, reading its content.
3. User quickly clicks Save (Cmd+S). `handleSave` reads `fileContents[activeTab.filePath]` -- but `activeTab` is now B, not A.
4. File A's unsaved changes are never saved; file B's original content is "saved" (a no-op at best).

The `activeTab` variable is derived from `openTabs` and `activeTabId` on each render, but `handleSave` is memoized with `useCallback` and captures `activeTab` at callback-creation time. Since `activeTab` depends on `openTabs` from `useShallow`, the callback is recreated when tabs change, so this race is narrow but possible during rapid tab-switch + Cmd+S sequences.

**Fix:** Have `handleSave` accept an explicit tab ID parameter rather than relying on `activeTab` closure state, or debounce saves to ensure they complete before tab switches process.

---

#### IDE-REL-005: No validation of file watcher `dirPath` parameter

**File:** `src/main/handlers/ide-fs-handlers.ts:140-151`
**Code:**

```typescript
safeHandle('fs:watchDir', (_e, dirPath: string) => {
  stopWatcher()
  ideRootPath = dirPath
  watcher = fs.watch(dirPath, { recursive: true }, () => { ... })
})
```

**Problem:** The `fs:watchDir` handler sets `ideRootPath` and starts a watcher on any path without validating that the path exists or is a directory. If the renderer sends a bogus path, `fs.watch()` will throw synchronously (ENOENT), but the error is caught by `safeHandle` and returned to the renderer. However, `ideRootPath` has already been set to the bogus path on line 142, meaning all subsequent `fs:readDir`, `fs:readFile`, etc. calls will use this invalid root for path validation. A legitimate path could then be rejected or an unintended path accepted.

**Fix:** Move `ideRootPath = dirPath` to after the `fs.watch()` call succeeds, or validate the path exists first:

```typescript
const info = await stat(dirPath)
if (!info.isDirectory()) throw new Error('Not a directory')
ideRootPath = dirPath
```

---

### Moderate

#### IDE-REL-006: `fs:dirChanged` broadcasts to ALL windows but FileTree re-reads unconditionally

**File:** `src/main/handlers/ide-fs-handlers.ts:122-126`, `src/renderer/src/components/ide/FileTree.tsx:34-37`

**Problem:** `broadcastDirChanged(dirPath)` sends the changed directory path to all renderer windows, but `FileTree`'s `onDirChanged` listener ignores the path argument and re-reads the root directory on every change event:

```typescript
const unsubscribe = window.api.onDirChanged(() => loadEntries())
```

This means every file save, create, rename, or delete triggers a full re-read of the root directory from FileTree plus a re-read from every expanded FileTreeNode. For large project directories, this causes unnecessary I/O on every keystroke that triggers auto-save. The 500ms debounce in the watcher helps, but the fan-out to all expanded nodes is still O(n) where n is the number of expanded directories.

**Fix:** Pass the changed path to the callback and only refresh the affected subtree, or compare the changed path against the node's own path before re-reading.

---

#### IDE-REL-007: FileTreeNode does not re-read on `fs:dirChanged` -- stale children

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:53-69`

**Problem:** `FileTreeNode` loads children in a `useEffect` triggered by `[type, fullPath, isExpanded]`. It does NOT subscribe to `fs:dirChanged`. When a file is created, renamed, or deleted inside a subdirectory, the expanded `FileTreeNode` for that directory will not update until the user collapses and re-expands it. Only the root `FileTree` component subscribes to `onDirChanged`, but it only re-reads its own level (the root directory entries).

**Impact:** Users create a file via the context menu, the file is created on disk, but it does not appear in the file tree until the parent directory is toggled. This appears as a bug where files "don't show up."

**Fix:** Either have `FileTreeNode` also subscribe to `onDirChanged` (with path filtering to avoid thundering herd), or lift the subscription to a shared data layer that updates the entire tree.

---

#### IDE-REL-008: Binary detection only checks for null bytes -- misses many binary formats

**File:** `src/main/handlers/ide-fs-handlers.ts:92-98`
**Code:**

```typescript
const probe = buf.subarray(0, BINARY_DETECT_BYTES)
for (let i = 0; i < probe.length; i++) {
  if (probe[i] === 0) {
    throw new Error(`File appears to be binary and cannot be opened as text`)
  }
}
```

**Problem:** The binary detection heuristic only looks for null bytes. Many binary formats (e.g., UTF-16 encoded text files, certain PDFs, compressed files that happen to lack null bytes in the first 8KB) will pass this check. UTF-16 files in particular will have null bytes for ASCII chars (every other byte), so they ARE detected, but UTF-16-BE BOM without null bytes in early content could slip through. More practically, files like `.woff2`, `.wasm`, or certain image formats may have runs of non-null bytes in their headers.

The result is that binary files that slip through will be loaded as garbled UTF-8 text into Monaco, potentially hanging or corrupting the editor for large files just under the 5MB limit.

**Fix:** Add additional heuristics: check for known binary magic bytes (PNG/JPEG/ZIP/WASM headers), check the ratio of non-printable characters, or use a library like `istextorbinary`. At minimum, check file extension against a known binary extensions list before reading.

---

#### IDE-REL-009: Atomic write temp file collision on rapid saves

**File:** `src/main/handlers/ide-fs-handlers.ts:106`
**Code:**

```typescript
const tmpPath = `${filePath}.bde-tmp-${Date.now()}`
```

**Problem:** `Date.now()` has millisecond resolution. If two saves to the same file happen within the same millisecond (e.g., auto-save triggered concurrently from two windows, or a script hitting the API), they produce the same temp path. The second `writeFile` overwrites the first's temp file, and the subsequent `rename` operations race, potentially leaving a stale temp file or losing content.

**Fix:** Use `crypto.randomUUID()` or `process.hrtime.bigint()` instead of `Date.now()` for the temp file suffix.

---

#### IDE-REL-010: No test coverage for TerminalPanel component

**File:** `src/renderer/src/components/ide/TerminalPanel.tsx`

**Problem:** `TerminalPanel.tsx` has zero test coverage. No test file exists at `src/renderer/src/components/ide/__tests__/TerminalPanel.test.tsx`. The component wires together `TerminalTabBar`, `TerminalToolbar`, and `TerminalContent` with callbacks for clear, close-others, and close-all. The `handleCloseAll` function at line 39-42 has a potential off-by-one: it calls `currentTabs.slice(1).forEach(...)` which always preserves the first tab -- this is presumably intentional (keep one tab) but is untested.

**Fix:** Add tests covering: initial render, clear callback, close-others logic, close-all preserving first tab, agent tab detection disabling clear.

---

#### IDE-REL-011: `setRootPath` does not close open tabs or clear fileContents

**File:** `src/renderer/src/stores/ide.ts:113-119`, `src/renderer/src/views/IDEView.tsx:152-158`

**Problem:** When the user opens a new folder (`handleOpenFolder`), `setRootPath` clears `expandedDirs` but does NOT close open tabs. The old tabs (from the previous root) remain open with paths that are now outside the new root. Attempting to save these tabs will fail at the `validateIdePath` check since their paths are under the old root, not the new one. The error appears as a confusing "Path traversal blocked" toast.

**Fix:** When `setRootPath` is called, also clear `openTabs` and `activeTabId`, or at minimum filter out tabs whose `filePath` is not under the new root. Also clear `fileContents` in the view.

---

#### IDE-REL-012: Persistence subscriber fires on every store change, not just persisted fields

**File:** `src/renderer/src/stores/ide.ts:216-233`

**Problem:** The `useIDEStore.subscribe()` callback fires on every state change including `focusedPanel`, `expandedDirs`, and `sidebarWidth` -- none of which are persisted. The JSON serialization comparison at line 226 (`serialized === lastSerialized`) prevents unnecessary writes, but the serialization itself runs on every state change. For `expandedDirs` changes (every directory toggle), `focusedPanel` changes (every click), etc., this creates unnecessary work including computing `state.openTabs.find(...)` and `JSON.stringify(...)`.

**Impact:** Low severity individually, but in aggregate this adds GC pressure from frequent string allocations.

**Fix:** Use `subscribeWithSelector` from Zustand to only fire on changes to the persisted fields, or use a shallow equality check on just the persisted fields before serializing.

---

#### IDE-REL-013: `fs:watchDir` handler is synchronous but `safeHandle` expects async

**File:** `src/main/handlers/ide-fs-handlers.ts:140-151`

**Problem:** The `fs:watchDir` handler does not return a value or a promise. `safeHandle` wraps IPC handlers and returns their result to the renderer. If `fs.watch()` throws synchronously (e.g., ENOENT), `safeHandle` catches it. However, the renderer side (`await window.api.watchDir(dir)`) receives `undefined` on success, which is ambiguous -- it cannot distinguish between "watcher started successfully" and "handler returned nothing because of a swallowed error in safeHandle."

**Fix:** Return a success indicator: `return { ok: true }` or throw explicitly on failure so the renderer can handle errors.

---

#### IDE-REL-014: No test for `validateIdePath` with symlinks

**File:** `src/main/__tests__/ide-fs-handlers.test.ts:38-63`

**Problem:** The test suite for `validateIdePath` tests path traversal with `..` and absolute paths outside root, but does not test the symlink resolution path. The symlink fix (SEC-2 from synthesis) added `fs.realpathSync()` calls, but there are no tests verifying that:

1. A symlink inside root pointing outside root is rejected
2. A symlink inside root pointing to another location inside root is allowed
3. The fallback path when `realpathSync` throws (new file creation) works correctly

Since `fs.realpathSync` is not mocked in the test file, the tests exercise the fallback path only (where `realpathSync` succeeds on real paths but the symlink scenario is never triggered).

**Fix:** Add tests that mock `fs.realpathSync` to simulate symlink resolution, testing both the rejection and the fallback paths.

---

#### IDE-REL-015: `readFileContent` reads entire file into memory before binary check

**File:** `src/main/handlers/ide-fs-handlers.ts:84-101`
**Code:**

```typescript
const info = await stat(filePath)
if (info.size > MAX_READ_BYTES) {
  throw new Error(`File too large: ...`)
}
const buf = await readFile(filePath)
```

**Problem:** After the size check passes (file is under 5MB), the entire file is read into a Buffer, then the first 8KB is scanned for null bytes. If the file is binary (detected by null bytes), the full 5MB buffer was allocated and read for nothing. For a 4.9MB binary file, this wastes ~5MB of memory and disk I/O.

**Fix:** Read only the first 8KB probe first (`read()` with a small buffer or `createReadStream` with `start/end`), check for binary, then read the full file only if it passes the text check.

---

#### IDE-REL-016: FileTreeNode selector creates new object reference on every render

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:44-47`
**Code:**

```typescript
const activeFilePath = useIDEStore((s) => {
  const activeTab = s.openTabs.find((t) => t.id === s.activeTabId)
  return activeTab?.filePath ?? null
})
```

**Problem:** This selector returns a primitive (`string | null`), which is fine for Zustand's shallow comparison. However, every `FileTreeNode` in the tree subscribes to this selector. When the active tab changes, ALL FileTreeNode instances re-render (since the selector return value changes for all of them). In a project with hundreds of visible files, this causes a cascade of re-renders on every tab switch.

**Fix:** Each FileTreeNode only needs to know if IT is the active file. Change the selector to return a boolean:

```typescript
const isActive = useIDEStore((s) => {
  const activeTab = s.openTabs.find((t) => t.id === s.activeTabId)
  return activeTab?.filePath === fullPath
})
```

This way, only the previously-active and newly-active nodes re-render.

---

### Minor

#### IDE-REL-017: `handleCloseAll` in TerminalPanel always preserves the first tab

**File:** `src/renderer/src/components/ide/TerminalPanel.tsx:39-42`
**Code:**

```typescript
const handleCloseAll = useCallback(() => {
  const { tabs: currentTabs } = useTerminalStore.getState()
  currentTabs.slice(1).forEach((tab) => closeTab(tab.id))
}, [closeTab])
```

**Problem:** `slice(1)` always skips the first tab regardless of whether it's the active tab or a special tab. This means "Close All" actually means "Close all except the first one created." If the user's workflow creates an agent tab first, they cannot close it via "Close All." This is a minor UX inconsistency but could confuse users expecting all tabs to close.

**Fix:** Document this as intentional (always keep at least one shell tab) or change to close all and auto-create a fresh default tab.

---

#### IDE-REL-018: `handleContentChange` does not debounce dirty-flag updates

**File:** `src/renderer/src/views/IDEView.tsx:129-136`
**Code:**

```typescript
const handleContentChange = useCallback(
  (content: string) => {
    if (!activeTab) return
    setFileContents((prev) => ({ ...prev, [activeTab.filePath]: content }))
    setDirty(activeTab.id, true)
  },
  [activeTab, setDirty]
)
```

**Problem:** Every keystroke in Monaco triggers `handleContentChange`, which calls `setDirty` on every keystroke. `setDirty` calls `set()` on the Zustand store, which triggers the persistence subscriber (IDE-REL-012), which serializes the entire state to JSON. For fast typists (10+ keystrokes/second), this generates significant GC pressure.

**Fix:** Only call `setDirty(id, true)` if the tab is not already dirty:

```typescript
if (!activeTab.isDirty) setDirty(activeTab.id, true)
```

---

## Summary Table

| ID          | Severity    | File                                    | Description                                                                  |
| ----------- | ----------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| IDE-REL-001 | Significant | IDEView.tsx:103                         | fileContents in component state causes data loss on view switch              |
| IDE-REL-002 | Significant | ide-fs-handlers.ts:144                  | FSWatcher has no error handler -- unhandled 'error' can crash main process   |
| IDE-REL-003 | Significant | IDEView.tsx:103,132                     | Closed tabs never evict from fileContents -- memory leak                     |
| IDE-REL-004 | Significant | IDEView.tsx:107-127                     | Race between save and file-read on rapid tab switch                          |
| IDE-REL-005 | Significant | ide-fs-handlers.ts:140-142              | ideRootPath set before fs.watch succeeds -- stale root on failure            |
| IDE-REL-006 | Moderate    | ide-fs-handlers.ts:122, FileTree.tsx:35 | dirChanged broadcasts to all windows; FileTree re-reads unconditionally      |
| IDE-REL-007 | Moderate    | FileTreeNode.tsx:53-69                  | Expanded subdirectories never refresh on filesystem changes                  |
| IDE-REL-008 | Moderate    | ide-fs-handlers.ts:92-98                | Binary detection only checks null bytes -- misses many formats               |
| IDE-REL-009 | Moderate    | ide-fs-handlers.ts:106                  | Date.now() temp file suffix -- collision risk on rapid saves                 |
| IDE-REL-010 | Moderate    | TerminalPanel.tsx                       | Zero test coverage for TerminalPanel component                               |
| IDE-REL-011 | Moderate    | ide.ts:113, IDEView.tsx:152             | setRootPath leaves stale tabs from old root open                             |
| IDE-REL-012 | Moderate    | ide.ts:216-233                          | Persistence subscriber fires on all state changes, not just persisted fields |
| IDE-REL-013 | Moderate    | ide-fs-handlers.ts:140-151              | watchDir returns undefined -- renderer cannot detect failure                 |
| IDE-REL-014 | Moderate    | ide-fs-handlers.test.ts                 | No symlink test coverage for validateIdePath                                 |
| IDE-REL-015 | Moderate    | ide-fs-handlers.ts:84-101               | Full file read before binary check wastes memory for binary files            |
| IDE-REL-016 | Moderate    | FileTreeNode.tsx:44-47                  | activeFilePath selector causes all tree nodes to re-render on tab switch     |
| IDE-REL-017 | Minor       | TerminalPanel.tsx:39-42                 | handleCloseAll always preserves first tab regardless of type                 |
| IDE-REL-018 | Minor       | IDEView.tsx:129-136                     | setDirty called on every keystroke even when already dirty                   |

---

## Statistics

- **Critical:** 0
- **Significant:** 5
- **Moderate:** 11
- **Minor:** 2
- **Total:** 18
- **Previously reported (now fixed):** 1 (SEC-2 symlink traversal)
- **Previously reported (still open):** 2 (fileContents in local state, keyboard shortcut guard)
