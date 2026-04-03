# Design System Audit

**Date:** 2026-03-16
**Auditor:** Claude (Senior Frontend Engineer)
**Scope:** All CSS files in `src/renderer/src/assets/` and all components in `src/renderer/src/components/` and `src/renderer/src/views/`

---

## Executive Summary

The BDE Electron app has a **dual design token system** — CSS variables (`--bde-*`) in `base.css` and JavaScript tokens in `tokens.ts`. While both systems define the same values, the codebase inconsistently uses:

- CSS variables (`var(--bde-accent)`)
- JS tokens (`tokens.color.accent`)
- Hardcoded inline styles (`color: '#f87171'`)

This creates **maintenance burden** and **theming inconsistency**. A cleanup epic is recommended to consolidate on CSS variables (better for runtime theming) and create utility classes to eliminate inline styles.

---

## Critical Issues (fix now)

### 1. **Inconsistent token usage — CSS vars vs JS tokens**

**Problem:** Same values defined in two places, used interchangeably.

**CSS Variables** (`base.css:8-25`):

```css
--bde-bg: #0a0a0a;
--bde-surface: #141414;
--bde-accent: #00d37f;
```

**JS Tokens** (`design-system/tokens.ts:9-25`):

```ts
color: {
  bg: '#0A0A0A',
  surface: '#111111',  // ⚠️ Mismatch! CSS has #141414
  accent: '#00D37F',
}
```

**Examples of mixed usage:**

- `TerminalView.tsx:140` — Uses `tokens.color.bg` inline
- `sessions.css:44` — Uses `var(--bde-surface)` in CSS
- Both styles exist side-by-side, causing confusion

**Impact:**

- Hard to maintain (need to update two places)
- Risk of drift (already found `surface` mismatch)
- Theming harder (CSS vars better for runtime theme switching)

**Recommendation:**

- **Consolidate on CSS variables** as single source of truth
- Update `tokens.ts` to export CSS var references: `accent: 'var(--bde-accent)'`
- Or deprecate `tokens.ts` entirely and use CSS classes

---

### 2. **Extensive inline styles in TerminalView.tsx**

**Problem:** 200+ lines of inline styles using `tokens.*` references that should be CSS classes.

**Examples** (`TerminalView.tsx:140-197`):

```tsx
<div style={{
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: tokens.color.bg  // Should be CSS class
}}>
```

```tsx
<div style={{
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[2],
  padding: `0 ${tokens.space[4]}`,
  fontSize: tokens.size.sm,
  fontFamily: tokens.font.ui,
  color: isActive ? tokens.color.text : tokens.color.textMuted,
  background: isActive ? tokens.color.bg : 'transparent',
  // ... 10 more properties
}}>
```

**Impact:**

- Poor performance (inline styles prevent style deduplication)
- Hard to read (JSX polluted with style logic)
- Can't leverage CSS pseudo-classes (`:hover`, `:focus`)
- No browser dev tools CSS inspection

**Recommendation:**
Create CSS classes:

```css
/* terminal.css */
.terminal-tab {
  display: flex;
  align-items: center;
  gap: var(--bde-space-1);
  padding: 0 var(--bde-space-4);
  font-size: var(--bde-size-sm);
  color: var(--bde-text-muted);
  transition: var(--bde-transition-fast);
}

.terminal-tab--active {
  color: var(--bde-text);
  background: var(--bde-bg);
  border-bottom: 2px solid var(--bde-accent);
}
```

---

### 3. **Hardcoded values in ErrorBoundary.tsx**

**Problem:** No token usage at all — hardcoded colors, spacing, fonts.

**Code** (`ErrorBoundary.tsx:27-31`):

```tsx
<div style={{
  padding: 16,              // Should be var(--bde-space-4)
  color: '#f87171',         // Should be var(--bde-danger) or tokens.color.danger
  fontFamily: 'monospace',  // Should be var(--bde-font-code)
  fontSize: 12              // Should be var(--bde-size-sm)
}}>
  <div style={{
    fontWeight: 600,
    marginBottom: 4         // Should be var(--bde-space-1)
  }}>
```

**Impact:**

- Doesn't respect theme (always shows hardcoded color)
- Not maintainable
- Visual inconsistency with rest of app

**Recommendation:**
Replace with tokens or create `.error-boundary` CSS class.

---

### 4. **Missing token coverage**

**Gaps found:**

| Category                | Missing                         | Where needed                                                                                             |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Z-index**             | No z-index scale                | `command-palette__overlay` (z: 1000), `toast-container` (z: 200), `shell-picker` (z: 20) — all hardcoded |
| **Animation durations** | Only 3 defined (fast/base/slow) | Need `instant`, `bouncy`, custom durations for specific animations                                       |
| **Max widths**          | None                            | Memory sidebar (240px), diff sidebar (200px), git sidebar (260px) — all hardcoded                        |
| **Line heights**        | None                            | Scattered 1.5, 1.6, 1.7 throughout CSS                                                                   |
| **Agent purple color**  | `#a78bfa` hardcoded             | Used in `TerminalView.tsx:190`, `terminal.css:154` — should be `--bde-agent-accent`                      |
| **Opacity values**      | None                            | `0.5`, `0.6`, `0.7`, `0.8` scattered everywhere                                                          |

**Recommendation:**
Extend design tokens:

```css
/* base.css additions */
--bde-z-base: 1;
--bde-z-dropdown: 10;
--bde-z-overlay: 100;
--bde-z-modal: 1000;

--bde-line-height-tight: 1.25;
--bde-line-height-normal: 1.5;
--bde-line-height-loose: 1.75;

--bde-accent-purple: #a78bfa; /* Agent UI accent */

--bde-max-width-sm: 240px;
--bde-max-width-md: 400px;
--bde-max-width-lg: 640px;
```

---

## Medium Issues (fix in cleanup epic)

### 5. **sessions.css is massive (1800+ lines)**

**Problem:** Single CSS file for entire sessions view.

**Current structure:**

```
sessions.css:
  - Session list (40 lines)
  - Session header (30 lines)
  - Chat pane (200 lines)
  - Message input (150 lines)
  - Agent list (180 lines)
  - Live feed (100 lines)
  - ... 13 more sections
```

**Recommendation:**
Split by component:

```
assets/sessions/
  ├── session-list.css
  ├── chat-pane.css
  ├── message-input.css
  ├── agent-list.css
  └── index.css  (imports all)
```

Or better: **move to component-scoped CSS modules**.

---

### 6. **Duplicate CSS rules across files**

**Found duplicates:**

| Rule                       | Locations                                                                      | Recommendation                      |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| Skeleton shimmer animation | `design-system.css:523-528`, `sprint.css:120-125`                              | Keep in design-system.css only      |
| Button reset styles        | `.bde-btn`, `.command-palette__item`, `.git-sidebar__action`, many more        | Create `.btn-reset` utility class   |
| Flex centering             | Repeated `display: flex; align-items: center; justify-content: center`         | Create `.flex-center` utility       |
| Truncate text              | `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` in 15+ places | Create `.truncate` utility          |
| Disabled state             | `opacity: 0.5; cursor: not-allowed` repeated                                   | Create `[disabled]` global selector |

**Recommendation:**
Create `utilities.css`:

```css
/* utilities.css */
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-col { display: flex; flex-direction: column; }
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.visually-hidden { position: absolute; width: 1px; height: 1px; ... }
```

---

### 7. **CSS variable fallbacks suggest inconsistency**

**Examples:**

```css
/* main.css:290 */
background: var(--bde-surface-high, var(--bde-surface));

/* terminal.css:11 */
background: var(--bde-surface-high, var(--bde-surface));

/* terminal.css:61 */
background: var(--bde-surface, #111111);
```

**Problem:** Fallbacks suggest `--bde-surface-high` might not be defined everywhere.

**Investigation needed:**
Check if `--bde-surface-high` is in `:root` in base.css (it is: line 12), so fallbacks are defensive but unnecessary.

**Recommendation:**
Remove fallbacks if variables are guaranteed to exist. Fallbacks add noise.

---

### 8. **Inline styles for dynamic values (legit, but could be improved)**

**Legit uses** (keep):

- `Spinner.tsx:10` — `style={{ borderTopColor: color }}` for custom color override ✅
- `Textarea.tsx:23-24` — `style.height` for auto-resize ✅
- `SessionList.tsx` — `style={{ '--stagger-index': index }}` for CSS custom property ✅
- `SprintBoard.tsx` — `style={{ background: r.color }}` for dynamic repo colors ✅

**Questionable uses** (could be CSS classes):

- `TerminalView.tsx` — Most layout/typography styles should be classes
- `DiffView.tsx:1-2` — Loading skeleton sizes could be CSS classes
- `CostView.tsx:1` — Skeleton heights could be predefined classes

---

### 9. **Hardcoded colors not in token system**

**Found:**

| Color     | Location                                 | Usage               | Should be token?                                        |
| --------- | ---------------------------------------- | ------------------- | ------------------------------------------------------- |
| `#a78bfa` | TerminalView.tsx:190, terminal.css:154   | Agent tab accent    | **Yes** — `--bde-accent-purple`                         |
| `#f87171` | ErrorBoundary.tsx:27, multiple CSS files | Error red (lighter) | Maybe — already have `--bde-danger: #FF4D4D`            |
| `#6ee7b7` | diff-viewer CSS                          | Diff add green      | **Yes** — `--bde-diff-add`                              |
| `#fca5a5` | diff-viewer CSS                          | Diff delete red     | **Yes** — `--bde-diff-del`                              |
| `#facc15` | sprint.css, diff CSS                     | Warning yellow      | Use existing `--bde-warning: #F59E0B`? Or add separate? |
| `#60a5fa` | sprint.css                               | Info blue           | Use existing `--bde-info: #3B82F6`? Or add separate?    |

**Recommendation:**
Extend color palette:

```css
/* Specialized colors */
--bde-accent-purple: #a78bfa; /* Agent UI */
--bde-diff-add: #6ee7b7;
--bde-diff-del: #fca5a5;
--bde-code-modified: #facc15;
```

---

## Recommendations

### Short-term (this sprint)

1. **Fix ErrorBoundary.tsx** — Replace hardcoded styles with tokens (5 min fix)
2. **Document the dual system** — Add comment to `tokens.ts` explaining when to use CSS vars vs JS tokens
3. **Add missing critical tokens** — Add `--bde-accent-purple`, `--bde-z-*` scale

### Medium-term (next sprint)

4. **Create utility classes** — Add `utilities.css` with `.flex-center`, `.truncate`, etc.
5. **Refactor TerminalView.tsx** — Extract inline styles to CSS classes in `terminal.css`
6. **Add missing token coverage** — z-index, line-height, max-width, opacity scales

### Long-term (cleanup epic)

7. **Consolidate on CSS variables** — Deprecate `tokens.ts` or make it export CSS var strings
8. **Split sessions.css** — Break into component-scoped files or CSS modules
9. **Remove duplicate rules** — DRY up skeleton animations, button resets, etc.
10. **Theme audit** — Verify light theme overrides all necessary colors

---

## Inline Style Inventory

### Components with inline styles (should be tokenized)

**Critical (heavy inline style usage):**

| Component                                | Lines with inline styles    | Token usage          | Priority |
| ---------------------------------------- | --------------------------- | -------------------- | -------- |
| `views/TerminalView.tsx`                 | 140-250 (~25 inline styles) | Uses `tokens.*`      | **P0**   |
| `components/terminal/AgentOutputTab.tsx` | 19-46 (~4 inline styles)    | Uses `tokens.*`      | P1       |
| `components/ui/ErrorBoundary.tsx`        | 27-31 (~3 inline styles)    | **None — hardcoded** | **P0**   |

**Medium:**

| Component                                     | Issue                     | Fix                                                    |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| `views/DiffView.tsx`                          | Skeleton widths inline    | Add `.diff-skeleton-sidebar`, `.diff-skeleton-content` |
| `views/SessionsView.tsx`                      | Layout positioning inline | Create `.sessions-split-toolbar` positioning class     |
| `views/CostView.tsx`                          | Skeleton heights inline   | Add `.cost-skeleton-card`                              |
| `views/SettingsView.tsx`                      | Color swatches inline     | Keep (dynamic colors) ✅                               |
| `components/sessions/LocalAgentLogViewer.tsx` | Flex layout inline        | Add `.agent-log-header` class                          |
| `components/sprint/SprintBoard.tsx`           | Repo dot colors inline    | Keep (dynamic colors) ✅                               |
| `components/sprint/PRList.tsx`                | Repo dot colors inline    | Keep (dynamic colors) ✅                               |

**Low priority (legit dynamic styles):**

| Component                  | Reason                                | Keep?  |
| -------------------------- | ------------------------------------- | ------ |
| `ui/Spinner.tsx`           | Custom color override                 | ✅ Yes |
| `ui/Textarea.tsx`          | Auto-resize height                    | ✅ Yes |
| `sessions/SessionList.tsx` | CSS custom property `--stagger-index` | ✅ Yes |

---

## CSS File Organization Analysis

### Current structure (7 files, 4000+ lines total)

| File                | Lines  | Purpose                                       | Status           |
| ------------------- | ------ | --------------------------------------------- | ---------------- |
| `base.css`          | ~159   | CSS vars, resets, theme, scrollbars           | ✅ Good          |
| `design-system.css` | ~529   | Component classes (Button, Badge, Card, etc.) | ✅ Good          |
| `main.css`          | ~1393  | App shell, layout, views                      | ⚠️ Could split   |
| `sessions.css`      | ~1800+ | Entire sessions view                          | ❌ **Too large** |
| `cost.css`          | ~248   | Cost view                                     | ✅ Good          |
| `sprint.css`        | ~687   | Sprint view                                   | ⚠️ Could split   |
| `terminal.css`      | ~157   | Terminal find bar, shell picker               | ✅ Good          |

### Recommended split

```
assets/
├── base.css                    (keep)
├── design-system.css          (keep)
├── utilities.css              (NEW — flex, truncate, etc.)
├── layout/
│   ├── app-shell.css
│   ├── title-bar.css
│   ├── activity-bar.css
│   └── status-bar.css
├── views/
│   ├── sessions/              (break up sessions.css)
│   │   ├── session-list.css
│   │   ├── chat-pane.css
│   │   ├── message-input.css
│   │   └── agent-list.css
│   ├── sprint/                (break up sprint.css)
│   │   ├── sprint-board.css
│   │   ├── pr-list.css
│   │   └── sprint-tasks.css
│   ├── cost.css               (keep)
│   ├── diff.css               (extract from main.css)
│   ├── memory.css             (extract from main.css)
│   ├── settings.css           (extract from main.css)
│   └── terminal.css           (keep)
└── main.css                   (imports all)
```

**Or migrate to CSS Modules:**

```
components/sessions/ChatPane.tsx
components/sessions/ChatPane.module.css  (scoped styles)
```

---

## Token Coverage Checklist

### Colors ✅ Well covered

- [x] Background (bg, surface, surfaceHigh)
- [x] Borders (border, borderHover)
- [x] Text (text, textMuted, textDim)
- [x] Semantic (accent, danger, warning, info, success)
- [ ] **Missing:** Agent purple (`#a78bfa`), diff colors

### Typography ✅ Well covered

- [x] Font families (ui, code)
- [x] Font sizes (xs to xxl)
- [ ] **Missing:** Line heights, letter spacing values

### Spacing ✅ Complete

- [x] Scale 1-8 (4px base)

### Layout

- [x] Border radius (sm to full)
- [x] Shadows (sm, md, lg)
- [ ] **Missing:** Z-index scale, max-width scale

### Animation

- [x] Transitions (fast, base, slow)
- [ ] **Missing:** Easing functions (cubic-bezier), spring animations

### Misc

- [ ] **Missing:** Opacity scale (10, 20, 50, 70, etc.)
- [ ] **Missing:** Breakpoints (if responsive needed)

---

## Action Items Summary

### Immediate (before next commit)

- [ ] Fix `ErrorBoundary.tsx` hardcoded styles
- [ ] Add `--bde-accent-purple: #a78bfa` to base.css
- [ ] Document CSS vars vs tokens.ts usage in README

### Sprint cleanup

- [ ] Create `utilities.css` with common patterns
- [ ] Refactor `TerminalView.tsx` inline styles to CSS classes
- [ ] Add z-index, line-height, max-width tokens
- [ ] Add diff color tokens (`--bde-diff-add`, `--bde-diff-del`)

### Epic: Design System Consolidation

- [ ] Decide: CSS vars vs tokens.ts (recommend CSS vars)
- [ ] If keeping both: make tokens.ts export CSS var strings
- [ ] Split `sessions.css` into component files
- [ ] Split `sprint.css` into board/pr-list/tasks
- [ ] Remove duplicate CSS rules (skeleton, truncate, etc.)
- [ ] Audit light theme coverage

---

## Conclusion

The BDE design system is **80% there** — good token coverage, clean component classes, consistent naming. The main issues are:

1. **Dual system confusion** (CSS vars vs JS tokens)
2. **Inline style overuse** (TerminalView, ErrorBoundary)
3. **Missing token coverage** (z-index, agent purple, diff colors)
4. **Large CSS files** (sessions.css needs splitting)

**Estimated cleanup effort:** 2-3 days for one developer to:

- Fix critical issues (ErrorBoundary, add missing tokens)
- Refactor TerminalView to CSS classes
- Create utility classes
- Split large CSS files

The payoff: **easier theming, better performance, cleaner code**.
