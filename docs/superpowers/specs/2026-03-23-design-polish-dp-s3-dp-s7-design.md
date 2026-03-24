# Design Polish: Aurora Headers (DP-S3) + Motion Adoption (DP-S7)

**Date:** 2026-03-23
**Epic:** Design Polish (`docs/epic-design-polish.md`)
**Goal:** Complete the last two design polish stories — consistent aurora gradient headers on all views, and subtle fade-in motion on view mount.

---

## DP-S3: Aurora Gradient Headers

### Problem

5 of 7 views have gradient headers. AgentsView uses inline styles with plain muted text. PRStationView lacks the aurora treatment on its view header.

### Design

**Standard gradient:** Both remaining views use `text-gradient-aurora` (the `--gradient-aurora` CSS variable: green→cyan at 135deg). No custom per-view gradients.

#### AgentsView

- Migrate all inline header styles to CSS classes following the established pattern:
  - `.agents-view__header` — flex container with padding and bottom border
  - `.agents-view__title` — 13px, 700 weight, uppercase, 0.10em letter-spacing, `text-gradient-aurora`
- Add `::after` accent underline on `.agents-view__header` matching the gradient underline pattern used by Terminal, Cost, Memory, Settings, Sprint
- CSS goes in `src/renderer/src/assets/agents.css` (new file, imported in the view)

#### PRStationView

- Apply `text-gradient-aurora` class to the existing view header title
- Add `::after` accent underline if not already present
- Use existing CSS file for PR Station styles

### Pattern Reference

All view headers follow this structure:

```css
.{view}__header {
  position: relative;
  /* flex layout, padding */
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

Each view's root element wraps with `motion.div`:

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
      {/* existing content */}
    </motion.div>
  )
}
```

#### Affected Views

All 7 views:

1. AgentsView
2. TerminalView
3. SprintView
4. PRStationView
5. MemoryView
6. CostView
7. SettingsView

#### Constraints

- Always respect `useReducedMotion()` — fall back to `REDUCED_TRANSITION`
- Use `SPRINGS.snappy` for quick, non-distracting entrance
- No `exit` animations (views unmount instantly when switching)
- No `AnimatePresence` wrapper needed at the view level

---

## Out of Scope

- Custom per-view gradient colors (decided: standard aurora for all new headers)
- List item stagger animations
- Panel resize / sidebar collapse animations
- View exit animations
- Unused heading classes cleanup (`heading-page`, `heading-hero`, `heading-section`)
