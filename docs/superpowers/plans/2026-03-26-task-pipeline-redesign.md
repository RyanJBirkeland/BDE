# Task Pipeline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Sprint → Task Pipeline, unify CSS to v2 neon tokens, extract inline styles, improve sidebar and detail pane layout.

**Architecture:** Pure UI/CSS refactor — no data layer, IPC, or business logic changes. All modifications are in renderer components, CSS files, and layout stores. The view type `'sprint'` is preserved internally.

**Tech Stack:** React, TypeScript, CSS custom properties (v2 neon design system), Zustand

**Spec:** `docs/superpowers/specs/2026-03-26-task-pipeline-redesign-design.md`

---

### Task 1: Rename user-visible labels Sprint → Task Pipeline

**Files:**

- Modify: `src/renderer/src/stores/panelLayout.ts:39`
- Modify: `src/renderer/src/App.tsx:26,32,44`
- Modify: `src/renderer/src/components/layout/NeonSidebar.tsx:39`
- Modify: `src/renderer/src/components/layout/OverflowMenu.tsx:37`
- Modify: `src/renderer/src/components/layout/CommandPalette.tsx:83`
- Modify: `src/renderer/src/components/sprint/CircuitPipeline.tsx:50`
- Modify: `src/renderer/src/components/layout/__tests__/OverflowMenu.test.tsx:259`

- [ ] **Step 1: Update all label strings**

In `panelLayout.ts` line 39: `sprint: 'Sprint'` → `sprint: 'Task Pipeline'`
In `App.tsx` line 44: `sprint: 'Sprint Center'` → `sprint: 'Task Pipeline'`
In `App.tsx` line 26: comment `⌘4=sprint` → `⌘4=task-pipeline`
In `NeonSidebar.tsx` line 39: `sprint: 'Sprint Center'` → `sprint: 'Task Pipeline'`
In `OverflowMenu.tsx` line 37: `sprint: 'Sprint Center'` → `sprint: 'Task Pipeline'`
In `CommandPalette.tsx` line 83: `'Go to Sprint'` → `'Go to Task Pipeline'`
In `CircuitPipeline.tsx` line 50: `Sprint Pipeline` → `Task Pipeline`

- [ ] **Step 2: Update test assertion**

In `OverflowMenu.test.tsx` line 259: `'Sprint Center'` → `'Task Pipeline'`

- [ ] **Step 3: Run tests**

Run: `npm test -- --run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: rename Sprint to Task Pipeline in all user-visible labels"
```

---

### Task 2: Extract SprintCenter inline styles to CSS classes

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintCenter.tsx`
- Modify: `src/renderer/src/assets/sprint-neon.css`

- [ ] **Step 1: Add CSS classes to sprint-neon.css**

Add classes for: `.sprint-center__layout`, `.sprint-center__sidebar`, `.sprint-center__sidebar-header`, `.sprint-center__repo-row`, `.sprint-center__repo-chip`, `.sprint-center__repo-chip--active`, `.sprint-center__content`

All using `--neon-*` tokens with spacious padding per the approved mockup.

- [ ] **Step 2: Replace inline styles in SprintCenter.tsx with CSS classes**

Replace inline `style={{...}}` attributes with `className` references to the new CSS classes.

- [ ] **Step 3: Run tests**

Run: `npm test -- --run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract SprintCenter inline styles to sprint-neon.css classes"
```

---

### Task 3: Extract CircuitPipeline inline styles + add click-to-filter

**Files:**

- Modify: `src/renderer/src/components/sprint/CircuitPipeline.tsx`
- Modify: `src/renderer/src/assets/sprint-neon.css`

- [ ] **Step 1: Add CSS classes for pipeline**

Add `.circuit-pipeline`, `.circuit-pipeline__label`, `.circuit-pipeline__stages`, `.circuit-pipeline__stage`, `.circuit-pipeline__stage--active`, `.circuit-pipeline__arrow` to sprint-neon.css.

- [ ] **Step 2: Replace inline styles with CSS classes and add click handler**

Accept `onStageClick` prop. Each stage pill calls `onStageClick(filterValue)`. Pass `statusFilter` and highlight the active stage.

- [ ] **Step 3: Wire up in SprintCenter**

Pass `statusFilter` from `useSprintUI` and `setStatusFilter` as `onStageClick` to `CircuitPipeline`. Clicking active stage resets to `'all'`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: extract CircuitPipeline styles, add click-to-filter pipeline stages"
```

---

### Task 4: Migrate SprintTaskList to neon tokens + layout improvements

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintTaskList.tsx`
- Modify: `src/renderer/src/assets/sprint-neon.css`
- Modify: `src/renderer/src/assets/sprint.css`

- [ ] **Step 1: Add neon-styled task list classes to sprint-neon.css**

Override/replace the old `--bde-*` task list classes with neon-styled versions. Classes: `.sprint-task-list`, `.sprint-task-list__header`, `.sprint-task-list__search`, `.sprint-task-list__items`, `.sprint-task-list__empty`, `.sprint-task-list-item`, `.sprint-task-list-item--selected`, `.sprint-task-list-item__header`, `.sprint-task-list-item__title`, `.sprint-task-list-item__meta`, `.sprint-task-list-item__footer`, `.sprint-task-list-item__time`, `.sprint-task-list-item__pr`, `.sprint-task-list__filter-chip`, etc. All with spacious padding from mockup.

- [ ] **Step 2: Remove status filter chips from SprintTaskList**

Remove the `statusFilterOptions` mapping, `getFilterCount`, and the filter chips rendering block. Pipeline stages now handle filtering.

- [ ] **Step 3: Add colored accent dots to group headers**

Add a status-colored dot before each group label. Map group key to neon color: inProgress→purple, awaitingReview→blue, todo→cyan, blocked→orange, backlog→blue, done→pink, failed→red.

- [ ] **Step 4: Add left accent border to selected task items**

Update `.sprint-task-list-item--selected` to use `border-left: 3px solid var(--neon-purple)`.

- [ ] **Step 5: Remove old sprint.css task-list rules**

Delete lines ~2050-2256 from sprint.css (the `.sprint-task-list` and `.sprint-task-list-item` blocks).

- [ ] **Step 6: Run tests**

Run: `npm test -- --run`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: migrate SprintTaskList to neon design system, remove old sprint.css rules"
```

---

### Task 5: Redesign SprintDetailPane layout and polish

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintDetailPane.tsx`
- Modify: `src/renderer/src/assets/sprint-neon.css`

- [ ] **Step 1: Update detail pane CSS with spacious layout**

Update `.sprint-detail__header` padding to `20px 24px`. Update `.sprint-detail__body` padding to `20px 24px`, gap to `16px`. Update `.sprint-detail__section-body` padding to `16px 18px`.

- [ ] **Step 2: Replace Metadata section with inline meta strip**

Remove the `NeonSection` wrapping metadata. Render repo, priority, created, started dates as a flex row (`.sprint-detail__meta-strip`) with `20px` gaps directly in the header.

- [ ] **Step 3: Remove close button UI**

Remove the `✕` close button from the title row. Keep `onClose` prop for programmatic use.

- [ ] **Step 4: Add proper display status names**

Use `getStatusDisplay()` (already exists in SprintTaskList) for the status badge instead of raw `task.status`. Extract to a shared util or duplicate the small function.

- [ ] **Step 5: Promote Specification section visually**

Add `.sprint-detail__section--spec` class with purple-tinted background and purple border.

- [ ] **Step 6: Make agent run an inline bar**

When agent is active, render as a `.sprint-detail__agent-bar` row (pulsing dot, ID, status, link) instead of a collapsible `NeonSection`.

- [ ] **Step 7: Add dependency progress to section header**

Show "X of Y complete" text in the Dependencies section header.

- [ ] **Step 8: Run tests**

Run: `npm test -- --run`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: redesign SprintDetailPane with inline meta, promoted spec, agent bar"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --run`
Run: `npm run typecheck`
Expected: All pass

- [ ] **Step 2: Commit any remaining fixes**
