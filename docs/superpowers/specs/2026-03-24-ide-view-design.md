# IDE View Design Spec

## Summary

Replace BDE's Terminal view (⌘3) with a full IDE view combining a file explorer sidebar, tabbed Monaco code editor, and integrated terminal panel. This upgrades BDE from a development environment dashboard into a true IDE.

## Scope

**In scope (v1):**
- Monaco editor with syntax highlighting, find/replace, multi-cursor, minimap
- File explorer sidebar with lazy-loaded directory tree
- Integrated terminal panel (reuses existing xterm.js/node-pty implementation)
- File I/O (open, edit, save) for any directory on the user's machine
- File watching for external changes
- Light/dark theme sync with Monaco
- Persist open folder, tabs, and layout state across restarts

**Out of scope (future):**
- LSP / language-aware autocomplete
- ⌘P quick-open file picker
- Find across files (⌘Shift+F)
- Git gutter indicators (modified/added/deleted lines)
- Extensions or plugin system
- Debugger integration

## Layout

```
┌──────────┬─────────────────────────────────────┐
│          │  EditorTabBar [file1.ts] [file2.tsx] │
│  File    ├─────────────────────────────────────┤
│  Explorer│                                     │
│          │         Monaco Editor               │
│  (tree)  │                                     │
│          │                                     │
│  240px   │                                     │
│  default ├─────────────────────────────────────┤
│  resize- │  TerminalTabBar [zsh] [node]        │
│  able    ├─────────────────────────────────────┤
│          │         Terminal (xterm.js)          │
│          │         (existing implementation)   │
└──────────┴─────────────────────────────────────┘
```

- All zones separated by `react-resizable-panels` (existing dependency)
- Sidebar: collapsible via ⌘B, default 240px, remembers last width
- Terminal panel: collapsible via ⌘J, default 35% of vertical space
- Editor area gets all remaining space
- Empty state shown when no folder is open ("Open a folder to get started")

## File Explorer Sidebar

### Behavior
- User opens any folder via "Open Folder" button or ⌘O (reuses existing `fs:openDirectoryDialog` IPC channel)
- Lazy loading — only reads children when a folder is expanded
- File watching via `fs.watch` (recursive on macOS), 500ms debounce
- Default hidden directories: `node_modules`, `.git`, `dist`, `build`, `.next` (toggleable)
- Current open file highlighted in tree
- Unsaved indicator (●) next to dirty files

### Context Menu (right-click)
- New File
- New Folder
- Rename
- Delete (moves to Trash via `shell.trashItem`)
- Copy Path
- Reveal in Finder

### Tree UI
- Folder expand/collapse on click
- File click opens in editor
- File type icons via `lucide-react`
- Sorted: folders first, then files, both alphabetical
- ARIA: `role="tree"` on container, `role="treeitem"` on nodes, `aria-expanded` on folders
- Keyboard navigation: arrow keys for tree traversal, Enter to open/expand, Delete to trash

### Accessibility
- Editor tab bar: `role="tablist"` / `role="tab"` (matches existing terminal tab bar pattern)
- UnsavedDialog: uses existing `useConfirm` / `ConfirmModal` pattern (`role="dialog"`, `aria-modal`)

## Editor Area (Monaco)

### Tab Bar
- Tabs show filename, tooltip shows full path
- ● indicator for unsaved changes, × close button
- Click to switch, middle-click to close
- Drag to reorder
- Horizontal scroll on overflow
- Unsaved close triggers save/discard/cancel dialog

### Monaco Integration
- Single Monaco editor instance, swap `ITextModel` per tab
- Models persist undo history, cursor position, scroll position per file
- Models are disposed when their tab is closed. No cap needed — users typically have <20 tabs open
- Language auto-detected from file extension
- Custom Monaco theme mapped from BDE CSS variables (light/dark)
- Theme syncs live when user toggles BDE theme

### Keybindings
| Shortcut | Action |
|----------|--------|
| ⌘S | Save current file |
| ⌘W | Close current editor tab (when editor focused), close terminal tab (when terminal focused) |
| ⌘F | Find in file (Monaco built-in, when editor focused), find in terminal (when terminal focused) |
| ⌘Z / ⌘Shift+Z | Undo / redo (Monaco built-in) |
| ⌘B | Toggle sidebar |
| ⌘J | Toggle terminal panel |
| ⌘O | Open folder |

### Shortcut Focus Precedence
Overlapping shortcuts (⌘W, ⌘F) are resolved by which panel has focus. The IDE view tracks a `focusedPanel: 'editor' | 'terminal'` state. Clicking in the editor or terminal sets focus. The IDEView keyboard handler checks `focusedPanel` before dispatching. Monaco handles its own ⌘F internally when focused, so the IDE only needs to intercept ⌘F for the terminal case.

Terminal-specific shortcuts from the old TerminalView (⌘T new tab, ⌘D split, zoom, etc.) are migrated to IDEView and scoped to `focusedPanel === 'terminal'`.

### Built-in Monaco Features (no custom code needed)
- Syntax highlighting (70+ languages)
- Find/replace with regex
- Multi-cursor editing
- Bracket matching and auto-close
- Code folding
- Minimap
- Line numbers and indentation guides
- Word wrap toggle

### Vite Bundling
- Use `@monaco-editor/react` wrapper for React lifecycle management (mount/unmount, model switching)
- Configure Monaco workers via Vite's native worker support (`import ... from 'monaco-editor/esm/vs/editor/editor.worker?worker'`) — avoids dependency on `vite-plugin-monaco-editor` which has compatibility issues with Vite 7
- If native worker config proves problematic, fall back to `vite-plugin-monaco-editor` or CDN-loaded workers via `@monaco-editor/react`'s `loader` config
- Workers handle language tokenization in background threads
- Adds ~3MB to bundle (acceptable for Electron)

### Constraints
- Files > 5MB refused (toast notification instead)
- Binary files detected by checking for null bytes in the first 8KB of the file (`fs:readFile` handler checks before returning content). Files with null bytes show a toast: "Cannot open binary file"
- Atomic writes (temp file + rename) to prevent corruption

## Terminal Integration

### What stays the same
- Terminal Zustand store (`stores/terminal.ts`) — no changes
- Most terminal components — TerminalPane, TerminalTabBar, TerminalToolbar, FindBar, ShellPicker, AgentPicker, AgentOutputTab, EmptyState — no changes
- All terminal IPC channels and PTY backend — no changes
- Terminal CSS — no changes

### Minor terminal component change
- `TerminalContent.tsx` currently hardcodes `activeView === 'terminal'` for the xterm `visible` prop. This must be updated to accept a `visible` boolean prop from the parent (or check for `'ide'` instead). This is a ~3 line change.

### What changes
- Terminal content moves from standalone view into IDE's bottom panel via a thin `TerminalPanel` wrapper
- Auto-creates a shell tab with `cwd` set to the IDE's open folder when a folder is opened
- ⌘J toggles terminal panel visibility

### Migration
- `TerminalView.tsx` deleted, replaced by `IDEView.tsx`
- ⌘3 shortcut maps to `'ide'` view type
- `panelLayout.ts` view type: `'terminal'` → `'ide'`, label: "IDE"

## File System Backend

### New handler module: `src/main/handlers/fs-handlers.ts`

All handlers use `safeHandle()` wrapper per BDE convention.

### IPC Channels

Note: An `FsChannels` interface already exists in `ipc-channels.ts` (defining `fs:openFileDialog`, `fs:readFileAsBase64`, `fs:readFileAsText`, `fs:openDirectoryDialog`). The new channels below will be added to that existing interface. The existing `fs:readFileAsText` returns `{ content, name }` and is used elsewhere — keep it. The new `fs:readFile` is a simpler variant optimized for the editor (returns raw string, includes binary/size guards). The existing `window.api.fs` preload namespace will be extended with the new channel methods.

```typescript
// Added to existing FsChannels interface
interface FsChannels {
  // ... existing channels (fs:openFileDialog, fs:readFileAsText, etc.) ...

  'fs:readDir': {
    args: [dirPath: string]
    result: { name: string; type: 'file' | 'directory'; size: number }[]
  }
  'fs:readFile': {
    args: [filePath: string]
    result: string  // UTF-8 content, with binary/size guards
  }
  'fs:writeFile': {
    args: [filePath: string, content: string]
    result: void
  }
  'fs:watchDir': {
    args: [dirPath: string]
    result: void
  }
  'fs:unwatchDir': {
    args: []
    result: void
  }
  'fs:createFile': {
    args: [filePath: string]
    result: void
  }
  'fs:createDir': {
    args: [dirPath: string]
    result: void
  }
  'fs:rename': {
    args: [oldPath: string, newPath: string]
    result: void
  }
  'fs:delete': {
    args: [targetPath: string]
    result: void
  }
  'fs:stat': {
    args: [targetPath: string]
    result: { size: number; mtime: number; isDirectory: boolean }
  }
}
```

### Security
- **Trust boundary:** The user chooses a folder via `dialog.showOpenDialog` (Electron native dialog) or by restoring a persisted `rootPath`. Once a root is set, all `fs:` operations are allowed on paths within that root. Paths outside the root are rejected. This uses `path.resolve()` + `startsWith()` check (after symlink resolution) to prevent traversal.
- `fs:delete` uses `shell.trashItem()` — never `rm`
- `fs:writeFile` uses atomic write (write to temp, rename)
- `fs:readFile` rejects files > 5MB
- No shell interpolation — uses Node.js `fs` APIs directly

### File Watching
- `fs.watch` with recursive option on open root directory
- 500ms debounce, sends `fs:dirChanged` IPC event to renderer with affected path
- `fs:dirChanged` is a push event (main → renderer), registered via `ipcMain.emit` / `webContents.send`, with a corresponding `window.api.fs.onDirChanged(callback)` listener in the preload bridge
- Renderer re-reads only the affected directory
- One watcher at a time (opening new folder closes old watcher)

## State Management

### New store: `src/renderer/src/stores/ide.ts`

```typescript
interface EditorTab {
  id: string           // unique identifier
  filePath: string     // absolute path
  displayName: string  // filename for tab label
  language: string     // Monaco language ID
  isDirty: boolean     // has unsaved changes
}

interface IDEState {
  rootPath: string | null
  expandedDirs: Record<string, boolean>
  openTabs: EditorTab[]
  activeTabId: string | null
  focusedPanel: 'editor' | 'terminal'  // for shortcut precedence
  sidebarCollapsed: boolean
  terminalCollapsed: boolean
  sidebarWidth: number
  terminalHeight: number
  recentFolders: string[]
}
```

Uses `Record<string, boolean>` for expandedDirs (not `Map`) per BDE's Zustand convention.

### What lives outside the store
- Monaco models (managed by Monaco API)
- File contents (in Monaco models, not duplicated)
- Cursor/scroll positions (Monaco tracks per-model)

### Persistence
- `rootPath`, `openTabs`, `activeTabId`, `sidebarCollapsed`, `terminalCollapsed`, `recentFolders` persist to BDE settings table
- Persistence is debounced (2 seconds after last change) to avoid excessive SQLite writes during rapid tab switching or editing
- On restart: reopen persisted folder, restore tabs (re-read files from disk)
- `expandedDirs` does NOT persist — starts collapsed on reopen

### Interaction with existing stores
- Terminal store: unchanged, IDE view renders terminal components that read from `useTerminalStore`
- Theme store: IDE view subscribes to sync Monaco theme on toggle
- No coupling to sprint, agent, or cost stores

## Component Architecture

### New Files (~1500-2000 lines total)

```
src/renderer/src/
├── views/
│   └── IDEView.tsx                    — top-level layout (replaces TerminalView.tsx)
├── stores/
│   └── ide.ts                         — Zustand store
├── components/
│   └── ide/
│       ├── FileSidebar.tsx            — sidebar container (header + tree)
│       ├── FileTree.tsx               — recursive tree renderer
│       ├── FileTreeNode.tsx           — single file/folder row
│       ├── FileContextMenu.tsx        — right-click menu
│       ├── EditorTabBar.tsx           — editor tab strip
│       ├── EditorPane.tsx             — Monaco wrapper (mount, models, theme)
│       ├── TerminalPanel.tsx          — thin wrapper for existing terminal components
│       ├── IDEEmptyState.tsx          — "Open a folder to get started"
│       └── UnsavedDialog.tsx          — save/discard/cancel on close
├── lib/
│   └── monaco-theme.ts               — BDE CSS vars → Monaco theme mapping
└── assets/
    └── ide.css                        — IDE-specific styles

src/main/
└── handlers/
    └── fs-handlers.ts                 — file system IPC handlers
```

### Modified Files (~80 lines of changes)
- `src/renderer/src/stores/panelLayout.ts` — `'terminal'` → `'ide'` in View union and VIEW_LABELS
- `src/renderer/src/App.tsx` — update `VIEW_SHORTCUT_MAP` (key `'3'` → `'ide'`), `VIEW_TITLES` record, and view routing/lazy import
- `src/renderer/src/stores/ui.ts` — re-exports `View` type, no code change needed but consumers affected
- `src/renderer/src/components/terminal/TerminalContent.tsx` — change hardcoded `activeView === 'terminal'` to accept `visible` prop (~3 lines)
- `src/shared/ipc-channels.ts` — add new channels to existing `FsChannels` interface
- `src/main/index.ts` — register fs-handlers
- `src/preload/index.ts` — extend existing `window.api.fs` bridge with new channels + `onDirChanged` listener
- `CLAUDE.md` — update Architecture Notes: "Terminal (⌘3)" → "IDE (⌘3)" in views list

### Deleted Files
- `src/renderer/src/views/TerminalView.tsx`

### Unchanged
- All files in `src/renderer/src/components/terminal/` except `TerminalContent.tsx` (minor prop change) — reused as-is
- `src/renderer/src/stores/terminal.ts` — no changes
- `src/main/handlers/terminal-handlers.ts` — no changes
- `src/main/pty.ts` — no changes

## Dependencies

### New npm packages
- `monaco-editor` (~3MB) — the code editor engine
- `@monaco-editor/react` — React wrapper for Monaco (handles mount/unmount lifecycle)

### Existing (no changes)
- `react-resizable-panels` — layout splits
- `xterm` + addons — terminal
- `node-pty` — shell spawning
- `lucide-react` — icons

## Effort Estimate

| Component | Effort |
|-----------|--------|
| File explorer sidebar | Medium |
| Monaco integration + Vite config | Small-Medium |
| File I/O IPC handlers | Small |
| IDE layout (sidebar + editor + terminal) | Medium |
| Terminal migration into IDE panel | Small |
| State management + persistence | Small |
| Tests | Medium |
| **Total** | **~1500-2000 lines, manageable in focused work** |
