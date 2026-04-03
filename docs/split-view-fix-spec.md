# BDE — Sessions Split View Fix + Toolbar Redesign Spec

**Date:** 2026-03-16
**Branch:** feat/sessions-split-fix
**Reference:** docs/visual-identity-spec.md (already in repo)

---

## Problems

### 1. Toolbar icons overlapping content (top-right corner)

`.sessions-split-toolbar` is `position: absolute; top: 8; right: 12` inside `.sessions-chat__main` which has no `position: relative`. In single mode the 3 icons float over the SessionHeader text. In split modes they overlap the pane headers.

### 2. Split views not working — panes start empty

When switching from single → 2-pane or grid-4, `splitPanes[0..3]` are all `null`. The `setSplitMode` action in `splitLayout.ts` does NOT auto-populate pane 0 from the currently selected session. So both panes immediately show "Select a session or spawn an agent" empty state. The user has to manually re-select a session via the dropdown inside each pane.

---

## Fix 1: Toolbar — move out of absolute positioning

### Current (SessionsView.tsx ~line 319)

```tsx
<div className="sessions-chat__main">
  <div
    className="sessions-split-toolbar"
    style={{ position: 'absolute', top: 8, right: 12, zIndex: 5 }}
  >
    ...buttons...
  </div>
  {renderMainContent()}
</div>
```

### Fix

Replace with a proper header bar. Remove the inline `style` entirely. Give the main area a flex column layout with a dedicated top bar:

```tsx
<div className="sessions-chat__main">
  <div className="sessions-main__topbar">
    <div className="sessions-main__topbar-spacer" />
    <div className="sessions-split-toolbar">
      {SPLIT_MODES.map(({ mode, icon: Icon, title }) => (
        <button
          key={mode}
          className={`sessions-split-btn${splitMode === mode ? ' sessions-split-btn--active' : ''}`}
          title={title}
          onClick={() => handleSplitModeChange(mode)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  </div>
  {renderMainContent()}
</div>
```

CSS for the topbar (add to sessions.css):

```css
.sessions-main__topbar {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  /* Glass treatment — double down */
  background: rgba(10, 10, 15, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Remove the old absolute positioning — toolbar is now in flow */
.sessions-split-toolbar {
  display: flex;
  gap: 4px;
  /* remove any position: absolute */
}
```

Upgrade the split mode buttons to glass style while we're here:

```css
.sessions-split-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease-out;
  backdrop-filter: blur(4px);
}

.sessions-split-btn:hover {
  border-color: var(--border-light);
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.sessions-split-btn--active {
  border-color: rgba(0, 211, 127, 0.4);
  color: var(--accent);
  background: rgba(0, 211, 127, 0.08);
  box-shadow: 0 0 8px rgba(0, 211, 127, 0.15);
}
```

---

## Fix 2: Auto-populate split panes on mode switch

### Current problem (splitLayout.ts)

`setSplitMode` sets the mode but never seeds pane 0 with the current session:

```ts
setSplitMode: (mode) => {
  set({ splitMode: mode }) // splitPanes stay [null, null, null, null]
}
```

### Fix — in SessionsView.tsx

Replace the direct `setSplitMode(mode)` calls with a handler that pre-populates panes:

```tsx
// Add this handler in SessionsView (inside the component, near the other callbacks)
const handleSplitModeChange = useCallback(
  (mode: SplitMode): void => {
    if (mode === 'single') {
      setSplitMode('single')
      return
    }
    // Pre-populate pane 0 with currently selected session
    if (selectedKey && splitPanes[0] === null) {
      setPaneSession(0, selectedKey)
    }
    setSplitMode(mode)
  },
  [selectedKey, splitPanes, setSplitMode, setPaneSession]
)
```

Replace the 3 keyboard shortcut `setSplitMode(...)` calls AND the toolbar button `onClick={() => setSplitMode(mode)}` with `handleSplitModeChange(mode)`.

This ensures that when you click the 2-pane or grid-4 button, pane 0 immediately shows the session you were already viewing.

---

## Fix 3: Single mode topbar — show session name (bonus polish)

In single mode, the topbar has empty space on the left. Fill it with the current session name:

```tsx
<div className="sessions-main__topbar">
  {splitMode === 'single' && selectedKey && (
    <span className="sessions-main__session-label">
      {selectedSession?.displayName || selectedSubAgent?.label || selectedKey}
    </span>
  )}
  <div className="sessions-main__topbar-spacer" />
  <div className="sessions-split-toolbar">...</div>
</div>
```

```css
.sessions-main__session-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.sessions-main__topbar-spacer {
  flex: 1;
}
```

---

## Files to Change

| File                                      | Changes                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/views/SessionsView.tsx` | Add `handleSplitModeChange` callback; replace all `setSplitMode(mode)` in toolbar + keyboard shortcuts with it; restructure main area JSX to use `.sessions-main__topbar` instead of `position:absolute` toolbar        |
| `src/renderer/src/assets/sessions.css`    | Add `.sessions-main__topbar`, `.sessions-main__session-label`, `.sessions-main__topbar-spacer`; upgrade `.sessions-split-btn` to glass style; remove any lingering absolute-position rules on `.sessions-split-toolbar` |

---

## Out of Scope

- Redesigning ChatPane or MiniChatPane internals
- Persisting splitPanes to localStorage
- Adding session-picker UX inside panes (already exists via select dropdown)

---

## Success Criteria

- [ ] Split mode buttons sit in a proper 36px header bar — no overlap with content
- [ ] Switching to 2-pane auto-populates pane 0 with the active session
- [ ] Switching to grid-4 auto-populates pane 0 with the active session
- [ ] Active split button has green glass highlight
- [ ] Single mode topbar shows current session name on the left
- [ ] All keyboard shortcuts (Cmd+Shift+1/2/4) still work
- [ ] npm test passes
