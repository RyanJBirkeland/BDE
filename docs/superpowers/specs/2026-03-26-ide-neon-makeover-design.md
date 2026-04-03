# IDE Neon Makeover — Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Neon treatment for IDE view chrome + sidebar collapse bug fix

---

## Summary

Apply the V2 Neon Design System to the IDE view's layout chrome (sidebar, tab bars, separators, empty state) while leaving the Monaco editor and terminal content surfaces untouched. Also fix a bug where collapsing the sidebar with no open tabs leaves the user stuck with no navigation affordance.

## Design Decisions

| Decision             | Choice                       | Rationale                                                                                    |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| Neon scope           | Chrome only                  | Editor/terminal are productivity surfaces — particles and glows would distract from code     |
| Empty state          | Minimal neon                 | Neon-bg, purple title glow, cyan button. No StatusBar/NeonCard — it's transient              |
| Sidebar collapse fix | Toggle button in editor area | Respects user's collapse preference; `Cmd+B` still works but now there's a visual affordance |
| Particles/scanlines  | No                           | IDE is a focused workspace, not a dashboard                                                  |

## Scope

### Gets neon treatment

1. **File explorer sidebar** (`FileSidebar`, `FileTree`, `FileTreeNode`)
   - Background: `--neon-bg` with slight opacity for depth
   - Border-right: `--neon-purple-border`
   - Header: glass-blur backdrop, purple "EXPLORER" label with text-shadow
   - Active file: cyan left-border + `--neon-cyan-surface` background + cyan text
   - Hover: `--neon-surface-dim` background
   - Folder names: `--neon-text` (white), file names: `--neon-text-muted`
   - Scrollbar thumb: `--neon-purple-border`

2. **Editor tab bar** (`EditorTabBar`)
   - Background: `--neon-bg` with glass-blur
   - Border-bottom: `--neon-purple-border`
   - Active tab: `border-top: 2px solid --neon-cyan`, `--neon-bg` background, `inset 0 2px 8px --neon-cyan-surface` glow
   - Inactive tabs: `--neon-text-dim`, border-right `--neon-surface-dim`
   - Dirty indicator: `--neon-cyan` (was `--bde-accent`)
   - Close button hover: `--neon-surface-subtle` background

3. **Terminal tab bar + toolbar** (`TerminalPanel` → `TerminalTabBar`, `TerminalToolbar`)
   - Same glass-blur pattern as editor tab bar
   - Active terminal tab: cyan dot + `--neon-cyan-surface` background + cyan text
   - Border-top on terminal region: `--neon-purple-border`

4. **Panel separators**
   - Default: `--neon-purple-border` (subtle)
   - Hover/active: `--neon-cyan` with `box-shadow: 0 0 8px --neon-cyan-glow`

5. **Empty state** (`IDEEmptyState`)
   - Background: `--neon-bg`
   - Title: white with `text-shadow: 0 0 12px rgba(191, 90, 242, 0.5)`
   - Subtitle: `--neon-text-muted`
   - Open Folder button: `--neon-cyan` background, dark text, subtle glow on hover
   - Recent folders: `--neon-cyan` text, `--neon-cyan-surface` hover background

6. **Context menus** (`FileContextMenu`)
   - Background: `--neon-bg` or `--neon-surface-deep` with glass-blur
   - Border: `--neon-purple-border`
   - Items: `--neon-text`, hover `--neon-surface-dim`
   - Danger items: `--neon-red`

### Untouched

- Monaco editor surface and syntax highlighting
- Terminal content area (xterm.js)
- Unsaved dialog modal (check if already styled)

## Bug Fix: Sidebar Collapse Affordance

**Problem:** When `sidebarCollapsed: true` and no editor tabs are open, the editor area shows "Open a file from the sidebar to start editing" but the sidebar isn't visible. The user has no visible way to navigate. `Cmd+B` works but isn't discoverable.

**Fix:** When the sidebar is collapsed and the editor area is empty (no active tab), render a small toggle button (`PanelLeftOpen` icon from lucide) in the top-left corner of the editor area. Clicking it calls `toggleSidebar()`.

**Location:** `IDEView.tsx`, inside the `.ide-editor-area` div, rendered conditionally:

```tsx
{
  sidebarCollapsed && !activeTab && (
    <button className="ide-sidebar-toggle" onClick={toggleSidebar}>
      <PanelLeftOpen size={16} />
    </button>
  )
}
```

**Styling:** Positioned absolute, top-left of editor area. `--neon-text-dim` default, `--neon-cyan` on hover with subtle glow. Small and unobtrusive.

## Token Mapping

The neon CSS overrides remap `--bde-*` tokens to `--neon-*` equivalents. Full mapping:

| `ide.css` / `terminal.css` token | Neon replacement        | Context                             |
| -------------------------------- | ----------------------- | ----------------------------------- |
| `--bde-bg`                       | `--neon-bg` (#0a0015)   | View background, editor empty state |
| `--bde-surface`                  | `rgba(10, 0, 21, 0.6)`  | Sidebar, tab bar backgrounds        |
| `--bde-surface-high`             | `--neon-surface-deep`   | Context menu background             |
| `--bde-border`                   | `--neon-purple-border`  | All panel/tab borders               |
| `--bde-text`                     | `--neon-text`           | Primary text                        |
| `--bde-text-muted`               | `--neon-text-muted`     | Secondary text, inactive tabs       |
| `--bde-text-dim`                 | `--neon-text-dim`       | Tertiary text, icons                |
| `--bde-accent`                   | `--neon-cyan`           | Active indicators, dirty dots       |
| `--bde-accent-hover`             | `--neon-cyan-surface`   | Recent folder hover                 |
| `--bde-hover`                    | `--neon-surface-dim`    | Row/item hover backgrounds          |
| `--bde-hover-strong`             | `--neon-surface-subtle` | Close button hover                  |
| `--bde-selected`                 | `--neon-cyan-surface`   | Active file node background         |
| `--bde-danger`                   | `--neon-red`            | Danger context menu items           |
| `--bde-danger-hover`             | `--neon-red-surface`    | Danger item hover                   |

Glass-blur is applied via `backdrop-filter: var(--neon-glass-blur)` (= `blur(16px) saturate(180%)`) on sidebar header, tab bars, and context menus.

## CSS Strategy

Create `ide-neon.css` alongside existing `ide.css`. The new file overrides classes from both `ide.css` and `terminal.css` (terminal tab bar/toolbar classes like `.terminal-tab-bar`, `.terminal-tab`, `.terminal-tab--active::before`, `.terminal-toolbar` live in `terminal.css`, not `ide.css`). Import `ide-neon.css` in `IDEView.tsx`.

Pattern follows established convention: `sprint-pipeline-neon.css`, `agents-neon.css`, `task-workbench-neon.css`.

The existing class names and structure remain — we're reskinning, not restructuring. `FileTree.tsx` and `FileTreeNode.tsx` require no TSX changes; their styling is pure CSS override via existing class names.

### Sidebar toggle button CSS

```css
.ide-sidebar-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--neon-purple-border);
  border-radius: 6px;
  background: var(--neon-surface-deep);
  color: var(--neon-text-dim);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    box-shadow 0.15s;
}
.ide-sidebar-toggle:hover {
  color: var(--neon-cyan);
  border-color: var(--neon-cyan-border);
  box-shadow: 0 0 8px rgba(0, 255, 200, 0.15);
}
```

### Inline style note

`FileSidebar.tsx` line 84-89 has an inline style using `var(--bde-size-sm)` and `var(--bde-text-dim)` for the "No folder open" message. This is a minor edge case — the `--bde-*` font-size token still works, and the text-dim color is close enough. No component change needed.

## Files Changed

| File                                                | Change                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/src/assets/ide-neon.css`              | **New** — neon overrides for IDE chrome classes (from `ide.css`) and terminal chrome classes (from `terminal.css`) |
| `src/renderer/src/views/IDEView.tsx`                | Import `ide-neon.css`, add sidebar toggle button with `PanelLeftOpen` icon                                         |
| `src/renderer/src/components/ide/IDEEmptyState.tsx` | Neon styling for empty state (CSS class changes only)                                                              |

No changes needed to `FileTree.tsx`, `FileTreeNode.tsx`, `EditorTabBar.tsx`, `TerminalPanel.tsx`, `TerminalTabBar.tsx`, or `TerminalToolbar.tsx` — all styling is via CSS overrides.

## Out of Scope

- Neon component library usage (NeonCard, StatusBar, etc.) — the IDE chrome is simpler than dashboard; CSS overrides are sufficient
- Monaco theme changes — editor theming is its own concern
- Terminal content theming — xterm.js has its own theme config
- Keyboard shortcut changes — existing shortcuts remain
