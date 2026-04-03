# TerminalView Refactor Spec

**Date:** 2026-03-16
**Branch:** feat/terminal-refactor
**Goal:** Break TerminalView from 446 LOC into focused sub-components, eliminate ~350 lines of inline styles, apply glass/gradient visual identity to match Sprint Center quality.

---

## Problems

1. `TerminalView.tsx` is 446 LOC — tab bar, toolbar, content, and agent output tab all in one file
2. ~350 lines use inline `style={{...}}` objects — recreated on every render, defeats React reconciliation, can't use design tokens
3. No glass morphism — Terminal looks like a prototype compared to Sprint Center and Sessions
4. All tabs mounted simultaneously (even hidden ones) — each holds an xterm.js PTY buffer

---

## Sub-component Split

### Before (1 file, 446 LOC)

`TerminalView.tsx` — everything

### After (4 files)

| File                                      | LOC target | Responsibility                                              |
| ----------------------------------------- | ---------- | ----------------------------------------------------------- |
| `views/TerminalView.tsx`                  | ~80        | Orchestration only: state, handlers, compose sub-components |
| `components/terminal/TerminalTabBar.tsx`  | ~80        | Tab pills, new tab button, close buttons                    |
| `components/terminal/TerminalToolbar.tsx` | ~60        | Shell picker, find bar toggle, split button                 |
| `components/terminal/TerminalContent.tsx` | ~80        | Routes to correct pane or agent output tab                  |

Existing files that stay unchanged: `TerminalPane.tsx`, `AgentOutputTab.tsx`, `FindBar.tsx`

---

## CSS — Extract All Inline Styles

Create `src/renderer/src/assets/terminal.css` (or add to existing terminal section in base.css).

All inline `style={{...}}` in TerminalView removed and replaced with class names.

### Key Styles to Extract

```css
/* Tab bar */
.terminal-tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 8px;
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--size-sm);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.terminal-tab:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.terminal-tab--active {
  background: var(--glass-tint);
  border-color: var(--border-light);
  color: var(--text);
}
/* Active tab gets subtle green accent */
.terminal-tab--active::before {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.terminal-tab__close {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.1s,
    background 0.1s;
}
.terminal-tab:hover .terminal-tab__close,
.terminal-tab--active .terminal-tab__close {
  opacity: 1;
}
.terminal-tab__close:hover {
  background: var(--surface-hover);
  color: var(--text);
}

/* Toolbar */
.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-sm) var(--glass-saturate);
  flex-shrink: 0;
}

.terminal-shell-select {
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.terminal-shell-select:focus {
  border-color: var(--accent);
  outline: none;
}

/* New tab button */
.terminal-new-tab-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}
.terminal-new-tab-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(0, 211, 127, 0.06);
}

/* Content area */
.terminal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background: var(--bg);
}

/* Header title bar for TerminalView */
.terminal-view__header {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  flex-shrink: 0;
}
.terminal-view__title {
  background: var(--gradient-aurora);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
```

---

## Files to Change

| File                                          | Action      | What                                                                     |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `src/views/TerminalView.tsx`                  | **REWRITE** | ~80 LOC orchestrator; all inline styles removed; composes sub-components |
| `src/components/terminal/TerminalTabBar.tsx`  | **CREATE**  | Tab pills, new tab button, active dot indicator                          |
| `src/components/terminal/TerminalToolbar.tsx` | **CREATE**  | Shell picker dropdown, find bar toggle, keyboard shortcut hints          |
| `src/components/terminal/TerminalContent.tsx` | **CREATE**  | Routes active tab → TerminalPane or AgentOutputTab                       |
| `src/renderer/src/assets/terminal.css`        | **CREATE**  | All terminal styles (above)                                              |

---

## Out of Scope

- Tab virtualization / unmounting idle PTYs (separate story)
- xterm.js theme changes
- New terminal features (split panes, etc.)
- TerminalPane or AgentOutputTab internals

---

## Success Criteria

- [ ] TerminalView.tsx ≤ 100 LOC
- [ ] Zero inline `style={{}}` in any terminal component
- [ ] Tab bar has glass background + active green dot
- [ ] Toolbar has glass background + shell selector with focus ring
- [ ] "TERMINAL" aurora gradient title in header
- [ ] Visual output identical to current (no behavior changes)
- [ ] npm test passes
