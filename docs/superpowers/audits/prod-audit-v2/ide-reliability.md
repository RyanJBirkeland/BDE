# IDE -- Reliability Engineer Follow-Up Audit (V2)

**Date:** 2026-03-29
**Scope:** 13 source files + 5 test files
**Persona:** Reliability Engineer
**Baseline:** `docs/superpowers/audits/prod-audit/ide-reliability.md` (18 findings)

---

## Remediation Status of Previous Findings

### Fixed

| Previous ID | Issue                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-REL-001 | `fileContents` in component state -- data loss on view switch     | **Fixed.** `fileContents` moved to Zustand store (`ide.ts:92`). IDEView reads from store (`IDEView.tsx:70,89`). Content survives view switches since Zustand persists across unmounts.                                                                                                                                                                                                                                                                           |
| IDE-REL-002 | FSWatcher has no error handler -- crash on EMFILE/EACCES          | **Fixed.** `watcher.on('error', ...)` added at `ide-fs-handlers.ts:226-233`. Handler logs the error, stops the watcher, and broadcasts `fs:watchError` to all renderer windows.                                                                                                                                                                                                                                                                                  |
| IDE-REL-005 | `ideRootPath` set before `fs.watch()` succeeds                    | **Fixed.** `fs:watchDir` handler now calls `validateIdeRoot()` first (`ide-fs-handlers.ts:211-212`), which validates the path exists, is a directory, and is within the user's home directory. `ideRootPath` is set to the validated path before `fs.watch()`, but `fs.watch()` on a validated path is unlikely to fail. The root validation itself (existence + directory check + home directory scope) addresses the original IDE-1 synthesis finding as well. |
| IDE-REL-009 | `Date.now()` temp file collision on rapid saves                   | **Fixed.** `writeFileContent` now uses `Date.now()` + random component (`Math.random().toString(36).substring(2, 8)`) at `ide-fs-handlers.ts:176-177`. Collision probability is negligible.                                                                                                                                                                                                                                                                      |
| IDE-REL-010 | No test coverage for TerminalPanel                                | **Fixed.** Test file at `src/renderer/src/components/ide/__tests__/TerminalPanel.test.tsx` (160 lines, 10 tests). Covers: render, tab operations, clear callback, agent tab detection hiding clear button, close-others structure.                                                                                                                                                                                                                               |
| IDE-REL-011 | `setRootPath` leaves stale tabs from old root                     | **Fixed.** `setRootPath` now clears `openTabs: []`, `activeTabId: null`, `fileContents: {}`, and `fileLoadingStates: {}` at `ide.ts:131-138`.                                                                                                                                                                                                                                                                                                                    |
| IDE-REL-013 | `fs:watchDir` returns undefined -- renderer cannot detect failure | **Fixed.** Handler now returns `{ success: true }` at `ide-fs-handlers.ts:235`. `IDEEmptyState.tsx:16` checks the result and shows a toast on failure.                                                                                                                                                                                                                                                                                                           |
| IDE-REL-015 | Full file read before binary check wastes memory for binary files | **Fixed.** `readFileContent` now opens a file handle and reads only the first 8KB probe for files larger than `BINARY_DETECT_BYTES` at `ide-fs-handlers.ts:139-152`. The full file read only happens after the binary check passes. Small files still do the in-memory check after full read (acceptable since they are small).                                                                                                                                  |

### Partially Fixed

| Previous ID | Issue                                                             | Current State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-REL-003 | Closed tabs never evict from `fileContents` -- memory leak        | **Partially fixed.** `clearFileContent()` action exists in the store (`ide.ts:246-252`), and `setRootPath` clears all contents. However, `closeTab()` in the store (`ide.ts:183-208`) does NOT call `clearFileContent()`, and `handleCloseTab` in `IDEView.tsx:161-173` also does not call it. Individual tab closes still leak their content in the store. See IDE-REL-V2-001.                                                                                                                                                                                                                       |
| IDE-REL-004 | Race condition between save and file-read on tab switch           | **Partially fixed.** `fileContents` is now in the Zustand store (global), eliminating the stale-closure issue where `handleSave` captured component-local state. However, `handleSave` (`IDEView.tsx:138-150`) still reads `activeTab` from a `useCallback` dependency -- if the user switches tabs between pressing Cmd+S and the callback executing, the save could target the wrong tab. The window is narrower now since content lookup is by `filePath` (not positional), but the tab identity itself (`activeTab`) is still closure-captured.                                                   |
| IDE-REL-012 | Persistence subscriber fires on all state changes                 | **Partially fixed.** The subscriber still fires on every state change (`ide.ts:275`), but the serialized object excludes `fileContents` and `fileLoadingStates` (the highest-frequency fields). The JSON comparison at line 286 prevents unnecessary IPC calls. However, `setDirty` updates `openTabs` on every keystroke, changing the serialized output each time (since `openTabs` is mapped to `{ filePath }` -- actually `isDirty` is not serialized, so only the first dirty keystroke triggers a change). Net: much better than before, but still does JSON.stringify on every store mutation. |
| IDE-REL-016 | FileTreeNode selector causes all nodes to re-render on tab switch | **Not fixed.** `FileTreeNode.tsx:44-47` still uses a selector returning `activeFilePath` (string), not a boolean `isActive`. Every node re-renders when `activeFilePath` changes. See IDE-REL-V2-003.                                                                                                                                                                                                                                                                                                                                                                                                 |

### Not Fixed

| Previous ID | Issue                                                                        | Current State                                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IDE-REL-006 | `fs:dirChanged` broadcasts to all windows; FileTree re-reads unconditionally | **Not fixed.** `FileTree.tsx:35` still ignores the changed path: `window.api.onDirChanged(() => loadEntries())`. Every filesystem change triggers a full root re-read.                                                                                                                                 |
| IDE-REL-007 | Expanded subdirectories never refresh on FS changes                          | **Fixed in a different way than expected.** `FileTreeNode.tsx:55-63` now subscribes to `onDirChanged` with path filtering. It refreshes when `fullPath === changedPath` or `fullPath.startsWith(changedPath + '/')`. This is correct and resolves the stale-children issue. **Reclassified as Fixed.** |
| IDE-REL-008 | Binary detection only checks null bytes                                      | **Not fixed.** `ide-fs-handlers.ts:144-148,162-166` still only checks for null bytes. No magic-byte detection, no extension-based filtering. The code now has an inline comment acknowledging the limitation (line 160-162), which is an improvement in documentation but not in behavior.             |
| IDE-REL-014 | No symlink integration test for `validateIdePath`                            | **Not fixed.** `ide-fs-handlers.test.ts` still has no symlink-specific test. The `realpathSync` codepath is not exercised by any mock.                                                                                                                                                                 |
| IDE-REL-017 | `handleCloseAll` in TerminalPanel always preserves first tab                 | **Not fixed.** `TerminalPanel.tsx:41` still uses `currentTabs.slice(1).forEach(...)`.                                                                                                                                                                                                                  |
| IDE-REL-018 | `setDirty` called on every keystroke even when already dirty                 | **Not fixed.** `IDEView.tsx:156` calls `setDirty(activeTab.id, true)` unconditionally on every content change. No guard for `if (!activeTab.isDirty)`.                                                                                                                                                 |

---

## New Findings

### Moderate

#### IDE-REL-V2-001: `closeTab` does not evict `fileContents` -- memory leak persists

**File:** `src/renderer/src/stores/ide.ts:183-208`, `src/renderer/src/views/IDEView.tsx:161-173`

**Problem:** The store provides `clearFileContent(filePath)` at line 246, but neither `closeTab()` in the store nor `handleCloseTab()` in `IDEView` calls it. Over a session where the user opens and closes many files, `fileContents` grows unboundedly. Since contents are now in the Zustand store (not component state), they persist even across view switches, making the leak longer-lived than before the fix.

**Fix:** Call `clearFileContent` when closing a tab. In the store's `closeTab`:

```typescript
closeTab: (tabId: string): void => {
  set((s) => {
    const tab = s.openTabs.find((t) => t.id === tabId)
    // ... existing logic ...
    const { [tab?.filePath ?? '']: _, ...restContents } = s.fileContents
    const { [tab?.filePath ?? '']: _l, ...restLoading } = s.fileLoadingStates
    return {
      openTabs: updatedTabs,
      activeTabId: newActiveTabId,
      fileContents: restContents,
      fileLoadingStates: restLoading
    }
  })
}
```

---

#### IDE-REL-V2-002: `onDirChanged` listener leak -- FileTreeNode subscribes but callback identity changes

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:55-63`

**Problem:** Each `FileTreeNode` subscribes to `onDirChanged` in a `useEffect` with `[fullPath]` dependency. The subscription is cleaned up on unmount and when `fullPath` changes. However, when the tree has hundreds of visible nodes, this creates hundreds of IPC event listeners on `fs:dirChanged`. Combined with `FileTree.tsx:35` also subscribing, every filesystem change dispatches to O(n) listeners where n is the number of rendered tree nodes plus root. For a project with 200+ visible files/dirs, this is 200+ callback invocations per filesystem event.

**Fix:** Lift the `onDirChanged` subscription to the `FileTree` component (or a shared context) and pass the changed path down, rather than having each node subscribe independently.

---

#### IDE-REL-V2-003: FileTreeNode `activeFilePath` selector re-renders all nodes on tab switch

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:44-47`

**Problem:** (Carried from IDE-REL-016, still open.) Every `FileTreeNode` subscribes to `activeFilePath` via a selector that returns a string. When the active tab changes, the selector return value changes for ALL nodes (from old path to new path), causing every visible node to re-render. Only the previously-active and newly-active nodes actually need to update their styling.

**Fix:** Change selector to return a boolean:

```typescript
const isActive = useIDEStore((s) => {
  const activeTab = s.openTabs.find((t) => t.id === s.activeTabId)
  return activeTab?.filePath === fullPath
})
```

---

#### IDE-REL-V2-004: `validateIdeRoot` allows any path under home directory -- no scoping

**File:** `src/main/handlers/ide-fs-handlers.ts:21-45`

**Problem:** `validateIdeRoot` ensures the path is within the user's home directory but does not limit it further. Paths like `~/.ssh`, `~/.bde/bde.db`, or `~/.aws` are valid IDE roots. While the IDE is a local tool and users could access these via Finder anyway, this expands the attack surface if the renderer is compromised (SEC-1, renderer sandbox disabled, is still open).

**Severity:** Low (defense-in-depth concern, not a direct vulnerability given local-only access).

---

### Minor

#### IDE-REL-V2-005: `handleSave` does not guard against concurrent saves

**File:** `src/renderer/src/views/IDEView.tsx:138-150`

**Problem:** Rapid Cmd+S presses can trigger multiple concurrent `handleSave` calls for the same file. Each calls `window.api.writeFile()` independently. While the atomic write on the backend (write-to-temp + rename) prevents corruption, concurrent saves to the same file create multiple temp files and race on the rename. The second rename overwrites the first, which is semantically correct but wasteful.

**Fix:** Add a save-in-progress guard (e.g., a `useRef<Set<string>>` tracking which files are currently saving).

---

#### IDE-REL-V2-006: `expandedDirs` persisted without size limit

**File:** `src/renderer/src/stores/ide.ts:283`

**Problem:** `expandedDirs` is persisted via `ide.state` setting. If a user expands hundreds of directories over time, this record grows unboundedly. When serialized to JSON and stored in SQLite, this becomes a large blob. The record is only cleared on `setRootPath` change, not when directories are collapsed (collapsed dirs get `false` values, not deletion).

**Fix:** Prune `expandedDirs` to only include `true` values before persisting. Consider a cap (e.g., 500 entries).

---

## Summary Table

| ID             | Severity    | Status              | File                    | Description                                           |
| -------------- | ----------- | ------------------- | ----------------------- | ----------------------------------------------------- |
| IDE-REL-001    | Significant | **Fixed**           | ide.ts:92               | fileContents moved to Zustand store                   |
| IDE-REL-002    | Significant | **Fixed**           | ide-fs-handlers.ts:226  | FSWatcher error handler added                         |
| IDE-REL-003    | Significant | **Partially Fixed** | ide.ts:183              | clearFileContent exists but not called on tab close   |
| IDE-REL-004    | Significant | **Partially Fixed** | IDEView.tsx:138         | Race window narrowed but not eliminated               |
| IDE-REL-005    | Significant | **Fixed**           | ide-fs-handlers.ts:211  | watchDir validates path before setting root           |
| IDE-REL-006    | Moderate    | **Not Fixed**       | FileTree.tsx:35         | dirChanged still triggers full root re-read           |
| IDE-REL-007    | Moderate    | **Fixed**           | FileTreeNode.tsx:55     | Nodes now subscribe to dirChanged with path filtering |
| IDE-REL-008    | Moderate    | **Not Fixed**       | ide-fs-handlers.ts:144  | Binary detection still null-byte only                 |
| IDE-REL-009    | Moderate    | **Fixed**           | ide-fs-handlers.ts:176  | Random suffix added to temp file name                 |
| IDE-REL-010    | Moderate    | **Fixed**           | TerminalPanel.test.tsx  | Test file added with 10 tests                         |
| IDE-REL-011    | Moderate    | **Fixed**           | ide.ts:131              | setRootPath clears tabs, contents, loading states     |
| IDE-REL-012    | Moderate    | **Partially Fixed** | ide.ts:275              | High-freq fields excluded from serialized output      |
| IDE-REL-013    | Moderate    | **Fixed**           | ide-fs-handlers.ts:235  | Returns { success: true }                             |
| IDE-REL-014    | Moderate    | **Not Fixed**       | ide-fs-handlers.test.ts | Still no symlink test                                 |
| IDE-REL-015    | Moderate    | **Fixed**           | ide-fs-handlers.ts:139  | Probe-first for large files                           |
| IDE-REL-016    | Moderate    | **Not Fixed**       | FileTreeNode.tsx:44     | Selector still returns string, not boolean            |
| IDE-REL-017    | Minor       | **Not Fixed**       | TerminalPanel.tsx:41    | closeAll still preserves first tab                    |
| IDE-REL-018    | Minor       | **Not Fixed**       | IDEView.tsx:156         | setDirty on every keystroke                           |
| IDE-REL-V2-001 | Moderate    | **New**             | ide.ts:183              | closeTab does not evict fileContents                  |
| IDE-REL-V2-002 | Moderate    | **New**             | FileTreeNode.tsx:55     | O(n) IPC listeners from tree node subscriptions       |
| IDE-REL-V2-003 | Moderate    | **New**             | FileTreeNode.tsx:44     | activeFilePath selector re-renders all nodes          |
| IDE-REL-V2-004 | Low         | **New**             | ide-fs-handlers.ts:21   | validateIdeRoot allows any path under home            |
| IDE-REL-V2-005 | Minor       | **New**             | IDEView.tsx:138         | No concurrent save guard                              |
| IDE-REL-V2-006 | Minor       | **New**             | ide.ts:283              | expandedDirs persisted without size limit             |

---

## Cross-Reference with Synthesis

| Synthesis ID                                         | Status                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| IDE-1 (watchDir accepts any path)                    | **Fixed.** `validateIdeRoot` validates existence, directory type, and home directory scope.                                 |
| IDE-2 (validateIdePath returns pre-symlink path)     | **Fixed.** Returns `real` (canonical) path at `ide-fs-handlers.ts:94`.                                                      |
| IDE-3 (Fallback path skips symlink resolution)       | **Fixed.** Fallback logic resolves parent symlinks at `ide-fs-handlers.ts:73-87`.                                           |
| IDE-4 (No filename sanitization)                     | **Fixed.** `sanitizeFilename()` in `FileSidebar.tsx:31-43` blocks path separators, traversal, null bytes, control chars.    |
| IDE-5 (fileContents in component state)              | **Fixed.** Moved to Zustand store.                                                                                          |
| IDE-6 (FSWatcher no error handler)                   | **Fixed.**                                                                                                                  |
| IDE-7 (Race between save and file-read)              | **Partially Fixed.**                                                                                                        |
| IDE-8 (File read error silently shows empty)         | **Fixed.** Toast error shown at `IDEView.tsx:132`, loading states tracked.                                                  |
| IDE-9 (No loading indicator)                         | **Fixed.** Loading state tracked in store, "Loading..." shown at `IDEView.tsx:380-392`.                                     |
| IDE-10 (No beforeunload guard)                       | **Fixed.** `beforeunload` handler at `IDEView.tsx:192-202`.                                                                 |
| IDE-11 (Expanded dirs not persisted)                 | **Fixed.** Persisted at `ide.ts:283`, restored at `IDEView.tsx:43`.                                                         |
| IDE-12 (Cmd+S fails when terminal focused)           | **Fixed.** Cmd+S now works regardless of focused panel when there's an active tab (`IDEView.tsx:227`).                      |
| IDE-13 (FileTreeNode subdirs never refresh)          | **Fixed.** Nodes subscribe to dirChanged with path filtering.                                                               |
| IDE-14 (setRootPath leaves stale tabs)               | **Fixed.**                                                                                                                  |
| IDE-16 (Predictable temp file path)                  | **Fixed.**                                                                                                                  |
| IDE-21 (watchDir returns undefined)                  | **Fixed.**                                                                                                                  |
| IDE-22 (Full file read before binary check)          | **Fixed.**                                                                                                                  |
| IDE-24 (Copy Path no success feedback)               | **Fixed.** Toast at `FileSidebar.tsx:113`.                                                                                  |
| IDE-25 (File tree nodes not keyboard-navigable)      | **Fixed.** `tabIndex={0}`, `role="treeitem"`, `onKeyDown` handler with Enter/Space/Arrow keys at `FileTreeNode.tsx:86-103`. |
| IDE-26 (Delete confirmation says "cannot be undone") | **Fixed.** Confirmation now says "Move to Trash?" at `FileSidebar.tsx:99`.                                                  |
| IDE-29 (Context menu renders off-screen)             | **Fixed.** Viewport boundary adjustment at `FileContextMenu.tsx:58-76`.                                                     |
| IDE-30 (Recent folder click fails silently)          | **Fixed.** Error handling with toast at `IDEEmptyState.tsx:13-25`.                                                          |
| IDE-32 (Same-named files identical tab labels)       | **Fixed.** `getDisplayName` includes parent directory for disambiguation at `ide.ts:61-77`.                                 |
| IDE-33 (Context menu lacks keyboard nav)             | **Partially fixed.** Escape closes menu, first item auto-focused. Arrow key navigation between items not implemented.       |
| IDE-34 (Persistence 2s debounce no flush on close)   | **Fixed.** `flushPersistence()` registered on `beforeunload` at `ide.ts:298`.                                               |

---

## Statistics

- **Previous findings:** 18
- **Fixed:** 9 (50%)
- **Partially Fixed:** 3 (17%)
- **Not Fixed:** 6 (33%)
- **New findings:** 6
- **Total open (remaining + new):** 15 (3 partially fixed + 6 not fixed + 6 new)

### Severity Breakdown (open issues)

- **Significant:** 2 (IDE-REL-003 partial, IDE-REL-004 partial)
- **Moderate:** 8 (IDE-REL-006, 008, 014, 016 not fixed + V2-001, V2-002, V2-003 new)
- **Minor:** 4 (IDE-REL-017, 018 not fixed + V2-005, V2-006 new)
- **Low:** 1 (V2-004 new)

---

## Overall Assessment

**Substantial progress.** 9 of 18 original findings are fully resolved, including the most impactful ones: `fileContents` data loss on view switch (IDE-REL-001), FSWatcher crash risk (IDE-REL-002), root path validation (IDE-REL-005), and stale tabs on root change (IDE-REL-011). The synthesis-level high-severity finding IDE-1 (watchDir accepts any path) is also fully addressed.

The remaining gaps fall into two categories:

1. **Incomplete remediation** (3 items): `closeTab` not evicting file contents, the persistence subscriber efficiency, and the save/tab-switch race. These are straightforward follow-ups to work already done.

2. **Performance concerns** (3 new items): O(n) IPC listener subscriptions in FileTreeNode, all-node re-renders on tab switch, and the unconditional `setDirty` call. These will matter as users work in larger projects but are not correctness issues.

The IDE is materially more reliable than at the time of the first audit. The most critical data-loss and crash-risk paths have been addressed. The remaining issues are memory efficiency, rendering performance, and test coverage gaps.
