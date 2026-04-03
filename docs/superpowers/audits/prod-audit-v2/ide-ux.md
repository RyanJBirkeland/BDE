# IDE -- UX QA Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 9 source components, 1 store, 1 main-process handler, 1 constants file
**Baseline:** `docs/superpowers/audits/prod-audit/ide-ux.md` (20 findings)
**Synthesis reference:** `docs/superpowers/audits/prod-audit/synthesis.md` (IDE section, 34 findings across 3 personas)

---

## Remediation Status of Previous Findings

### Fixed

| Original ID | Issue                                                             | Evidence                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-UX-1    | File read error silently shows empty content                      | **Fixed.** `IDEView.tsx:130-133` now calls `toast.error()` on read failure with the error message. Empty content is still set to prevent retry loops, but the user is informed.                                                                                                 |
| IDE-UX-2    | No loading indicator while file content is fetched                | **Fixed.** `fileLoadingStates` added to store (`ide.ts:93,124`). `IDEView.tsx:121-123` checks loading state and skips duplicate fetches. `IDEView.tsx:380-393` renders a "Loading..." indicator when a file is being fetched, distinct from the "no file selected" empty state. |
| IDE-UX-3    | No `beforeunload` guard for unsaved changes on app close          | **Fixed.** `IDEView.tsx:192-202` adds a `beforeunload` listener that checks `openTabs.some(t => t.isDirty)` and prevents close via `e.preventDefault()`.                                                                                                                        |
| IDE-UX-5    | Expanded directories not persisted across restart                 | **Fixed.** `expandedDirs` is now persisted in the subscriber (`ide.ts:283`) and restored on startup (`IDEView.tsx:34,43`).                                                                                                                                                      |
| IDE-UX-6    | `Cmd+S` silently fails when terminal panel focused                | **Fixed.** `IDEView.tsx:227` now checks `e.key === 's' && activeTabId` without requiring `focusedPanel === 'editor'`. Save works regardless of which panel is focused.                                                                                                          |
| IDE-UX-7    | Copy Path has no success/error feedback                           | **Fixed.** `FileSidebar.tsx:110-117` now uses `.then(() => toast.success(...))` and `.catch((err) => toast.error(...))` on the clipboard write.                                                                                                                                 |
| IDE-UX-9    | Delete confirmation says "cannot be undone" but uses system trash | **Fixed.** `FileSidebar.tsx:99` now reads `Move "${name}" to Trash?` which accurately reflects the `shell.trashItem()` behavior.                                                                                                                                                |
| IDE-UX-10   | Tab reorder action in store but not in UI (dead code)             | **Fixed.** `reorderTabs` has been removed from `ide.ts`. No dead reorder code remains.                                                                                                                                                                                          |
| IDE-UX-11   | `sidebarWidth`/`terminalHeight` store fields unused (dead state)  | **Fixed.** Both fields and their setters have been removed from `ide.ts`.                                                                                                                                                                                                       |
| IDE-UX-12   | Context menu can render off-screen                                | **Fixed.** `FileContextMenu.tsx:58-76` now measures the menu via `getBoundingClientRect()` after render and clamps position to keep it within the viewport (8px margin). Uses state-based position tracking via `useState`.                                                     |
| IDE-UX-14   | Recent folder click fails silently if folder deleted              | **Fixed.** `IDEEmptyState.tsx:13-25` now wraps the `watchDir` call in try/catch, validates the result, and shows `toast.error()` with the folder path and error message if the folder is inaccessible. `setRootPath` is only called after successful watch.                     |
| IDE-UX-16   | Persistence subscriber 2s debounce with no flush on unmount/close | **Fixed.** `ide.ts:263-271` adds a `flushPersistence()` function that clears the timer and writes immediately. `ide.ts:297-299` registers it on `beforeunload`.                                                                                                                 |
| IDE-UX-18   | Same-named files show identical tab labels                        | **Fixed.** `ide.ts:61-77` now checks for duplicate basenames across all open tabs and disambiguates with the parent directory name (e.g., `Button.tsx (components)` vs `Button.tsx (pages)`). Display names are recalculated on both `openTab` and `closeTab`.                  |

### Partially Fixed

| Original ID | Issue                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-UX-4    | `fileContents` in local state causes memory leak and stale content | **Partially fixed.** File contents have been moved from React `useState` to the Zustand store (`ide.ts:92,123`), fixing the data-loss-on-view-switch issue (Synthesis IDE-5). However, `clearFileContent` exists in the store (`ide.ts:107,246-252`) but is **never called** anywhere in the codebase. When a tab is closed via `closeTab()` (`ide.ts:183-208`), the file content entry is not cleaned up. Over a long session with many files opened and closed, `fileContents` accumulates unbounded entries. The stale-content-on-reopen issue is also still present: `IDEView.tsx:120` returns early if `fileContents[filePath] !== undefined`, serving cached content even if the file changed on disk. |
| IDE-UX-8    | File tree nodes not keyboard-navigable                             | **Partially fixed.** `FileTreeNode.tsx:86-103` now has a `handleKeyDown` handler supporting Enter/Space (open/toggle) and ArrowRight/ArrowLeft (expand/collapse directories). Nodes have `tabIndex={0}` (`FileTreeNode.tsx:109`). However, **Arrow Up/Down navigation between sibling nodes** is not implemented -- each node handles its own keys but there is no roving tabindex or focus management across the tree. Users must Tab through every node rather than using arrow keys to move between them. Home/End navigation is also missing.                                                                                                                                                            |
| IDE-UX-13   | `onDirChanged` reloads all expanded dirs on any FS change          | **Partially fixed.** `FileTreeNode.tsx:55-63` now receives the `changedPath` argument and only refreshes if `fullPath === changedPath                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |     | fullPath.startsWith(changedPath + '/')`. However, the **root `FileTree.tsx:35`** still ignores the path argument: `window.api.onDirChanged(() => loadEntries())`. Every filesystem change triggers a root-level directory reload regardless of where the change occurred. |
| IDE-UX-15   | Context menu has no keyboard navigation                            | **Partially fixed.** `FileContextMenu.tsx:37-41` now handles Escape to close the menu. `FileContextMenu.tsx:52-55` focuses the first button on mount. However, **Arrow Up/Down navigation between menu items** is not implemented. Users must Tab between items, which is non-standard for menus (WAI-ARIA menu pattern requires arrow key navigation with roving tabindex).                                                                                                                                                                                                                                                                                                                                 |

### Not Fixed

| Original ID | Issue                                                          | Status                                                                                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDE-UX-17   | No external file change detection                              | **Not fixed.** `IDEView.tsx:120` still returns early if content is already cached, with no mtime comparison or "file changed on disk" prompt. The `fs:stat` handler exists (`ide-fs-handlers.ts:287-296`) with `mtime` in the response, but it is never used for staleness detection. |
| IDE-UX-19   | `HIDDEN_DIRS` list is not user-configurable                    | **Not fixed.** `file-tree-constants.ts:1-9` still has the same hardcoded 7-entry list with no settings integration.                                                                                                                                                                   |
| IDE-UX-20   | Hidden items filter applies to directory names only, not files | **Not fixed.** The constant is still named `HIDDEN_DIRS` and only contains directory names. No common hidden files (`.DS_Store`, etc.) are filtered.                                                                                                                                  |

---

## New Issues Found in v2

### Moderate

#### IDE-UX-v2-1: `clearFileContent` is dead code -- file content memory cleanup never happens

**File:** `src/renderer/src/stores/ide.ts:107,246-252`

**Problem:** The `clearFileContent` action was added as part of the IDE-5 remediation (moving `fileContents` to the store), but it is never called anywhere. The `closeTab` action (`ide.ts:183-208`) does not call `clearFileContent`. This means the memory leak from IDE-UX-4 persists -- file content entries accumulate indefinitely in the store as files are opened and closed.

**Fix:** Call `clearFileContent(filePath)` inside `closeTab()` when the tab being closed has no other references (no other tab with the same filePath), or integrate cleanup directly into `closeTab`.

---

#### IDE-UX-v2-2: Root-level `FileTree.tsx` still ignores `changedPath` in `onDirChanged`

**File:** `src/renderer/src/components/ide/FileTree.tsx:35`
**Code:**

```typescript
const unsubscribe = window.api.onDirChanged(() => loadEntries())
```

**Problem:** While `FileTreeNode` was fixed (IDE-UX-13 partial), the root `FileTree` component still ignores the changed directory path, causing unconditional root-level reloads on every filesystem event. This partially negates the targeted refresh optimization in `FileTreeNode`.

**Fix:** Accept the `changedPath` parameter and only reload if the changed directory matches the root: `window.api.onDirChanged((changedPath) => { if (dirPath === changedPath || changedPath.startsWith(dirPath)) loadEntries() })`.

---

### Low

#### IDE-UX-v2-3: `fileContents` and `fileLoadingStates` not cleaned up on `setRootPath`

**File:** `src/renderer/src/stores/ide.ts:130-139`

**Problem:** When changing the IDE root path, `setRootPath` now correctly clears `openTabs`, `activeTabId`, `fileContents`, and `fileLoadingStates` (all set to empty). This is good. However, this was noted in the code comment as "IDE-14: Clear stale tabs from old root" but the cleanup of `fileContents` and `fileLoadingStates` is **only done in `setRootPath`**, not in `closeTab`. This is actually correct for the root-change case but highlights the gap in `closeTab` (see IDE-UX-v2-1).

**Status:** Informational -- not a bug per se, but confirms that content cleanup was intentionally implemented for root changes but missed for individual tab closes.

---

#### IDE-UX-v2-4: `beforeunload` guard does not trigger for Electron window close via `Cmd+Q`

**File:** `src/renderer/src/views/IDEView.tsx:192-202`

**Problem:** The `beforeunload` event fires for browser-initiated closes (reload, navigation) and for `window.close()`, but Electron's `Cmd+Q` / app quit path may not reliably trigger `beforeunload` on all platforms. The main process would need a `mainWindow.on('close', ...)` handler that sends an IPC query to the renderer to check for dirty tabs before allowing close. The current implementation covers the common cases but may not cover force-quit or Electron-level window close.

**Fix:** Add a `will-quit` or `window.close` handler in the main process that queries the renderer for unsaved state before allowing the window to close.

---

## Summary Table

| ID          | Status              | Summary                                                                                           |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| IDE-UX-1    | **Fixed**           | File read error now shows toast                                                                   |
| IDE-UX-2    | **Fixed**           | Loading indicator added with `fileLoadingStates`                                                  |
| IDE-UX-3    | **Fixed**           | `beforeunload` guard prevents silent data loss                                                    |
| IDE-UX-4    | **Partially Fixed** | Moved to store (no view-switch loss), but `clearFileContent` never called -- memory leak persists |
| IDE-UX-5    | **Fixed**           | `expandedDirs` persisted and restored                                                             |
| IDE-UX-6    | **Fixed**           | `Cmd+S` works regardless of focused panel                                                         |
| IDE-UX-7    | **Fixed**           | Copy Path shows toast success/error                                                               |
| IDE-UX-8    | **Partially Fixed** | Enter/Space/ArrowLeft/ArrowRight work, but no ArrowUp/Down roving focus between nodes             |
| IDE-UX-9    | **Fixed**           | Delete says "Move to Trash?"                                                                      |
| IDE-UX-10   | **Fixed**           | Dead `reorderTabs` removed                                                                        |
| IDE-UX-11   | **Fixed**           | Dead `sidebarWidth`/`terminalHeight` removed                                                      |
| IDE-UX-12   | **Fixed**           | Context menu viewport-clamped                                                                     |
| IDE-UX-13   | **Partially Fixed** | `FileTreeNode` filters by path, but root `FileTree` still reloads unconditionally                 |
| IDE-UX-14   | **Fixed**           | Recent folder validates with try/catch + toast                                                    |
| IDE-UX-15   | **Partially Fixed** | Escape + auto-focus work, but no arrow-key navigation between items                               |
| IDE-UX-16   | **Fixed**           | `flushPersistence()` on `beforeunload`                                                            |
| IDE-UX-17   | **Not Fixed**       | No external file change detection                                                                 |
| IDE-UX-18   | **Fixed**           | Duplicate tab names disambiguated with parent dir                                                 |
| IDE-UX-19   | **Not Fixed**       | Hidden dirs still hardcoded                                                                       |
| IDE-UX-20   | **Not Fixed**       | Filter still directory-names only                                                                 |
| IDE-UX-v2-1 | **New (Moderate)**  | `clearFileContent` never called -- memory leak                                                    |
| IDE-UX-v2-2 | **New (Moderate)**  | Root `FileTree` ignores `changedPath`                                                             |
| IDE-UX-v2-3 | **New (Low/Info)**  | Content cleanup only on root change, not tab close                                                |
| IDE-UX-v2-4 | **New (Low)**       | `beforeunload` may not fire on Electron `Cmd+Q`                                                   |

---

## Overall Assessment

**13 of 20 original findings are fully fixed.** This is strong remediation progress (65% fully resolved). The fixes are well-implemented with proper error handling, toast feedback, viewport clamping, and state persistence.

**4 findings are partially fixed** -- keyboard navigation has basic support but lacks the full WAI-ARIA roving tabindex pattern, and the filesystem change optimization was applied to child nodes but not the root tree.

**3 findings remain unfixed** -- all low-severity (external file change detection, configurable hidden dirs, file-type filtering). These are feature enhancements rather than bugs.

**2 new moderate issues** were found: the `clearFileContent` dead code means the memory leak from IDE-UX-4 persists despite the store migration, and the root `FileTree` still does unconditional reloads.

### Priority Recommendations

1. **IDE-UX-v2-1 (Moderate):** Wire `clearFileContent` into `closeTab` -- one-line fix that completes the IDE-UX-4 remediation.
2. **IDE-UX-v2-2 (Moderate):** Pass `changedPath` through in `FileTree.tsx:35` -- one-line fix that completes the IDE-UX-13 remediation.
3. **IDE-UX-4 stale content:** Add mtime-based staleness check when switching back to a cached tab -- completes the second half of the original finding.
4. **IDE-UX-8/15 keyboard navigation:** Implement roving tabindex for tree and menu components -- accessibility compliance.
