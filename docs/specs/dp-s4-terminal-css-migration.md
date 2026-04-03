# DP-S4: Terminal View CSS Migration

**Epic:** Design Polish
**Priority:** P1 (prerequisite — unblocks DP-S5)

---

## Problem

`TerminalView.tsx` is the only view in BDE that uses **inline styles and JS token objects** instead of CSS classes. This creates three problems:

1. **Visual disconnection**: No glass morphism, no gradients, different color feel from the rest of the app
2. **Dual styling system**: Uses `tokens.ts` (JS) while everything else uses CSS custom properties
3. **Maintenance burden**: 23 `style={{}}` blocks and 63 `tokens.*` references that must be manually kept in sync

### Evidence

```
$ grep -c 'style={{' src/renderer/src/views/TerminalView.tsx
23

$ grep -c 'tokens\.' src/renderer/src/views/TerminalView.tsx
63
```

All hover/mouse-enter effects are done via imperative `e.currentTarget.style.*` mutations (`TerminalView.tsx:182-189`, `216-223`, `243-250`, etc.) instead of CSS `:hover` pseudo-classes.

---

## Solution

### 1. Create CSS classes in `terminal.css`

Map every inline style block to a named CSS class:

| Inline Style Location                          | New CSS Class                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Root container (line 94)                       | `.terminal-view` (already implied, needs glass)                       |
| Tab bar container (line 96-104)                | `.terminal-tabbar`                                                    |
| Scrollable tabs region (line 107-117)          | `.terminal-tabbar__tabs`                                              |
| Individual tab (line 131-151)                  | `.terminal-tab`, `.terminal-tab--active`, `.terminal-tab--agent`      |
| Tab close button (line 164-181)                | `.terminal-tab__close`                                                |
| Add tab / shell picker group (line 198)        | `.terminal-tabbar__actions`                                           |
| Icon buttons (lines 200-225, 227-251, 267-292) | `.terminal-toolbar-btn`                                               |
| Right toolbar (line 308-316)                   | `.terminal-tabbar__toolbar`                                           |
| Clear button (line 320-348)                    | `.terminal-toolbar-btn--clear`                                        |
| Split button (line 352-380)                    | `.terminal-toolbar-btn--split`, `.terminal-toolbar-btn--split-active` |
| Terminal pane container (line 387)             | `.terminal-panes`                                                     |
| Per-tab wrapper (line 391-397)                 | `.terminal-pane-wrapper`, `.terminal-pane-wrapper--hidden`            |
| Agent tab layout (line 400, 410)               | Already uses `.terminal-agent-status-bar` (good)                      |
| Split separator (line 419-425)                 | `.terminal-split-separator`                                           |

### 2. Replace all `onMouseEnter`/`onMouseLeave` with CSS `:hover`

Every button in TerminalView uses this pattern:

```tsx
onMouseEnter={(e) => {
  e.currentTarget.style.color = tokens.color.text
  e.currentTarget.style.background = tokens.color.surfaceHigh
}}
onMouseLeave={(e) => {
  e.currentTarget.style.color = tokens.color.textMuted
  e.currentTarget.style.background = 'transparent'
}}
```

Replace with:

```css
.terminal-toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--bg-card);
}
```

### 3. Apply glass treatment to tab bar

The terminal tab bar should match the Sessions sidebar — use glass tint + backdrop-filter:

```css
.terminal-tabbar {
  display: flex;
  align-items: center;
  background: var(--glass-tint-dark);
  backdrop-filter: var(--glass-blur-md) var(--glass-saturate);
  border-bottom: 1px solid var(--border);
  min-height: 36px;
  flex-shrink: 0;
}
```

### 4. Replace hardcoded `#a78bfa` with `var(--color-ai)`

`TerminalView.tsx:144` and `159` use `#a78bfa` for agent tab accent. This should be `var(--color-ai)` which is already defined in `base.css:119`.

---

## Files to Modify

| File                                       | Change                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `src/renderer/src/views/TerminalView.tsx`  | Replace all 23 `style={{}}` with className, remove all `onMouseEnter`/`onMouseLeave` hover hacks |
| `src/renderer/src/assets/terminal.css`     | Add all new classes listed above                                                                 |
| `src/renderer/src/design-system/tokens.ts` | No change needed (will be deprecated in DP-S1)                                                   |

## Acceptance Criteria

- [ ] `grep -c 'style={{' src/renderer/src/views/TerminalView.tsx` returns 0
- [ ] `grep -c 'tokens\.' src/renderer/src/views/TerminalView.tsx` returns 0 (no import)
- [ ] All hover states use CSS `:hover` pseudo-classes
- [ ] Terminal tab bar has glass treatment matching other sidebars
- [ ] Agent tab accent uses `var(--color-ai)` not `#a78bfa`
- [ ] All terminal keyboard shortcuts still work
- [ ] Split pane, shell picker, and agent picker still function correctly
- [ ] `npm run build` and `npm test` pass
