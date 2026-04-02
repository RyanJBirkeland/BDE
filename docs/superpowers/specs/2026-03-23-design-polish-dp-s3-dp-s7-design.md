# Design Polish: Aurora Headers (DP-S3) + Motion Adoption (DP-S7)

**Date:** 2026-03-23
**Epic:** Design Polish (`docs/epic-design-polish.md`)
**Goal:** Complete the last two design polish stories — consistent aurora gradient headers on all views, and subtle fade-in motion on view mount.

---

## DP-S3: Aurora Gradient Headers

### Problem

Most views have gradient headers, but with gaps:

- **AgentsView** — inline styles, plain muted text, no gradient, no underline
- **PRStationView** — no view-level header at all (it's a split list+detail layout with component-level headers only)
- **TerminalView** — has aurora title gradient but missing `::after` accent underline and `position: relative`

### Design

**Standard gradient:** Use `text-gradient-aurora` (the `--gradient-aurora` CSS variable: green→cyan at 135deg) and the standard green→blue `::after` underline for all new/fixed headers.

**Note on existing underline variation:** Memory uses purple (`rgba(167, 139, 250, 0.4)`), Settings uses blue (`rgba(108, 142, 239, 0.4)`). These are intentional per-view accents and stay as-is. New headers use the standard green→blue gradient.

#### AgentsView

- Migrate all inline header styles to CSS classes following the established pattern:
  - `.agents-view__header` — flex container, `position: relative`, padding, bottom border
  - `.agents-view__title` — 13px, 700 weight, uppercase, 0.10em letter-spacing, `text-gradient-aurora`
  - `.agents-view__spawn-btn` — the "+" button (currently inline-styled)
- **Deliberate style changes from current inline values:** `fontWeight: 600` → `700`, `letterSpacing: 0.05em` → `0.10em` — aligning with the standard used by all other view headers
- Add `::after` accent underline on `.agents-view__header`
- CSS goes in `src/renderer/src/assets/agents.css` (new file, imported in the view)

#### PRStationView

- PRStationView has no view-level header element. It renders a side-by-side list panel (`PRStationList`) and detail panel (`PRStationDetail`), each with their own component-level headers.
- **Add a view-level header** above the split layout: a thin bar with "PR STATION" title using `text-gradient-aurora` and `::after` underline, matching the pattern of all other views.
- CSS class: `.pr-station__view-header`, `.pr-station__view-title`
- Styles go in `src/renderer/src/assets/pr-station.css`

#### TerminalView (fix)

- Add `position: relative` to `.terminal-view__header`
- Add `::after` accent underline to `.terminal-view__header`
- Both additions go in `src/renderer/src/assets/terminal.css`

### Pattern Reference

All view headers follow this structure. **`position: relative` is required** for the `::after` to render correctly.

```css
.{view}__header {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 36px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.{view}__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 211, 127, 0.4) 0%, rgba(108, 142, 239, 0.2) 60%, transparent 100%);
}

.{view}__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  /* text-gradient-aurora class applied in JSX */
}
```

---

## DP-S7: Motion Adoption — Subtle Fade-In

### Problem

`motion.ts` defines 5 springs, 3 transitions, and 7 variants. Only 8 components use them (modals, toasts, kanban). All 7 views lack entrance animations.

### Design

**Level: Subtle.** Fade-in on mount only. No list stagger, no layout animations, no exit animations.

#### Implementation

Each view's root `<div>` is **replaced** (not wrapped) with `motion.div`. The `motion.div` must receive the existing root className and any inline styles to preserve flex/height layouts.

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

function SomeView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="some-view"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      {/* existing content unchanged */}
    </motion.div>
  )
}
```

**Important:** `motion.div` replaces the existing root `<div>`, inheriting its `className`, `style`, and any other props. This avoids inserting an extra DOM node that would break `height: 100%` / flex layouts.

#### Affected Views

All 7 views:

1. AgentsView
2. TerminalView
3. SprintView (note: wraps `SprintCenter`)
4. PRStationView
5. MemoryView
6. CostView
7. SettingsView

#### Constraints

- Always respect `useReducedMotion()` — fall back to `REDUCED_TRANSITION`
- Use `SPRINGS.snappy` for quick, non-distracting entrance
- No `exit` animations (views unmount instantly when switching)
- No `AnimatePresence` wrapper needed at the view level
- `motion.div` must replace, not wrap, the root element

---

## Out of Scope

- Custom per-view gradient colors (decided: standard aurora for all new headers)
- Standardizing existing per-view underline gradients (Memory purple, Settings blue stay as-is)
- List item stagger animations
- Panel resize / sidebar collapse animations
- View exit animations
- Unused heading classes cleanup (`heading-page`, `heading-hero`, `heading-section`)
