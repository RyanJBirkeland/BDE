# IDE -- UX QA Audit

**Date:** 2026-03-29
**Scope:** 22 files (9 source components, 1 store, 1 main-process handler, 1 constants file, 9 test files, 1 CSS file)
**Persona:** UX QA

---

## Cross-Reference with Synthesis Final Report

### Previously Reported -- Now Fixed

| Original ID | Issue | Status |
|---|---|---|
| Synthesis 3.5 / workspace-sd 3.5, workspace-pm 2.2 | Terminal `fontSize`/zoom state never consumed by TerminalPane | **Fixed.** `TerminalPane.tsx` now reads `fontSize` from the terminal store and applies it to xterm via `term.options.fontSize` with a dedicated `useEffect` (lines 119-126). |
| Synthesis Quick Win #7 / workspace-sd 4.3 | `window.confirm()` / `window.prompt()` used in FileSidebar | **Fixed.** `FileSidebar.tsx` now uses `useConfirm()` and `usePrompt()` from the `ui/` modal components (lines 7-8, 19-20). No native browser dialogs remain in IDE code. |

### Previously Reported -- Still Open

| Original ID | Issue | Status |
|---|---|---|
| SEC-2 / workspace-sd 2.1 | Symlink-based path traversal bypass in IDE `validateIdePath()` | **Partially fixed.** `validateIdePath()` now calls `fs.realpathSync()` on both root and target (lines 19-47 of `ide-fs-handlers.ts`). However, when `realpathSync` fails for a non-existent path, the fallback logic (lines 34-41) does a string `.replace(root, rootReal)` which only replaces the first occurrence and may not handle edge cases where `root` appears as a substring elsewhere in the path. The fix is substantially better than the original but the fallback deserves hardening. |
| Synthesis 6 Sprint 3 | Move `fileContents` from IDEView local state to IDE store | **Still open.** `fileContents` remains in `useState` at `IDEView.tsx:103`. See IDE-UX-1 below. |
| UX-5 / shell-design-sd 2.1 | Keyboard shortcuts fire in contentEditable (Monaco) | **Still open in scope of IDE.** The IDE adds its own `keydown` handler on `window` (IDEView.tsx:170-276) with `capture: true`. While Monaco's `Cmd+S` is separately wired via `editor.addCommand` (EditorPane.tsx:57), the app-level `Cmd+S` guard requires `focusedPanel === 'editor'` which is correct, but `Cmd+B` and `Cmd+J` fire unconditionally when IDE is active (lines 172-182) and will intercept those keys even when Monaco has focus and the user might expect different behavior. |

---

## Findings

### Critical

None found.

### Significant

#### IDE-UX-1: File read error silently shows empty content instead of error state

**File:** `src/renderer/src/views/IDEView.tsx:113-114`
**Code:**
```typescript
.catch(() => setFileContents((prev) => ({ ...prev, [filePath]: '' })))
```

**Problem:** When `readFile` fails (file deleted, permissions error, binary file rejection, file too large), the error is swallowed and the editor shows an empty document. The user has no indication that anything went wrong -- the file appears to be empty. If they then hit `Cmd+S`, they will overwrite the real file with empty content.

**Fix:** Add an error state per tab (e.g., `tabErrors: Record<string, string>` in the store). When a read fails, display the error message in the editor area instead of loading Monaco with empty content. At minimum, show a toast on read failure.

---

#### IDE-UX-2: No loading indicator while file content is being fetched

**File:** `src/renderer/src/views/IDEView.tsx:107-115`, `src/renderer/src/components/ide/EditorPane.tsx:44-46`

**Problem:** When a user clicks a file in the tree, `openTab` fires immediately, but the file content is fetched asynchronously. During the fetch (which may take noticeable time for large files or slow disks), `content` is `null` and EditorPane shows "Open a file from the sidebar to start editing" -- the same text as the no-file-selected state. This is confusing: the user clicked a file and sees the empty state message instead of a loading indicator.

**Fix:** Distinguish between "no file selected" (`filePath === null`) and "file loading" (`filePath !== null && content === null`). Show a spinner or "Loading..." text for the latter case.

---

#### IDE-UX-3: No `beforeunload` guard -- app close silently discards unsaved changes

**File:** `src/renderer/src/views/IDEView.tsx` (entire file -- no `beforeunload` listener)

**Problem:** If the user closes the Electron window while files have unsaved changes (`isDirty === true`), all changes are silently lost. The `UnsavedDialog` is only triggered on individual tab close (`handleCloseTab`), not on window close. There is no `beforeunload` event listener or Electron `will-quit` / `close` handler that checks for dirty tabs.

**Fix:** Add a `beforeunload` listener that checks `useIDEStore.getState().openTabs.some(t => t.isDirty)` and either prevents close or prompts the user. In Electron, wire `mainWindow.on('close', ...)` to send an IPC message to the renderer asking to confirm.

---

#### IDE-UX-4: `fileContents` in local state causes stale content and memory leak

**File:** `src/renderer/src/views/IDEView.tsx:103`
**Code:**
```typescript
const [fileContents, setFileContents] = useState<Record<string, string>>({})
```

**Problem:** File contents are stored in React local state, not in the Zustand store. This causes two issues:
1. **Memory leak**: When a tab is closed (`closeTab`), the file content remains in `fileContents` forever -- there is no cleanup. Over a session with many files opened and closed, this accumulates unbounded memory.
2. **Stale content on re-open**: If a file is closed and reopened, the stale cached content is served from `fileContents` (line 110: `if (fileContents[filePath] !== undefined) return`), even if the file changed on disk. The user sees outdated content with no indication it may be stale.

**Fix:** Either (a) move `fileContents` to the IDE store and clean up entries on tab close, or (b) invalidate the cache entry when a tab is closed and force re-read on re-open. Also consider a staleness check using file mtime via the existing `fs:stat` handler.

---

#### IDE-UX-5: Expanded directories state not persisted -- all folders collapse on reload

**File:** `src/renderer/src/views/IDEView.tsx:23-57`, `src/renderer/src/stores/ide.ts:216-233`

**Problem:** The persistence subscriber (ide.ts:216-233) saves `rootPath`, `openTabs`, `activeFilePath`, `sidebarCollapsed`, `terminalCollapsed`, and `recentFolders`. It does NOT save `expandedDirs`. On app restart, the file tree starts fully collapsed. If the user had deeply nested directories expanded, they must re-expand every one manually.

**Fix:** Add `expandedDirs` to the persisted state object in the subscriber (ide.ts:217-224) and restore it in `IDEView.tsx` restore function (line 37).

---

#### IDE-UX-6: `Cmd+S` only works when `focusedPanel === 'editor'` -- easy to accidentally not save

**File:** `src/renderer/src/views/IDEView.tsx:190-195`
**Code:**
```typescript
if (e.key === 's' && focusedPanel === 'editor') {
  e.preventDefault()
  e.stopPropagation()
  void handleSave()
  return
}
```

**Problem:** The `Cmd+S` shortcut is gated on `focusedPanel === 'editor'`. If the user edits a file, then clicks the terminal panel (setting `focusedPanel` to `'terminal'`), `Cmd+S` silently does nothing. There is no visual indicator of which panel is focused, and the user has no feedback that the save was not triggered. Meanwhile, Monaco's own `Cmd+S` command (EditorPane.tsx:57) only fires when Monaco has keyboard focus, which it loses when the user clicks the terminal.

**Fix:** Remove the `focusedPanel === 'editor'` guard from `Cmd+S`. Save should always save the active editor tab regardless of which panel is focused. Alternatively, add a visible focus indicator (e.g., border highlight) so users know which panel is active.

---

### Moderate

#### IDE-UX-7: Copy Path has no success feedback

**File:** `src/renderer/src/components/ide/FileSidebar.tsx:80-82`
**Code:**
```typescript
function handleCopyPath(path: string): void {
  void navigator.clipboard.writeText(path)
}
```

**Problem:** After "Copy Path" from the context menu, there is no toast or visual confirmation. The clipboard write is fire-and-forget with no error handling either. If `clipboard.writeText` fails (e.g., clipboard permissions), the user gets no indication.

**Fix:** Add `toast.success('Path copied to clipboard')` and wrap in try/catch with `toast.error(...)` for failures.

---

#### IDE-UX-8: File tree nodes are not keyboard-navigable

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:76-108`

**Problem:** File tree nodes have `role="treeitem"` but no `tabIndex` attribute and no `onKeyDown` handler. Users cannot navigate the file tree using arrow keys, Enter to open files, or Space to expand directories. The tree is mouse-only. This is a significant accessibility gap -- the `role="tree"` / `role="treeitem"` ARIA pattern requires keyboard interaction per WAI-ARIA Authoring Practices.

**Fix:** Add `tabIndex={0}` to tree items, implement `onKeyDown` for Arrow Up/Down (navigate siblings), Arrow Right (expand/enter directory), Arrow Left (collapse/go to parent), Enter (open file or toggle directory), Home/End (first/last visible node).

---

#### IDE-UX-9: Delete confirmation says "cannot be undone" but uses system trash

**File:** `src/renderer/src/components/ide/FileSidebar.tsx:68-69`
**Code:**
```typescript
const confirmed = await confirm({
  message: `Delete "${name}"? This cannot be undone.`,
```

**File:** `src/main/handlers/ide-fs-handlers.ts:199`
**Code:**
```typescript
await shell.trashItem(safe)
```

**Problem:** The confirmation dialog says "This cannot be undone" but the actual implementation uses `shell.trashItem()`, which moves the file to the system Trash (recoverable). The messaging is misleading and unnecessarily alarming.

**Fix:** Change the message to `Delete "${name}"? It will be moved to Trash.` to match the actual behavior.

---

#### IDE-UX-10: Tab reorder action exists in store but is not exposed in UI

**File:** `src/renderer/src/stores/ide.ts:89,184-186`, `src/renderer/src/components/ide/EditorTabBar.tsx` (entire file)

**Problem:** The IDE store defines `reorderTabs: (tabs: EditorTab[]) => void` (line 89) which is never called anywhere in the codebase. The `EditorTabBar` component has no drag-and-drop support for reordering tabs. Users who work with many files cannot rearrange tabs to group related files together. This is dead code that suggests an intended feature that was never completed.

**Fix:** Either implement drag-and-drop tab reordering in `EditorTabBar` (the terminal tab bar already supports `onReorderTab`), or remove the dead `reorderTabs` action from the store.

---

#### IDE-UX-11: `sidebarWidth` and `terminalHeight` store fields are dead state

**File:** `src/renderer/src/stores/ide.ts:78-79,93-94,200-206`

**Problem:** The store defines `sidebarWidth`, `terminalHeight`, `setSidebarWidth()`, and `setTerminalHeight()` but none of these are used anywhere in the codebase. The sidebar and terminal use `react-resizable-panels` with `defaultSize` percentages, not these pixel values. These dead state fields add confusion about how sizing works.

**Fix:** Remove `sidebarWidth`, `terminalHeight`, `setSidebarWidth`, and `setTerminalHeight` from the store. The panel library manages its own sizes internally.

---

#### IDE-UX-12: Context menu can render off-screen

**File:** `src/renderer/src/components/ide/FileContextMenu.tsx:51`
**Code:**
```typescript
style={{ top: target.y, left: target.x }}
```

**Problem:** The context menu is positioned at the exact click coordinates with no bounds checking. If the user right-clicks near the bottom or right edge of the window, the menu renders partially off-screen and its lower items become unreachable.

**Fix:** After rendering, measure the menu's dimensions and adjust position to keep it within the viewport. Use `useEffect` + `getBoundingClientRect()` on the menu ref to clamp coordinates.

---

#### IDE-UX-13: `onDirChanged` callback reloads all expanded directories on any filesystem change

**File:** `src/renderer/src/components/ide/FileTree.tsx:34-37`
**Code:**
```typescript
useEffect(() => {
  const unsubscribe = window.api.onDirChanged(() => loadEntries())
  return unsubscribe
}, [loadEntries])
```

**File:** `src/renderer/src/components/ide/FileTreeNode.tsx:53-69` (same pattern)

**Problem:** The `fs:dirChanged` IPC event broadcasts a single `dirPath` string, but the `onDirChanged` callback ignores it and unconditionally reloads entries. This means every file save, every directory modification anywhere in the tree causes ALL expanded `FileTreeNode` components to re-fetch their directory listings simultaneously. For a large project with many expanded directories, this creates a burst of IPC calls on every save.

**Fix:** Pass the changed `dirPath` to the callback and only reload if the changed directory matches or is an ancestor of the node's directory: `window.api.onDirChanged((changedPath) => { if (dirPath === changedPath || dirPath.startsWith(changedPath + '/')) loadEntries() })`.

---

#### IDE-UX-14: Recent folder that no longer exists can be clicked with no error handling

**File:** `src/renderer/src/components/ide/IDEEmptyState.tsx:12-15`
**Code:**
```typescript
async function handleRecentFolder(folderPath: string): Promise<void> {
  setRootPath(folderPath)
  await window.api.watchDir(folderPath)
}
```

**Problem:** If a recent folder has been deleted or moved, clicking it calls `setRootPath` (which succeeds, clearing expandedDirs) and then `watchDir`, which will fail silently or watch a nonexistent directory. The file tree will then show an error or empty state with no explanation of why the recent folder did not work.

**Fix:** Validate the folder exists (via `fs:stat`) before setting root path. Show a toast error if the folder is gone, and optionally remove it from the recent list.

---

### Low

#### IDE-UX-15: Context menu has no keyboard navigation

**File:** `src/renderer/src/components/ide/FileContextMenu.tsx:45-113`

**Problem:** The context menu has `role="menu"` and items with `role="menuitem"` but no keyboard event handling. Users cannot navigate menu items with arrow keys or activate them with Enter. The Escape key does not close the menu either (only clicking outside does, via `mousedown` listener).

**Fix:** Add an `onKeyDown` handler for Arrow Up/Down (move focus between items), Enter (activate), Escape (close). Set initial focus on the first menu item when opened.

---

#### IDE-UX-16: Persistence subscriber uses 2-second debounce with no flush on unmount

**File:** `src/renderer/src/stores/ide.ts:229-232`
**Code:**
```typescript
persistTimer = setTimeout(() => {
  window.api.settings.setJson('ide.state', toSave)
}, 2000)
```

**Problem:** The 2-second debounce means the most recent state change may not be persisted if the app closes within 2 seconds of the change. Combined with IDE-UX-3 (no `beforeunload`), rapid close after state changes loses both unsaved file content AND layout state.

**Fix:** Add a synchronous flush (clear timeout and write immediately) on `beforeunload` or Electron's `will-quit` event.

---

#### IDE-UX-17: Opening the same file after external modification shows stale cached content

**File:** `src/renderer/src/views/IDEView.tsx:110`
**Code:**
```typescript
if (fileContents[filePath] !== undefined) return
```

**Problem:** This guard means that once file content is loaded, it is never re-fetched even if the user switches away and back to the tab, or if the file is modified externally. There is no mechanism to detect external changes (via mtime comparison) or to offer a "file changed on disk, reload?" prompt. This is a common IDE feature that is entirely missing.

**Fix:** On tab focus (when the user switches back to a tab), compare the file's mtime (via `fs:stat`) to the time it was last loaded. If the file is newer, show a notification bar in the editor: "This file has been modified externally. [Reload] [Ignore]".

---

#### IDE-UX-18: Opened tabs display basename only -- ambiguous for same-named files in different directories

**File:** `src/renderer/src/stores/ide.ts:61-64`
**Code:**
```typescript
function getDisplayName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}
```

**Problem:** If a user opens `src/components/Button.tsx` and `src/pages/Button.tsx`, both tabs show "Button.tsx" with no way to distinguish them (except by hovering for the `title` tooltip). This is a common confusion in IDEs.

**Fix:** When duplicate display names exist in `openTabs`, disambiguate by prepending the shortest unique parent directory path (e.g., "components/Button.tsx" vs "pages/Button.tsx"). VS Code uses this strategy.

---

#### IDE-UX-19: `HIDDEN_DIRS` list is not user-configurable

**File:** `src/renderer/src/components/ide/file-tree-constants.ts:1-9`
**Code:**
```typescript
export const HIDDEN_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache'
])
```

**Problem:** The hidden directories list is hardcoded. Common directories like `.env`, `coverage/`, `vendor/`, `__pycache__/`, `.idea/`, `.vscode/` are not hidden. Users working on non-JS projects will see irrelevant directories. There is no way to add or remove entries.

**Fix:** Load the hidden list from settings (with the current list as defaults). Add a setting in the IDE section of Settings view for "Hidden file patterns."

---

#### IDE-UX-20: Hidden items filter applies to directory names only, not files

**File:** `src/renderer/src/components/ide/FileTree.tsx:19`, `src/renderer/src/components/ide/file-tree-constants.ts:1`

**Problem:** The constant is named `HIDDEN_DIRS` and the filter at FileTree.tsx:19 applies `HIDDEN_DIRS.has(e.name)` to all entries (files and directories). However, it only contains directory names. Common files users would want hidden (`.DS_Store`, `thumbs.db`, `*.pyc`, etc.) are not filtered. The name `HIDDEN_DIRS` also suggests it was only intended for directories.

**Fix:** Rename to `HIDDEN_ENTRIES` and add common hidden files. Consider supporting glob patterns (e.g., `*.pyc`).

---

## Summary Table

| ID | Severity | Category | Summary |
|---|---|---|---|
| IDE-UX-1 | Significant | Error handling | File read error silently shows empty content |
| IDE-UX-2 | Significant | Loading state | No loading indicator while file content is fetched |
| IDE-UX-3 | Significant | Data loss | No `beforeunload` guard for unsaved changes on app close |
| IDE-UX-4 | Significant | Memory / Staleness | `fileContents` in local state causes memory leak and stale content |
| IDE-UX-5 | Significant | State persistence | Expanded directories not persisted across restart |
| IDE-UX-6 | Significant | Keyboard UX | `Cmd+S` silently fails when terminal panel is focused |
| IDE-UX-7 | Moderate | Feedback | Copy Path has no success/error feedback |
| IDE-UX-8 | Moderate | Accessibility | File tree nodes not keyboard-navigable |
| IDE-UX-9 | Moderate | Misleading copy | Delete says "cannot be undone" but uses system trash |
| IDE-UX-10 | Moderate | Dead code / Missing feature | Tab reorder action in store but not in UI |
| IDE-UX-11 | Moderate | Dead code | `sidebarWidth`/`terminalHeight` store fields unused |
| IDE-UX-12 | Moderate | Layout | Context menu can render off-screen |
| IDE-UX-13 | Moderate | Performance | All expanded dirs reload on any filesystem change |
| IDE-UX-14 | Moderate | Error handling | Recent folder click fails silently if folder deleted |
| IDE-UX-15 | Low | Accessibility | Context menu has no keyboard navigation |
| IDE-UX-16 | Low | State persistence | 2s debounce with no flush on unmount/close |
| IDE-UX-17 | Low | Staleness | No external file change detection |
| IDE-UX-18 | Low | Ambiguity | Same-named files in different dirs show identical tab labels |
| IDE-UX-19 | Low | Configuration | Hidden directory list is not configurable |
| IDE-UX-20 | Low | Filtering | Hidden items filter only covers directories, not files |

---

## Severity Distribution

| Severity | Count |
|---|---|
| Critical | 0 |
| Significant | 6 |
| Moderate | 8 |
| Low | 6 |
| **Total** | **20** |

---

## Top 5 Quick Wins

| Priority | Finding | Effort | Impact |
|---|---|---|---|
| 1 | IDE-UX-1: Add toast on file read failure instead of empty content | S | Prevents accidental data loss from saving "empty" over real files |
| 2 | IDE-UX-6: Remove `focusedPanel` guard from `Cmd+S` | S | Eliminates silent save failures that confuse users |
| 3 | IDE-UX-9: Fix delete confirmation copy to mention Trash | S | Reduces user anxiety, matches actual behavior |
| 4 | IDE-UX-7: Add toast on Copy Path | S | Completes the feedback loop for a common action |
| 5 | IDE-UX-5: Persist `expandedDirs` in IDE state | S | Eliminates tedious re-expansion after every restart |
