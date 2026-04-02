# Light Theme Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every surface in the app respect the light/dark theme toggle by replacing all hardcoded colors with CSS variables.

**Architecture:** All theming goes through CSS variables defined in `base.css`. The `:root` block defines dark defaults; `html.theme-light` overrides them. TSX files use `var(--bde-*)` in inline styles. The one exception is xterm, which needs resolved color strings — a small utility reads computed CSS variable values and subscribes to theme changes.

**Tech Stack:** CSS custom properties, Zustand (theme store subscription), xterm.js ITheme

**Spec:** `docs/superpowers/specs/2026-03-23-light-theme-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/renderer/src/assets/base.css` | CSS variable definitions | Add missing light overrides + new semantic variables |
| `src/renderer/src/assets/design-system.css` | Component class styles | Replace 6 hardcoded colors |
| `src/renderer/src/assets/cost.css` | Cost view styles | Replace ~15 hardcoded colors |
| `src/renderer/src/assets/diff.css` | Diff viewer styles | Replace 5 hardcoded colors |
| `src/renderer/src/assets/sprint.css` | Sprint view styles | Replace ~11 hardcoded colors |
| `src/renderer/src/assets/pr-station.css` | PR Station styles | Replace ~7 hardcoded colors |
| `src/renderer/src/assets/main.css` | Global app styles | Replace 1 hardcoded color |
| `src/renderer/src/assets/agents.css` | Agents view styles | Replace ~18 hardcoded colors |
| `src/renderer/src/assets/settings.css` | Settings view styles | Replace 1 hardcoded gradient |
| `src/renderer/src/assets/terminal.css` | Terminal view styles | Replace 4 hardcoded colors |
| `src/renderer/src/assets/memory.css` | Memory view styles | Replace 1 hardcoded gradient |
| `src/renderer/src/assets/command-palette.css` | Command palette styles | Replace 1 hardcoded overlay |
| `src/renderer/src/assets/toasts.css` | Toast notification styles | Replace 2 hardcoded colors |
| `src/renderer/src/lib/terminal-theme.ts` | **New** — xterm ITheme from computed CSS vars | Create |
| `src/renderer/src/components/terminal/TerminalPane.tsx` | Terminal widget | Use terminal-theme + subscribe to theme store |
| `src/renderer/src/components/terminal/TerminalTabBar.tsx` | Tab bar status dots | Replace hardcoded hex in `getStatusDotColor()` |
| `src/renderer/src/components/agents/ThinkingBlock.tsx` | AI thinking disclosure | Replace hardcoded purple |
| `src/renderer/src/components/settings/TaskTemplatesSection.tsx` | Template badges | Replace hardcoded blue |
| `src/renderer/src/components/panels/PanelDropOverlay.tsx` | Drag-and-drop zones | Replace hardcoded highlight |

---

## Task 1: Add missing CSS variables to `base.css`

**Files:**
- Modify: `src/renderer/src/assets/base.css:48,50` (`:root` block, add missing vars)
- Modify: `src/renderer/src/assets/base.css:280-392` (`html.theme-light` block, add overrides)

- [ ] **Step 1: Add new semantic variables to `:root`**

After line 69 (`--bde-subagent: #a78bfa;`), add:

```css
  --bde-purple: #A855F7;
  --bde-purple-dim: rgba(168, 85, 247, 0.15);
  --bde-diff-add-bg: rgba(6, 78, 59, 0.3);
  --bde-diff-del-bg: rgba(127, 29, 29, 0.3);
  --bde-btn-primary-text: #000000;
  --bde-glass-bg: rgba(255, 255, 255, 0.04);
  --bde-glass-bg-hover: rgba(255, 255, 255, 0.08);
  --bde-glass-bg-active: rgba(255, 255, 255, 0.06);
```

- [ ] **Step 2: Add missing overrides to `html.theme-light`**

In the semantic colors section (after line 311 `--bde-subagent: #7C3AED;`), add:

```css
  --bde-warning-dim: rgba(217, 119, 6, 0.15);
  --bde-info-dim: rgba(37, 99, 235, 0.15);
  --bde-purple: #7C3AED;
  --bde-purple-dim: rgba(124, 58, 237, 0.15);
```

In the diff colors section (after line 316 `--bde-diff-mod: #CA8A04;`), add:

```css
  --bde-diff-add-bg: rgba(6, 78, 59, 0.15);
  --bde-diff-del-bg: rgba(220, 38, 38, 0.12);
```

After the shadows section (after line 321), add:

```css
  /* ── Button & glass ───────────────────────────────────── */
  --bde-btn-primary-text: #000000;
  --bde-glass-bg: rgba(0, 0, 0, 0.04);
  --bde-glass-bg-hover: rgba(0, 0, 0, 0.08);
  --bde-glass-bg-active: rgba(0, 0, 0, 0.06);
```

- [ ] **Step 3: Verify build**

Run: `npm run typecheck`
Expected: PASS (CSS-only changes, no TS impact)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/base.css
git commit -m "feat(theme): add missing light overrides and new semantic CSS variables"
```

---

## Task 2: Replace hardcoded colors in `design-system.css`

**Files:**
- Modify: `src/renderer/src/assets/design-system.css:46,740,767,780,786,813`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 46 | `color: #000;` | `color: var(--bde-btn-primary-text);` |
| 740 | `color: #050507;` | `color: var(--bde-btn-primary-text);` |
| 767 | `background: rgba(255, 255, 255, 0.04);` | `background: var(--bde-glass-bg);` |
| 780 | `background: rgba(255, 255, 255, 0.08);` | `background: var(--bde-glass-bg-hover);` |
| 786 | `background: rgba(255, 255, 255, 0.06);` | `background: var(--bde-glass-bg-active);` |
| 813 | `background: rgba(0, 0, 0, 0.5);` | `background: var(--bde-overlay);` |

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/design-system.css
git commit -m "feat(theme): replace hardcoded colors in design-system.css with CSS variables"
```

---

## Task 3: Replace hardcoded colors in `cost.css`

**Files:**
- Modify: `src/renderer/src/assets/cost.css`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 106 | `background: linear-gradient(90deg, #3B82F6, #60A5FA);` | `background: var(--bde-info);` |
| 110 | `background: linear-gradient(90deg, #F59E0B, #FBBF24);` | `background: var(--bde-warning);` |
| 132 | `background: rgba(59, 130, 246, 0.15);` | `background: var(--bde-info-dim);` |
| 133 | `color: #60A5FA;` | `color: var(--bde-info);` |
| 134 | `border: 1px solid rgba(59, 130, 246, 0.3);` | `border: 1px solid var(--bde-info);` |
| 138 | `background: rgba(245, 158, 11, 0.15);` | `background: var(--bde-warning-dim);` |
| 139 | `color: #FBBF24;` | `color: var(--bde-warning);` |
| 140 | `border: 1px solid rgba(245, 158, 11, 0.3);` | `border: 1px solid var(--bde-warning);` |
| 251 | `background: rgba(255, 255, 255, 0.03);` | `background: var(--bde-hover-subtle);` |
| 256 | `border-left: 3px solid #00D37F;` | `border-left: 3px solid var(--bde-success);` |
| 260 | `border-left: 3px solid #F59E0B;` | `border-left: 3px solid var(--bde-warning);` |
| 264 | `border-left: 3px solid #FF4D4D;` | `border-left: 3px solid var(--bde-danger);` |
| 272 | `border-left: 3px solid #555;` | `border-left: 3px solid var(--bde-text-dim);` |
| 328 | `background: rgba(0, 211, 127, 0.15);` | `background: var(--bde-accent-dim);` |

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/cost.css
git commit -m "feat(theme): replace hardcoded colors in cost.css with CSS variables"
```

---

## Task 4: Replace hardcoded colors in `diff.css`

**Files:**
- Modify: `src/renderer/src/assets/diff.css`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 282 | `background: rgba(255, 255, 255, 0.02);` | `background: var(--bde-hover-subtle);` |
| 295 | `background: rgba(6, 78, 59, 0.3);` | `background: var(--bde-diff-add-bg);` |
| 300 | `background: rgba(127, 29, 29, 0.3);` | `background: var(--bde-diff-del-bg);` |
| 358 | `background: rgba(0, 211, 127, 0.08);` | `background: var(--bde-accent-hover);` |
| 611 | `color: #000;` | `color: var(--bde-btn-primary-text);` |

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/diff.css
git commit -m "feat(theme): replace hardcoded colors in diff.css with CSS variables"
```

---

## Task 5: Replace hardcoded colors in `sprint.css`

**Files:**
- Modify: `src/renderer/src/assets/sprint.css`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 130 | `border-color: rgba(255, 255, 255, 0.1);` | `border-color: var(--bde-border-hover);` |
| 193 | `border-color: rgba(91, 158, 255, 0.3);` | `border-color: var(--bde-info);` |
| 198 | `border-color: rgba(0, 211, 127, 0.3);` | `border-color: var(--bde-accent);` |
| 337 | `background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));` | `background: var(--color-surface-raised, var(--bde-glass-bg));` |
| 338 | `border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));` | `border: 1px solid var(--color-border, var(--bde-selected));` |
| 500 | `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);` | `box-shadow: inset 0 1px 0 var(--bde-hover-subtle);` |
| 767 | `background: rgba(255, 59, 48, 0.1) !important;` | `background: var(--bde-danger-hover) !important;` |
| 1892 | `background: rgba(255, 255, 255, 0.04);` | `background: var(--bde-glass-bg);` |
| 1931 | `background: rgba(0, 0, 0, 0.3);` | `background: var(--bde-overlay);` |

**Intentionally left as-is** (structural overlays that should be dark in both themes):
- Lines 210, 627, 1009, 1514, 1727 — `rgba(0, 0, 0, 0.4-0.6)` modal/drawer backdrops

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/sprint.css
git commit -m "feat(theme): replace hardcoded colors in sprint.css with CSS variables"
```

---

## Task 6: Replace hardcoded colors in `pr-station.css`

**Files:**
- Modify: `src/renderer/src/assets/pr-station.css`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 309 | `color: #000;` | `color: var(--bde-btn-primary-text);` |
| 311 | `border-left: 1px solid rgba(0, 0, 0, 0.2);` | `border-left: 1px solid var(--bde-border);` |
| 367 | `color: #a855f7;` | `color: var(--bde-purple);` |
| 368 | `background: rgba(168, 85, 247, 0.15);` | `background: var(--bde-purple-dim);` |

**Intentionally left as `#fff`** (text on colored repo-color backgrounds — needs contrast in both themes):
- Line 196 — `.pr-station-list__repo-badge`
- Line 469 — `.pr-detail__label`

**Intentionally left as-is** (structural overlays):
- Line 914 — `rgba(0, 0, 0, 0.5)` review dialog backdrop

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/pr-station.css
git commit -m "feat(theme): replace hardcoded colors in pr-station.css with CSS variables"
```

---

## Task 7: Replace hardcoded colors in `agents.css`

**Files:**
- Modify: `src/renderer/src/assets/agents.css`

- [ ] **Step 1: Replace hardcoded values**

| Line | Old | New |
|------|-----|-----|
| 240 | `rgba(0, 0, 0, 0.04)` | `var(--bde-hover)` |
| 245 | `rgba(0, 0, 0, 0.06)` | `var(--bde-hover-strong)` |
| 264 | `rgba(239, 68, 68, 0.1)` | `var(--bde-danger-hover)` |
| 306 | `rgba(239, 68, 68, 0.08)` | `var(--bde-error-bg)` |
| 386 | `rgba(0, 0, 0, 0.06)` | `var(--bde-hover-strong)` |
| 432 | `rgba(0, 0, 0, 0.02)` | `var(--bde-hover-subtle)` |
| 467 | `rgba(34, 197, 94, 0.15)` | `var(--bde-accent-dim)` |
| 468 | `#22c55e` | `var(--bde-success)` |
| 472 | `rgba(239, 68, 68, 0.15)` | `var(--bde-danger-dim)` |
| 473 | `#ef4444` | `var(--bde-danger)` |
| 477 | `rgba(59, 130, 246, 0.15)` | `var(--bde-info-dim)` |
| 478 | `#3b82f6` | `var(--bde-info)` |
| 489 | `rgba(0, 0, 0, 0.02)` | `var(--bde-hover-subtle)` |
| 498 | `rgba(0, 0, 0, 0.03)` | `var(--bde-hover-subtle)` |
| 530 | `rgba(0, 0, 0, 0.03)` | `var(--bde-hover-subtle)` |
| 548 | `rgba(0, 0, 0, 0.06)` | `var(--bde-hover-strong)` |
| 566 | `rgba(0, 0, 0, 0.02)` | `var(--bde-hover-subtle)` |
| 587 | `rgba(0, 0, 0, 0.02)` | `var(--bde-hover-subtle)` |

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/assets/agents.css
git commit -m "feat(theme): replace hardcoded colors in agents.css with CSS variables"
```

---

## Task 8: Replace hardcoded colors in remaining CSS files

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/assets/terminal.css`
- Modify: `src/renderer/src/assets/toasts.css`
- Modify: `src/renderer/src/assets/settings.css`
- Modify: `src/renderer/src/assets/memory.css`
- Modify: `src/renderer/src/assets/command-palette.css`

- [ ] **Step 1: Replace hardcoded values in `main.css`**

| Line | Old | New |
|------|-----|-----|
| 367 | `background: rgba(255, 255, 255, 0.1);` | `background: var(--bde-hover-strong);` |

- [ ] **Step 2: Replace hardcoded values in `terminal.css`**

| Line | Old | New |
|------|-----|-----|
| 303 | `rgba(0, 0, 0, 0.4)` (find bar) | `var(--bde-overlay)` |
| 352 | `rgba(0, 0, 0, 0.5)` (shell picker backdrop) | `var(--bde-overlay)` |
| 371 | `rgba(0, 0, 0, 0.5)` (agent picker backdrop) | `var(--bde-overlay)` |

- [ ] **Step 3: Replace hardcoded values in `toasts.css`**

| Line | Old | New |
|------|-----|-----|
| 25 | `rgba(0, 0, 0, 0.4)` (toast shadow component) | `var(--bde-overlay)` |
| 62 | `rgba(255, 255, 255, 0.2)` (action btn border) | `var(--bde-hover-strong)` |

- [ ] **Step 4: Replace hardcoded values in `settings.css`**

| Line | Old | New |
|------|-----|-----|
| 25 | `rgba(108, 142, 239, 0.4)` and `rgba(167, 139, 250, 0.2)` in gradient | `rgba(var(--bde-info), 0.4)` — leave as-is, decorative header gradient works in both themes |

**Decision:** The `settings.css` line 25 gradient uses accent/info colors for a decorative header glow. These are subtle enough that the dark values work acceptably in light mode. Leave as-is.

- [ ] **Step 5: Replace hardcoded values in `memory.css`**

Same pattern as settings — decorative header gradient. Leave as-is.

- [ ] **Step 6: Replace hardcoded values in `command-palette.css`**

| Line | Old | New |
|------|-----|-----|
| 20 | `rgba(0, 0, 0, 0.6)` (backdrop) | `var(--bde-overlay)` |

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/assets/main.css src/renderer/src/assets/terminal.css src/renderer/src/assets/toasts.css src/renderer/src/assets/command-palette.css
git commit -m "feat(theme): replace hardcoded colors in main/terminal/toasts/command-palette CSS"
```

---

## Task 9: Replace hardcoded colors in TSX components

**Files:**
- Modify: `src/renderer/src/components/terminal/TerminalTabBar.tsx:142-147`
- Modify: `src/renderer/src/components/agents/ThinkingBlock.tsx:17,19,36,68`
- Modify: `src/renderer/src/components/settings/TaskTemplatesSection.tsx:82`
- Modify: `src/renderer/src/components/panels/PanelDropOverlay.tsx:45`

- [ ] **Step 1: Fix `TerminalTabBar.tsx` — `getStatusDotColor()`**

Replace lines 142-147:

```typescript
  const getStatusDotColor = (tab: TerminalTab): string => {
    if (tab.hasUnread) return 'var(--bde-info)'
    if (tab.kind === 'agent') return 'var(--bde-subagent)'
    if (tab.status === 'exited') return 'var(--bde-text-dim)'
    return 'var(--bde-accent)'
  }
```

- [ ] **Step 2: Fix `ThinkingBlock.tsx`**

Replace the hardcoded purple references:
- Line 17: `border: '1px solid var(--color-ai, #A855F7)'` → `border: '1px solid var(--bde-purple)'`
- Line 19: `backgroundColor: 'rgba(168, 85, 247, 0.15)'` → `backgroundColor: 'var(--bde-purple-dim)'`
- Line 36: `color: 'var(--color-ai, #A855F7)'` → `color: 'var(--bde-purple)'`
- Line 68: `borderTop: '1px solid var(--color-ai, #A855F7)'` → `borderTop: '1px solid var(--bde-purple)'`

- [ ] **Step 3: Fix `TaskTemplatesSection.tsx`**

Replace line 82 inline style:

```typescript
<span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '9999px', background: 'var(--bde-info-dim)', color: 'var(--bde-info)' }}>Built-in</span>
```

- [ ] **Step 4: Fix `PanelDropOverlay.tsx`**

Replace line 45:

```typescript
const HIGHLIGHT_COLOR = 'var(--bde-info-dim)'
```

- [ ] **Step 5: Verify build and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/terminal/TerminalTabBar.tsx \
       src/renderer/src/components/agents/ThinkingBlock.tsx \
       src/renderer/src/components/settings/TaskTemplatesSection.tsx \
       src/renderer/src/components/panels/PanelDropOverlay.tsx
git commit -m "feat(theme): replace hardcoded colors in TSX components with CSS variables"
```

---

## Task 10: Create xterm theme utility and wire up reactivity

**Files:**
- Create: `src/renderer/src/lib/terminal-theme.ts`
- Modify: `src/renderer/src/components/terminal/TerminalPane.tsx`

- [ ] **Step 1: Create `terminal-theme.ts`**

```typescript
import type { ITheme } from 'xterm'

/**
 * Build an xterm ITheme from the currently-active CSS variables.
 * Must be called after DOM is mounted (uses getComputedStyle).
 */
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string): string => style.getPropertyValue(v).trim()

  return {
    background: get('--bde-bg'),
    foreground: get('--bde-text'),
    cursor: get('--bde-accent'),
    cursorAccent: get('--bde-bg'),
    selectionBackground: get('--bde-accent-dim'),
    selectionForeground: get('--bde-text'),
    black: get('--bde-surface'),
    brightBlack: get('--bde-text-dim'),
    red: get('--bde-danger'),
    brightRed: get('--bde-danger-text'),
    green: get('--bde-success'),
    brightGreen: get('--bde-accent'),
    yellow: get('--bde-warning'),
    brightYellow: get('--bde-warning'),
    blue: get('--bde-info'),
    brightBlue: get('--bde-info'),
    magenta: get('--bde-purple'),
    brightMagenta: get('--bde-subagent'),
    cyan: get('--bde-info'),
    brightCyan: get('--bde-info'),
    white: get('--bde-text'),
    brightWhite: get('--bde-text'),
  }
}
```

- [ ] **Step 2: Update `TerminalPane.tsx` to use utility + subscribe to theme changes**

Replace the theme import and theme object in the Terminal constructor:

```typescript
// Remove: import { tokens } from '../../design-system/tokens'
// Add:
import { getTerminalTheme } from '../../lib/terminal-theme'
import { useThemeStore } from '../../stores/theme'
```

In the `useEffect` that creates the terminal, replace the theme config:

```typescript
    const term = new Terminal({
      theme: getTerminalTheme(),
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true
    })
```

After the terminal creation `useEffect`, add a new effect for theme reactivity:

```typescript
  // React to theme changes for existing terminal instances
  useEffect(() => {
    const unsub = useThemeStore.subscribe((state) => state.theme, () => {
      const term = termRef.current
      if (term) {
        // Small delay to let CSS variables update after class toggle
        requestAnimationFrame(() => {
          term.options.theme = getTerminalTheme()
        })
      }
    })
    return unsub
  }, [])
```

Note: `useThemeStore.subscribe` with a selector is a Zustand v4+ feature that returns an unsubscribe function. The `requestAnimationFrame` ensures the CSS class has been applied before reading computed styles.

- [ ] **Step 3: Verify build and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/terminal-theme.ts \
       src/renderer/src/components/terminal/TerminalPane.tsx
git commit -m "feat(theme): add xterm theme utility with live theme reactivity"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Visual QA checklist (manual, in dev mode)**

Toggle between dark and light themes via Settings > Appearance and verify each view:
- [ ] **Agents view** — session list, chat messages, tool badges, thinking blocks
- [ ] **Terminal view** — terminal background/text, tab bar status dots, find bar
- [ ] **Sprint view** — task cards, PR rows, spec drawer, overlays
- [ ] **PR Station** — PR list, repo badges, merged badges, diff viewer, review dialog
- [ ] **Cost view** — cost panels, badges, table rows, PR links
- [ ] **Memory view** — header, content area
- [ ] **Settings view** — all sections, template badges, appearance toggles
- [ ] **Panel system** — drop overlay highlight during drag
- [ ] **Command palette** — backdrop, items
- [ ] **Toasts** — trigger a toast notification in both themes
