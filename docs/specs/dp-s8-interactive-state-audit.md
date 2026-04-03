# DP-S8: Interactive State Audit

**Epic:** Design Polish
**Priority:** P2
**Depends on:** DP-S1, DP-S4

---

## Problem

Interactive elements (buttons, links, cards, list items) have inconsistent hover, focus, and active states across views. Some elements have polished transitions; others have none. The lack of feedback makes the app feel unresponsive.

### Audit Findings

#### Missing hover states

| Element                    | File                       | Line                                                                           | Issue                                             |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| SettingsView theme buttons | `SettingsView.tsx:223-231` | Uses `bde-btn` classes directly instead of `<Button>` component                | Inconsistent with rest of app                     |
| Memory file list items     | `main.css:630-631`         | `:hover` uses `var(--bde-border)` as background — blends with `--active` state | Should use `var(--bg-hover)`                      |
| Git file items             | `main.css:1248-1249`       | `:hover` uses `var(--bde-hover-subtle)` — inconsistent with memory files       | Should use same hover token                       |
| Diff file items            | `main.css:970-971`         | `:hover` uses `var(--bde-border)` — same as active state                       | Active and hover are indistinguishable            |
| Cost table rows            | `cost.css:203-204`         | `:hover` uses `rgba(255,255,255,0.02)` — hardcoded, nearly invisible           | Should use `var(--bg-hover)`                      |
| Sprint cards               | `sprint.css:786-794`       | No `:hover` state at all                                                       | Should show subtle border glow or background lift |
| Task cards                 | `sprint.css:786`           | No `:hover` state                                                              | Should highlight on hover (cursor is `grab`)      |

#### Missing focus states

| Element                    | Issue                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Memory file buttons        | Use `:focus-visible` outline but custom `.memory-file--focused` for keyboard nav — two competing focus indicators |
| Git sidebar action buttons | No focus ring (`git-sidebar__action`)                                                                             |
| Sprint task action buttons | No focus ring (`sprint-tasks__action-btn`)                                                                        |
| PR row buttons             | No focus ring (`pr-row__btn`)                                                                                     |
| Command palette items      | Have `:hover` and `--selected` but no `:focus-visible`                                                            |

#### Missing active states

| Element                                          | Issue                           |
| ------------------------------------------------ | ------------------------------- |
| Most custom buttons outside `<Button>` component | No `:active` transform/feedback |
| `git-sidebar__action`                            | No active state                 |
| `sprint-tasks__action-btn`                       | No active state                 |
| `pr-row__btn`                                    | No active state                 |
| DiffView repo chips                              | No active press feedback        |

#### Inconsistent hover tokens

The codebase uses at least 5 different hover background values:

| Token                              | Value                    | Used By                                                                        |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `--bde-hover`                      | `rgba(255,255,255,0.04)` | Activity bar items, sprint board repo chip active                              |
| `--bde-hover-strong`               | `rgba(255,255,255,0.06)` | Button ghost hover, command palette selected                                   |
| `--bde-hover-subtle`               | `rgba(255,255,255,0.03)` | Git file item hover                                                            |
| `--bde-border`                     | `#333333`                | Memory file hover, diff file hover (wrong — this is a border color used as bg) |
| `var(--bg-hover)`                  | `#1C1C27` (v2)           | Not used in any component                                                      |
| Hardcoded `rgba(255,255,255,0.02)` | —                        | Cost table row hover                                                           |

---

## Solution

### 1. Standardize hover background

Use exactly two hover tokens from v2:

- `var(--bg-hover)` — default list item / card hover
- `var(--bg-active)` — selected / active state

Replace all `--bde-hover-*` variants and `--bde-border` hover backgrounds.

### 2. Add hover states to sprint/task cards

```css
.task-card:hover {
  border-color: var(--border-light);
  background: var(--bg-hover);
}

.sprint-card:hover {
  border-color: var(--border-light);
}
```

### 3. Add focus-visible to all interactive elements

Create a shared focus mixin:

```css
/* Utility: focus ring for custom interactive elements */
.bde-focusable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Apply to: `git-sidebar__action`, `sprint-tasks__action-btn`, `pr-row__btn`, `command-palette__item`, `memory-file`.

### 4. Add `:active` feedback to all buttons

Any `<button>` element that isn't using the `<Button>` component should get:

```css
.pr-row__btn:active,
.git-sidebar__action:active,
.sprint-tasks__action-btn:active {
  transform: scale(0.97);
}
```

### 5. Replace direct `bde-btn` usage in SettingsView

`SettingsView.tsx:223-231` manually constructs class strings (`bde-btn bde-btn--sm bde-btn--primary`) instead of using the `<Button>` component. Replace with:

```tsx
<Button variant={theme === 'dark' ? 'primary' : 'ghost'} size="sm" onClick={() => setTheme('dark')}>
  Dark
</Button>
```

### 6. Fix hover/active state collision

For `memory-file`, `diff-file-item`, and `git-file-item`, ensure hover and active (selected) states are visually distinct:

```css
.memory-file:hover {
  background: var(--bg-hover);
}
.memory-file--active {
  background: var(--bg-active);
}
.memory-file--active:hover {
  background: var(--bg-active);
} /* active wins */
```

---

## Files to Modify

| File                                        | Change                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `src/renderer/src/assets/main.css`          | Fix hover tokens for memory/diff/git file items, add focus rings  |
| `src/renderer/src/assets/sprint.css`        | Add hover to task-card/sprint-card, focus rings to action buttons |
| `src/renderer/src/assets/cost.css`          | Replace hardcoded hover with `var(--bg-hover)`                    |
| `src/renderer/src/assets/design-system.css` | Add `.bde-focusable` utility class                                |
| `src/renderer/src/views/SettingsView.tsx`   | Replace manual `bde-btn` with `<Button>` component                |

## Acceptance Criteria

- [ ] Every clickable element has a visible `:hover` state
- [ ] Every clickable element has a `:focus-visible` indicator (outline or glow)
- [ ] Every button has an `:active` feedback (scale or background change)
- [ ] Hover and active/selected states are visually distinct (no collision)
- [ ] All list item hovers use `var(--bg-hover)`, all selected states use `var(--bg-active)`
- [ ] No manual `bde-btn` class construction — all buttons use `<Button>` component
- [ ] Cost table row hover is visible
- [ ] `npm run build` and `npm test` pass

## Testing Approach

Tab through the entire app to verify every interactive element has a visible focus indicator. Hover over every clickable element and verify visual feedback. Click and verify `:active` state.
