# DP-S7: Motion System Adoption

**Epic:** Design Polish
**Priority:** P2
**Depends on:** DP-S1

---

## Problem

`lib/motion.ts` defines a comprehensive spring-based animation system (5 springs, 3 transitions, 7 variants) — but it's barely used. The app feels static, with most transitions being instant cuts or basic CSS `ease` curves.

### motion.ts Usage Audit

| File                 | What's Imported | Usage                                |
| -------------------- | --------------- | ------------------------------------ |
| `App.tsx`            | motion.ts       | ShortcutsOverlay animation (assumed) |
| `AgentRow.tsx`       | motion.ts       | Session card entrance animation      |
| `SpawnModal.tsx`     | motion.ts       | Modal entrance/exit                  |
| `AgentList.tsx`      | motion.ts       | List stagger animation               |
| `CommandPalette.tsx` | motion.ts       | Palette entrance/exit                |

**Not using motion.ts:**

- View transitions (`.view-enter` uses CSS `bde-slide-up-fade 120ms ease`)
- Sprint cards (use CSS `bde-slide-up-fade` with `animation-delay`)
- SpecDrawer (uses CSS `transform: translateX` transition)
- Toast notifications (use CSS `toast-slide-in` keyframe)
- Any drag-and-drop feedback
- Any list in DiffView, MemoryView, CostView, SettingsView

### Current CSS Animations

| Animation           | Duration | Easing       | Used By                                |
| ------------------- | -------- | ------------ | -------------------------------------- |
| `bde-fade-in`       | unset    | linear       | Unused                                 |
| `bde-slide-up-fade` | 200ms    | ease         | Sprint cards, view-enter (120ms)       |
| `bde-scale-fade-in` | 150ms    | ease         | Command palette, PR confirm, shortcuts |
| `bde-shimmer`       | 1.5s     | ease-in-out  | Skeleton loading                       |
| `toast-slide-in`    | 0.25s    | ease-out     | Toasts                                 |
| `log-drawer-up`     | 250ms    | cubic-bezier | Log drawer                             |
| `bde-pulse`         | 1.5s     | ease-in-out  | Agent running dot                      |
| `pulse-glow`        | 2.5s     | ease-in-out  | Glow pulse effect                      |

---

## Solution

### 1. View transitions — use `VARIANTS.fadeIn` + `SPRINGS.default`

Replace the CSS `.view-enter` animation with framer-motion's `AnimatePresence`:

```tsx
// ViewRouter wrapper
<AnimatePresence mode="wait">
  <motion.div
    key={activeView}
    variants={VARIANTS.fadeIn}
    initial="initial"
    animate="animate"
    exit="exit"
    transition={TRANSITIONS.crossfade}
    className="view-enter"
  >
    {renderView()}
  </motion.div>
</AnimatePresence>
```

Remove the CSS `animation` from `.view-enter` — let framer-motion handle it.

### 2. List stagger — use `VARIANTS.staggerContainer` + `VARIANTS.staggerChild`

Apply to:

- **Sprint cards** in KanbanColumn: Wrap card list in `motion.div` with `staggerContainer` variant, each card gets `staggerChild`.
- **Memory file list**: Stagger entrance when sidebar populates.
- **Cost session table rows**: Stagger entrance on initial load.
- **DiffView file list**: Stagger file items in sidebar.

This replaces the current `animation-delay: calc(var(--stagger-index) * 30ms)` pattern in sprint.css.

### 3. SpecDrawer — use `VARIANTS.slideLeft` + `SPRINGS.smooth`

Replace the CSS `transform: translateX` transition with framer-motion for the drawer slide:

```tsx
<motion.div
  className="spec-drawer"
  initial={{ x: 420 }}
  animate={{ x: 0 }}
  exit={{ x: 420 }}
  transition={SPRINGS.smooth}
/>
```

### 4. Toast notifications — use `VARIANTS.dropIn` + `SPRINGS.snappy`

Replace CSS `toast-slide-in` with framer-motion entrance for snappier, spring-based feel.

### 5. Modal/dialog entrances — ensure consistency

All modals already use motion.ts (SpawnModal, CommandPalette). Ensure:

- PR confirm dialog uses `VARIANTS.scaleIn`
- NewTicketModal uses `VARIANTS.scaleIn` (already uses `glass-modal`)

### 6. Respect `prefers-reduced-motion`

`motion.ts` has a comment about respecting this at the component level. Add a utility:

```tsx
export function useReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
```

Use it to disable spring animations when the user has reduced motion enabled (fall back to `TRANSITIONS.instant`).

---

## Files to Modify

| File                                                    | Change                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/renderer/src/App.tsx`                              | Wrap ViewRouter output in `AnimatePresence`                                  |
| `src/renderer/src/lib/motion.ts`                        | Add `useReducedMotion` hook                                                  |
| `src/renderer/src/components/sprint/KanbanColumn.tsx`   | Stagger card list with motion variants                                       |
| `src/renderer/src/components/sprint/SpecDrawer.tsx`     | Replace CSS transition with framer-motion                                    |
| `src/renderer/src/components/layout/ToastContainer.tsx` | Replace CSS keyframe with framer-motion                                      |
| `src/renderer/src/assets/base.css`                      | Remove `bde-slide-up-fade` from `.view-enter` (keep keyframe for other uses) |
| `src/renderer/src/assets/sprint.css`                    | Remove `animation` + `animation-delay` from `.sprint-card`, `.task-card`     |

## Acceptance Criteria

- [ ] View switches use framer-motion crossfade (not CSS keyframe)
- [ ] Sprint cards stagger-animate on mount using `VARIANTS.staggerContainer`
- [ ] SpecDrawer slides in/out using spring physics
- [ ] Toast notifications use spring-based entrance
- [ ] `prefers-reduced-motion: reduce` disables all spring animations
- [ ] No duplicate animation systems (CSS keyframe + framer-motion) for the same element
- [ ] `npm run build` and `npm test` pass
- [ ] framer-motion is already a dependency (verify) or add it

## Risks

- framer-motion adds bundle size (~30KB gzipped). Verify it's already in `package.json`. If not, evaluate whether the polish justifies the weight for an Electron app (likely yes — Electron apps are less size-sensitive).
- Stagger animations on large lists (100+ sprint cards) could feel sluggish. Cap stagger to first 20 items.
