# DP-S5: Hardcoded Color Purge

**Epic:** Design Polish
**Priority:** P1
**Depends on:** DP-S1, DP-S4

---

## Problem

Raw hex color values are scattered through TSX and CSS files instead of referencing CSS custom properties. This means:

- Colors can't be changed via theming
- Light theme won't affect these values
- No single source of truth for the palette

### Inventory of Hardcoded Colors

#### In TSX files

| File               | Line(s)  | Color              | Should Be                                                      |
| ------------------ | -------- | ------------------ | -------------------------------------------------------------- |
| `TerminalView.tsx` | 144, 159 | `#a78bfa`          | `var(--color-ai)` — addressed in DP-S4                         |
| `CostView.tsx`     | 35       | `#3B82F6` (haiku)  | `var(--color-info)`                                            |
| `CostView.tsx`     | 36       | `#00D37F` (sonnet) | `var(--accent)`                                                |
| `CostView.tsx`     | 37       | `#F59E0B` (opus)   | `var(--color-warning)`                                         |
| `SettingsView.tsx` | 18-23    | 6 accent presets   | Acceptable — these are literal color values for a color picker |

#### In CSS files

| File                   | Line(s)                           | Color                    | Should Be                                                  |
| ---------------------- | --------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `sprint.css:685`       | `#60a5fa`                         | Blue column icon         | `var(--color-info)`                                        |
| `sprint.css:849`       | `#888`                            | Agent chip idle dot      | `var(--text-secondary)`                                    |
| `sprint.css:853`       | `#00D37F`                         | Agent chip running dot   | `var(--color-running)`                                     |
| `sprint.css:858`       | `#6C8EEF`                         | Agent chip done dot      | `var(--color-queued)`                                      |
| `sprint.css:862`       | `#FF453A`                         | Agent chip error dot     | `var(--color-error)`                                       |
| `main.css:771`         | `#ef4444`                         | Toast error background   | `var(--color-error)`                                       |
| `main.css:776`         | `#fff`                            | Toast error text         | `var(--text-primary)` (or white via a semantic var)        |
| `main.css:778`         | `#2a2a2a`                         | Toast info background    | `var(--bg-card)`                                           |
| `main.css:714`         | `#000`                            | Memory editor toast text | Should use semantic color                                  |
| `design-system.css:47` | `#000`                            | Primary button text      | `var(--bg-void)` or keep as literal (intentional contrast) |
| `sprint.css:425-426`   | `#60a5fa`, `rgba(96,165,250,0.3)` | PR row open button hover | `var(--color-info)`, `rgba(91, 158, 255, 0.15)`            |

---

## Solution

### 1. CostView MODEL_COLORS

Replace the JS object with CSS custom properties:

```css
/* base.css — add model-specific colors */
--color-model-haiku: var(--color-info);
--color-model-sonnet: var(--accent);
--color-model-opus: var(--color-warning);
```

In `CostView.tsx`, read these via `getComputedStyle` or pass as CSS class modifiers on SVG elements.

### 2. Sprint CSS hardcoded colors

Replace each hardcoded hex with the appropriate CSS variable reference:

```css
/* Before */
.agent-chip--idle .agent-chip__dot {
  background: #888;
}
.agent-chip--running .agent-chip__dot {
  background: #00d37f;
}

/* After */
.agent-chip--idle .agent-chip__dot {
  background: var(--text-secondary);
}
.agent-chip--running .agent-chip__dot {
  background: var(--color-running);
}
```

### 3. Toast colors in main.css

```css
/* Before */
.toast--error {
  background: #ef4444;
  color: #fff;
}
.toast--info {
  background: #2a2a2a;
  color: var(--bde-text);
}

/* After */
.toast--error {
  background: var(--color-error);
  color: var(--text-primary);
}
.toast--info {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
}
```

### 4. Allowlist

The following hardcoded colors are **intentional** and should NOT be changed:

- `SettingsView.tsx:18-23` — accent color picker presets (literal swatches)
- `design-system.css:810` — `heading-hero` gradient uses literal white/gray for contrast
- SVG chart fills that need to reference CSS vars via `fill="var(--x)"` (SVG supports this)

---

## Files to Modify

| File                                  | Change                                        |
| ------------------------------------- | --------------------------------------------- |
| `src/renderer/src/assets/base.css`    | Add `--color-model-*` variables               |
| `src/renderer/src/assets/sprint.css`  | Replace 6 hardcoded hex values                |
| `src/renderer/src/assets/main.css`    | Replace toast hex values, memory editor toast |
| `src/renderer/src/views/CostView.tsx` | Replace MODEL_COLORS with CSS var references  |

## Acceptance Criteria

- [ ] `grep -rn '#[0-9a-fA-F]\{3,8\}' src/renderer/src/assets/` returns only allowlisted values
- [ ] `grep -rn '#[0-9a-fA-F]\{3,8\}' src/renderer/src/views/` returns only SettingsView accent presets
- [ ] All agent status dot colors use `--color-*` semantic variables
- [ ] Toast colors use CSS variables
- [ ] CostView chart colors reference CSS variables
- [ ] Light theme (if toggled) affects all previously-hardcoded colors
- [ ] `npm run build` passes
