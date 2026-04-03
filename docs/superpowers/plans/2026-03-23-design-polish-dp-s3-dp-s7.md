# Design Polish (DP-S3 + DP-S7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply consistent aurora gradient headers to all views and add subtle fade-in motion on view mount.

**Architecture:** Two independent streams — DP-S3 adds aurora gradient headers + accent underlines to AgentsView, PRStationView, and TerminalView; DP-S7 wraps all 7 view root elements with `motion.div` for fade-in entrance. DP-S3 tasks come first since they modify root elements that DP-S7 will also touch.

**Tech Stack:** React, CSS, framer-motion (already installed), design-system tokens

**Spec:** `docs/superpowers/specs/2026-03-23-design-polish-dp-s3-dp-s7-design.md`

---

## File Structure

### New Files

```
src/renderer/src/assets/agents.css    # AgentsView header + spawn button styles
```

### Modified Files

```
src/renderer/src/views/AgentsView.tsx        # Migrate inline header → CSS classes, add motion.div
src/renderer/src/views/PRStationView.tsx     # Add view-level header, add motion.div
src/renderer/src/views/TerminalView.tsx      # Add motion.div
src/renderer/src/views/SprintView.tsx        # Wrap SprintCenter in motion.div
src/renderer/src/views/MemoryView.tsx        # Replace root div with motion.div
src/renderer/src/views/CostView.tsx          # Replace root div with motion.div
src/renderer/src/views/SettingsView.tsx      # Replace root div with motion.div
src/renderer/src/assets/terminal.css         # Add position: relative + ::after underline to header
src/renderer/src/assets/pr-station.css       # Add view-level header styles
```

---

## Task 1: Create agents.css and migrate AgentsView header

**Files:**

- Create: `src/renderer/src/assets/agents.css`
- Modify: `src/renderer/src/views/AgentsView.tsx:6-7,17,76,82-112`

- [ ] **Step 1: Create `agents.css`**

```css
/* ── Agents: Sidebar header ────────────────────────────── */

.agents-view__sidebar-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  border-bottom: 1px solid var(--border, var(--bde-border));
  flex-shrink: 0;
}

.agents-view__sidebar-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

.agents-view__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.agents-view__spawn-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: 1px solid var(--border, var(--bde-border));
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  color: var(--text-secondary, var(--bde-text-muted));
  transition:
    color 0.12s ease,
    border-color 0.12s ease;
}

.agents-view__spawn-btn:hover {
  color: var(--text-primary, var(--bde-text));
  border-color: var(--text-secondary, var(--bde-text-muted));
}
```

- [ ] **Step 2: Update AgentsView.tsx — replace inline header with CSS classes**

**Keep the `tokens` import** — it's still used by the sidebar div (line 82), resize handle (lines 122-125), right content area (line 128), and empty state (line 136). Only the header block is being migrated.

Add the CSS import at the top of the file (after line 6):

```tsx
import '../assets/agents.css'
```

Then replace lines 76-112 of the JSX. The root div at line 76:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: tokens.color.bg }}>
```

becomes:

```tsx
<div className="agents-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
```

The sidebar header block (lines 83-112):

```tsx
{
  /* Header */
}
;<div
  style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    borderBottom: `1px solid ${tokens.color.border}`
  }}
>
  <span
    style={{
      fontSize: tokens.size.xs,
      color: tokens.color.textMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontWeight: 600
    }}
  >
    Agents
  </span>
  <button
    onClick={() => setSpawnOpen(true)}
    title="Spawn Agent"
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      background: 'none',
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.sm,
      cursor: 'pointer',
      color: tokens.color.textMuted
    }}
  >
    <Plus size={14} />
  </button>
</div>
```

becomes:

```tsx
{
  /* Header */
}
;<div className="agents-view__sidebar-header">
  <span className="agents-view__title text-gradient-aurora">Agents</span>
  <button className="agents-view__spawn-btn" onClick={() => setSpawnOpen(true)} title="Spawn Agent">
    <Plus size={14} />
  </button>
</div>
```

- [ ] **Step 3: Verify build passes**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/assets/agents.css src/renderer/src/views/AgentsView.tsx
git commit -m "feat(DP-S3): migrate AgentsView header to CSS classes with aurora gradient"
```

---

## Task 2: Add view-level header to PRStationView

**Files:**

- Modify: `src/renderer/src/views/PRStationView.tsx:70-71`
- Modify: `src/renderer/src/assets/pr-station.css`

- [ ] **Step 1: Add view-level header CSS to `pr-station.css`**

Add at the top of the file (after the `.pr-station` rule, around line 7):

```css
/* ── PR Station: View header ───────────────────────────── */

.pr-station__view-header {
  position: relative;
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 16px;
  border-bottom: 1px solid var(--bde-border);
  flex-shrink: 0;
}

.pr-station__view-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}

.pr-station__view-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Update PRStationView.tsx — wrap with column layout, add header**

The current root (line 70-71):

```tsx
  return (
    <div className="pr-station">
```

The `.pr-station` class uses `display: flex; height: 100%` for the horizontal split. We need a column wrapper above it. **Important:** `.pr-station` has `height: 100%` which won't fill remaining space inside a flex column. Add `style={{ flex: 1, minHeight: 0 }}` on the inner `.pr-station` div so it fills the space below the header.

Replace lines 70-71 and the closing `</div>` at line 147:

```tsx
  return (
    <div className="pr-station-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pr-station__view-header">
        <span className="pr-station__view-title text-gradient-aurora">PR Station</span>
      </div>
      <div className="pr-station" style={{ flex: 1, minHeight: 0 }}>
```

And add a closing `</div>` before the final `</div>` at the end (two closing divs instead of one).

- [ ] **Step 3: Verify build passes**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/PRStationView.tsx src/renderer/src/assets/pr-station.css
git commit -m "feat(DP-S3): add view-level aurora header to PRStationView"
```

---

## Task 3: Fix TerminalView header — add accent underline

**Files:**

- Modify: `src/renderer/src/assets/terminal.css:11-19`

- [ ] **Step 1: Add `position: relative` and `::after` to terminal header**

In `terminal.css`, modify `.terminal-view__header` (line 11) to add `position: relative`:

```css
.terminal-view__header {
  position: relative;
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--border, var(--bde-border));
  background: var(--glass-tint-dark, var(--bde-surface));
  flex-shrink: 0;
}
```

Then add the `::after` rule right after (after line 19):

```css
.terminal-view__header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgba(0, 211, 127, 0.4) 0%,
    rgba(108, 142, 239, 0.2) 60%,
    transparent 100%
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/assets/terminal.css
git commit -m "feat(DP-S3): add accent underline to TerminalView header"
```

---

## Task 4: Add fade-in motion to AgentsView

**Files:**

- Modify: `src/renderer/src/views/AgentsView.tsx:6,75-76`

- [ ] **Step 1: Add motion imports**

Add after the existing imports (around line 6):

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add `useReducedMotion` hook and replace root div**

Inside the `AgentsView` function, add the hook:

```tsx
const reduced = useReducedMotion()
```

Replace the root div (which after Task 1 is):

```tsx
<div className="agents-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
```

with:

```tsx
<motion.div
  className="agents-view"
  style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
  variants={VARIANTS.fadeIn}
  initial="initial"
  animate="animate"
  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
>
```

And change the closing `</div>` (last one in the return) to `</motion.div>`.

- [ ] **Step 3: Verify build passes**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/AgentsView.tsx
git commit -m "feat(DP-S7): add fade-in motion to AgentsView"
```

---

## Task 5: Add fade-in motion to PRStationView

**Files:**

- Modify: `src/renderer/src/views/PRStationView.tsx:1,70`

- [ ] **Step 1: Add motion imports**

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add hook and replace root div**

Add `const reduced = useReducedMotion()` inside the component.

Replace the root wrapper div (which after Task 2 is):

```tsx
<div className="pr-station-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
```

with:

```tsx
<motion.div
  className="pr-station-wrapper"
  style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
  variants={VARIANTS.fadeIn}
  initial="initial"
  animate="animate"
  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
>
```

Change closing `</div>` to `</motion.div>`.

- [ ] **Step 3: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/PRStationView.tsx
git commit -m "feat(DP-S7): add fade-in motion to PRStationView"
```

---

## Task 6: Add fade-in motion to TerminalView

**Files:**

- Modify: `src/renderer/src/views/TerminalView.tsx:1-7,165-166`

- [ ] **Step 1: Add motion imports**

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add hook and replace root div**

Add `const reduced = useReducedMotion()` inside the component.

Replace line 166:

```tsx
    <div className="terminal-view">
```

with:

```tsx
    <motion.div
      className="terminal-view"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
```

Change closing `</div>` at line 200 to `</motion.div>`.

- [ ] **Step 3: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/TerminalView.tsx
git commit -m "feat(DP-S7): add fade-in motion to TerminalView"
```

---

## Task 7: Add fade-in motion to SprintView

**Files:**

- Modify: `src/renderer/src/views/SprintView.tsx`

SprintView currently returns `<SprintCenter />` directly with no wrapper div. Wrap it in a `motion.div`.

- [ ] **Step 1: Add imports and wrap**

Replace the entire file:

```tsx
/**
 * SprintView — Scrum Planning Center with Kanban board, spec drawer, and PR list.
 * Replaces the old read-only SprintBoard + PRList split layout.
 */
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { SprintCenter } from '../components/sprint/SprintCenter'

export default function SprintView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      style={{ height: '100%' }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <SprintCenter />
    </motion.div>
  )
}
```

- [ ] **Step 2: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/SprintView.tsx
git commit -m "feat(DP-S7): add fade-in motion to SprintView"
```

---

## Task 8: Add fade-in motion to MemoryView

**Files:**

- Modify: `src/renderer/src/views/MemoryView.tsx`

- [ ] **Step 1: Add motion imports**

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add hook and replace root div**

Add `const reduced = useReducedMotion()` inside the component.

Replace root div:

```tsx
<div className="memory-view memory-view--column">
```

with:

```tsx
<motion.div
  className="memory-view memory-view--column"
  variants={VARIANTS.fadeIn}
  initial="initial"
  animate="animate"
  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
>
```

Change closing `</div>` to `</motion.div>`.

- [ ] **Step 3: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/MemoryView.tsx
git commit -m "feat(DP-S7): add fade-in motion to MemoryView"
```

---

## Task 9: Add fade-in motion to CostView

**Files:**

- Modify: `src/renderer/src/views/CostView.tsx`

**Note:** CostView has TWO return statements — an early return for the loading skeleton (line 259) and the main return (line 275). Both use `<div className="cost-view cost-view--glass">` as root. Apply `motion.div` to **both** returns for consistent behavior.

- [ ] **Step 1: Add motion imports**

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add hook and replace BOTH root divs**

Add `const reduced = useReducedMotion()` inside the component (before the `if (loading)` check).

Replace both instances of root div:

```tsx
<div className="cost-view cost-view--glass">
```

with:

```tsx
<motion.div
  className="cost-view cost-view--glass"
  variants={VARIANTS.fadeIn}
  initial="initial"
  animate="animate"
  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
>
```

Change both closing `</div>` to `</motion.div>` (the outermost closing div of each return).

- [ ] **Step 3: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/CostView.tsx
git commit -m "feat(DP-S7): add fade-in motion to CostView"
```

---

## Task 10: Add fade-in motion to SettingsView

**Files:**

- Modify: `src/renderer/src/views/SettingsView.tsx`

- [ ] **Step 1: Add motion imports**

```tsx
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
```

- [ ] **Step 2: Add hook and replace root div**

Add `const reduced = useReducedMotion()` inside the component.

Replace root div:

```tsx
<div className="settings-view settings-view--column">
```

with:

```tsx
<motion.div
  className="settings-view settings-view--column"
  variants={VARIANTS.fadeIn}
  initial="initial"
  animate="animate"
  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
>
```

Change closing `</div>` to `</motion.div>`.

- [ ] **Step 3: Verify build + tests**

Run: `cd /Users/ryan/projects/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx
git commit -m "feat(DP-S7): add fade-in motion to SettingsView"
```

---

## Execution Summary

| Task | Story | What                                              | Files                                 |
| ---- | ----- | ------------------------------------------------- | ------------------------------------- |
| 1    | DP-S3 | AgentsView header → CSS classes + aurora gradient | `agents.css` (new), `AgentsView.tsx`  |
| 2    | DP-S3 | PRStationView view-level header                   | `PRStationView.tsx`, `pr-station.css` |
| 3    | DP-S3 | TerminalView header accent underline fix          | `terminal.css`                        |
| 4    | DP-S7 | Fade-in motion: AgentsView                        | `AgentsView.tsx`                      |
| 5    | DP-S7 | Fade-in motion: PRStationView                     | `PRStationView.tsx`                   |
| 6    | DP-S7 | Fade-in motion: TerminalView                      | `TerminalView.tsx`                    |
| 7    | DP-S7 | Fade-in motion: SprintView                        | `SprintView.tsx`                      |
| 8    | DP-S7 | Fade-in motion: MemoryView                        | `MemoryView.tsx`                      |
| 9    | DP-S7 | Fade-in motion: CostView                          | `CostView.tsx`                        |
| 10   | DP-S7 | Fade-in motion: SettingsView                      | `SettingsView.tsx`                    |

**Total tasks:** 10
**New files:** 1 (`agents.css`)
**New dependencies:** None (framer-motion already installed)
