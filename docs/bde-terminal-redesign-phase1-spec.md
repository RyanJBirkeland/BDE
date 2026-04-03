# BDE Terminal Redesign — Implementation Spec

**Project:** bde  
**Branch:** `feat/terminal-redesign`  
**Status:** Ready to build  
**Date:** 2026-03-15  
**Sources:** bde-terminal-ux-spec.md + bde-terminal-product-spec.md

---

## The Point

BDE's terminal isn't a generic xterm embed — it's an **execution monitor for AI agents**. Every command an agent runs should be visible, navigable, and actionable. The human is the orchestrator. The terminal is where agent intent meets machine execution.

Current state: functional prototype. Missing table-stakes features (search, keyboard shortcuts, split panes) and the agent-aware layer entirely.

---

## Phase 1 — Ship This PR

### What we're building

1. **Tab bar redesign** — status dots, rename, overflow scroll, process exit state
2. **Keyboard shortcuts** — Cmd+T, Cmd+W, Cmd+Shift+[/], Cmd+F, Cmd+K (clear), font zoom
3. **Empty state** — shell buttons, no more black void
4. **Find in terminal** — Cmd+F via xterm SearchAddon
5. **Shell picker** — choose zsh/bash/node/python when creating tabs
6. **Toolbar** — clear, copy all, split, kill (32px, compact)
7. **Split panes** — horizontal (Cmd+D), react-resizable-panels
8. **Agent output tabs** — read-only tabs for agent exec activity (polling fallback)
9. **Pane status bar** — shell, cwd, dimensions (24px)

---

## Full Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Tab Bar (36px)                                               [+ ▾]  │
│ [🟢 zsh ~/BDE ×] [  node ~/feast ×] [⚪ exited ×] [🔵 feat/auth →] │
├─────────────────────────────────────────────────────────────────────┤
│ Toolbar (32px, compact — full actions on hover)                     │
│                             [⌕] [⊞ Split ▾] [Clear] [Copy] [Kill] │
├──────────────────────────────────┬──────────────────────────────────┤
│  Terminal Pane A                 │  Terminal Pane B (if split)      │
│                                  │                                  │
│  $ npm run dev                   │  $ tail -f /tmp/bde-agents/*.log │
│  ▋                               │  ▋                               │
│                                  │                                  │
├──────────────────────────────────┴──────────────────────────────────┤
│ Pane Status Bar (24px): zsh • ~/BDE • 80×24                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Store Changes

### `stores/terminal.ts` — expand existing

```ts
interface TerminalTab {
  id: string
  label: string
  isLabelCustom: boolean       // user renamed this tab
  ptyId: number | null
  shell: string                // shell path used to spawn
  status: 'running' | 'exited'
  hasUnread: boolean           // new output while tab not focused
  isAgentTab: boolean          // NEW: read-only agent output tab
  agentSessionKey?: string     // which session this tab monitors
  panes: TerminalPane[]        // split pane support
  activePaneId: string
}

interface TerminalPane {
  id: string
  ptyId: number | null
  shell: string
  status: 'running' | 'exited'
  cwd: string
  cols: number
  rows: number
}

// New store actions:
renameTab: (id: string, label: string) => void
reorderTab: (fromIdx: number, toIdx: number) => void
splitPane: (tabId: string, direction: 'horizontal' | 'vertical') => void
closePane: (tabId: string, paneId: string) => void
setActivePane: (tabId: string, paneId: string) => void
setTabStatus: (tabId: string, status: 'running' | 'exited') => void
setUnread: (tabId: string, hasUnread: boolean) => void
zoomIn: () => void
zoomOut: () => void
resetZoom: () => void
fontSize: number               // default 13, range 10–20
```

---

## New IPC Channels

Add to `src/main/index.ts` + `src/preload/index.ts`:

| Channel            | Args               | Returns     | Purpose                               |
| ------------------ | ------------------ | ----------- | ------------------------------------- |
| `terminal:clear`   | `{ ptyId }`        | void        | Clear PTY scrollback                  |
| `terminal:getCwd`  | `{ ptyId }`        | `string`    | Query PTY's current working directory |
| `terminal:restart` | `{ ptyId, shell }` | `{ ptyId }` | Kill + respawn shell                  |
| `terminal:create`  | `{ shell?, cwd? }` | `{ ptyId }` | Extend existing to accept shell + cwd |

---

## Component Changes

### `views/TerminalView.tsx`

- Wire all new store actions
- Handle split pane layout via `react-resizable-panels` (already installed)
- Agent tab polling: every 5s, call `window.api.getSessionHistory(sessionKey)`, extract `exec` tool results, append to read-only terminal buffer
- Keyboard handler for all new shortcuts (scoped to terminal view focus)

### `components/terminal/TabBar.tsx` ← **new component** (extract from TerminalView)

Tab anatomy:

```
[● label ×]
 │   │   └─ close: 16px, hover-reveal only (except active tab)
 │   └─ label: editable on double-click (inline input, Enter/Esc)
 └─ status dot: 8px
      🟢 #00D37F = running
      ⚪ #555555 = exited
      🔵 #3B82F6 = has unread output
      🤖 #a78bfa = agent tab (purple — matches AI color in ChatThread)
```

Behaviors:

- Middle-click to close
- Right-click context menu: Rename, Duplicate, Close Others, Close All
- Overflow: show ← → scroll arrows when tabs exceed container width
- Drag to reorder (HTML5 drag-and-drop, no extra dep)
- Agent tabs: read-only badge, slightly different styling (purple dot, italic label)

### `components/terminal/Toolbar.tsx` ← **new component**

32px height. Compact by default (search + split icons only, right-aligned). Full toolbar revealed on hover:

```
[Search ⌕] [Split ▾] [Clear 🗑] [Copy All ⎘] [Kill ⌀]
```

Split dropdown: "Split Right (⌘D)" / "Split Down (⌘⇧D)"

### `components/terminal/EmptyState.tsx` ← **new component**

```
        ┌──────────┐
        │  >_      │   48px icon, textDim
        └──────────┘

   No terminals open

  Press ⌘T to open a new terminal
      or choose a shell:

  [zsh]  [bash]  [node]  [python3]
```

Shell buttons: ghost style, hover turns accent green.

### `components/terminal/ShellPicker.tsx` ← **new component**

Dropdown from the ▾ next to + in tab bar:

```
Default Shell   ⌘T
─────────────────
zsh
bash
fish
─────────────────
node
python3
─────────────────
Custom…
```

Custom: opens an inline input for arbitrary command.

### `components/terminal/PaneStatusBar.tsx` ← **new component**

24px strip below each pane: `{shell} • {cwd} • {cols}×{rows}`
CWD updated via OSC escape codes or polling `terminal:getCwd` every 3s.

### `components/terminal/FindBar.tsx` ← **new component**

Uses `xterm-addon-search`. Appears inline at top of pane on Cmd+F:

```
[🔍 Search...____________]  [↑] [↓]  3 of 17  [×]
```

---

## Agent Output Tabs (T-01)

Agent tabs are created when:

1. User clicks "Watch Agent Output" from Sessions context menu → `createAgentTab(sessionKey)`
2. (Future) Auto-created when agent spawns exec subprocess

Implementation (polling fallback — no gateway PTY streaming yet):

```ts
// In TerminalView, when agentTab is active:
useEffect(() => {
  if (!tab.isAgentTab || !tab.agentSessionKey) return
  const interval = setInterval(async () => {
    const history = await window.api.getSessionHistory(tab.agentSessionKey)
    const execResults = extractExecResults(history) // parse exec tool results
    appendToAgentBuffer(tab.id, execResults)
  }, 5000)
  return () => clearInterval(interval)
}, [tab])
```

Agent tab visual treatment:

- Purple dot (🤖) instead of green
- Italic label: `feat/auth → exec`
- Read-only: keyboard input disabled, xterm in read-only mode
- "🤖 Agent Output" badge in pane status bar instead of shell name

---

## Keyboard Shortcuts

Add to `TerminalView.tsx` keydown handler (scoped: only when terminal view is focused):

| Shortcut      | Action                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| `Cmd+T`       | New tab (default shell)                                                 |
| `Cmd+W`       | Close active pane (or tab if last pane)                                 |
| `Cmd+Shift+[` | Previous tab                                                            |
| `Cmd+Shift+]` | Next tab                                                                |
| `Cmd+F`       | Find in terminal                                                        |
| `Ctrl+L`      | Clear terminal (use Ctrl+L not Cmd+K — avoids command palette conflict) |
| `Cmd+Shift+C` | Copy all scrollback                                                     |
| `Cmd+D`       | Split pane right                                                        |
| `Cmd+Shift+D` | Split pane down                                                         |
| `Cmd+Opt+←/→` | Navigate between split panes                                            |
| `Cmd+=`       | Font size +1                                                            |
| `Cmd+-`       | Font size -1                                                            |
| `Cmd+0`       | Reset font size                                                         |

**Conflict resolution:** `Cmd+1–7` switches views globally. Inside terminal view with a pane focused, do NOT intercept `Cmd+1–7` — let them switch views as normal. Terminal tab switching uses `Cmd+Shift+[/]` only.

---

## New Dependencies

```bash
npm install xterm-addon-search
```

`react-resizable-panels` and `@dnd-kit/sortable` already installed. Use native HTML5 drag-and-drop for tab reorder (no extra dep).

---

## Files to Change

| File                                                     | What changes                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/renderer/src/stores/terminal.ts`                    | Expand with all new state + actions                                      |
| `src/renderer/src/views/TerminalView.tsx`                | Full refactor — wire new components, keyboard handler, agent tab polling |
| `src/renderer/src/components/terminal/TabBar.tsx`        | **New** — extracted + redesigned tab bar                                 |
| `src/renderer/src/components/terminal/Toolbar.tsx`       | **New** — clear/copy/split/kill toolbar                                  |
| `src/renderer/src/components/terminal/EmptyState.tsx`    | **New** — empty state with shell buttons                                 |
| `src/renderer/src/components/terminal/ShellPicker.tsx`   | **New** — shell picker dropdown                                          |
| `src/renderer/src/components/terminal/PaneStatusBar.tsx` | **New** — pane footer with shell/cwd/size                                |
| `src/renderer/src/components/terminal/FindBar.tsx`       | **New** — xterm-addon-search UI                                          |
| `src/renderer/src/assets/terminal.css`                   | Full redesign — all new component styles                                 |
| `src/main/index.ts`                                      | Add terminal:clear, terminal:getCwd, terminal:restart IPC handlers       |
| `src/preload/index.ts`                                   | Expose new terminal IPC + getSessionHistory                              |
| `src/preload/index.d.ts`                                 | Type declarations                                                        |

---

## CSS Token Reference

Use these exact values from `src/renderer/src/design-system/tokens.ts`:

```
Tab bar / toolbar bg:  tokens.color.surface      (#111111)
Active tab bg:         tokens.color.bg           (#0A0A0A)
Borders:               tokens.color.border        (#2A2A2A)
Hover borders:         tokens.color.borderHover   (#3A3A3A)
Accent:                tokens.color.accent        (#00D37F)
Accent bg:             tokens.color.accentDim     (rgba(0,211,127,0.15))
Text primary:          tokens.color.text          (#E8E8E8)
Text muted:            tokens.color.textMuted     (#888888)
Text dim:              tokens.color.textDim       (#555555)
Surface high:          tokens.color.surfaceHigh   (#1A1A1A)
UI font:               tokens.font.ui
Code font:             tokens.font.code           (JetBrains Mono)
Font size sm:          tokens.size.sm             (12px)
Font size xs:          tokens.size.xs             (11px)
Transition fast:       tokens.transition.fast     (100ms ease)
Transition base:       tokens.transition.base     (150ms ease)
```

---

## Out of Scope (Phase 2)

- Command blocks / intelligent output parsing
- Cmd+I inline AI assistance
- Process monitor strip
- Terminal profiles
- Broadcast mode
- Output snapshotting
- Right-click context menu (use toolbar for now)
- Tab → pane drag-and-drop
- Vertical splits (horizontal only in Phase 1)

---

## PR Requirements

Per CLAUDE.md: include ASCII art of:

1. Tab bar (running tab, exited tab, agent tab)
2. Empty state
3. Toolbar (compact + expanded)
4. Split pane layout
5. Find bar
