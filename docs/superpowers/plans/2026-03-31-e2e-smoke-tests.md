# E2E Smoke Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get E2E tests green — fix broken selectors, rewrite sprint tests for the new SprintPipeline UI, and add `data-testid` anchors for test stability.

**Architecture:** Fix existing E2E specs that use stale CSS selectors from deleted components (SprintCenter, KanbanBoard). Add `data-testid` attributes to key pipeline components. Rewrite `sprint.spec.ts` targeting the current SprintPipeline + PipelineBacklog + TaskDetailDrawer + SpecPanel UI. Verify all other specs pass as-is.

**Tech Stack:** Playwright, Electron, vitest (for renderer tests affected by data-testid additions).

---

## File Structure

### Modified files

- `e2e/navigation.spec.ts` — Fix 4 `.sprint-center__title` → `.sprint-pipeline__title` selectors
- `e2e/sprint.spec.ts` — Full rewrite for SprintPipeline UI
- `e2e/helpers/seed-data.ts` — Verify/update IPC calls match current API
- `src/renderer/src/components/sprint/SprintPipeline.tsx` — Add `data-testid` attributes
- `src/renderer/src/components/sprint/PipelineStage.tsx` — Add `data-testid`
- `src/renderer/src/components/sprint/PipelineBacklog.tsx` — Add `data-testid`
- `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` — Add `data-testid`
- `src/renderer/src/components/sprint/SpecPanel.tsx` — Add `data-testid`

---

## Task 1: Fix navigation.spec.ts selectors

**Files:**

- Modify: `e2e/navigation.spec.ts`

- [ ] **Step 1: Fix all `.sprint-center` references**

Replace all occurrences of `.sprint-center__title` with `.sprint-pipeline__title` and `.sprint-center` with `.sprint-pipeline`. There are ~6 occurrences across the file at lines referencing the Sprint/Task Pipeline view.

- [ ] **Step 2: Verify the file is syntactically correct**

Run: `cd ~/projects/BDE && npx tsc --noEmit e2e/navigation.spec.ts --skipLibCheck 2>&1 || echo "TS check done"`
Or just review the file manually — Playwright specs may not typecheck standalone.

- [ ] **Step 3: Commit**

```bash
git add e2e/navigation.spec.ts
git commit -m "fix: update navigation e2e selectors for SprintPipeline rename"
```

---

## Task 2: Add data-testid attributes to sprint components

**Files:**

- Modify: `src/renderer/src/components/sprint/SprintPipeline.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineStage.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineBacklog.tsx`
- Modify: `src/renderer/src/components/sprint/TaskDetailDrawer.tsx`
- Modify: `src/renderer/src/components/sprint/SpecPanel.tsx`

Add `data-testid` attributes to the root/key elements of each component. These provide stable E2E selectors that survive CSS class renames.

- [ ] **Step 1: Add data-testid to SprintPipeline**

In `SprintPipeline.tsx`, add `data-testid="sprint-pipeline"` to the root `<div>` and `data-testid="sprint-pipeline-title"` to the title element.

- [ ] **Step 2: Add data-testid to PipelineStage**

In `PipelineStage.tsx`, add `data-testid={`pipeline-stage-${name}`}` to each stage's root element (where `name` is the stage name like `queued`, `active`, `blocked`, `review`, `done`).

- [ ] **Step 3: Add data-testid to PipelineBacklog**

In `PipelineBacklog.tsx`, add `data-testid="pipeline-backlog"` to the root and `data-testid="backlog-card"` to each task card.

- [ ] **Step 4: Add data-testid to TaskDetailDrawer**

In `TaskDetailDrawer.tsx`, add `data-testid="task-detail-drawer"` to the drawer root element.

- [ ] **Step 5: Add data-testid to SpecPanel**

In `SpecPanel.tsx`, add `data-testid="spec-panel"` to the panel root element.

- [ ] **Step 6: Run renderer tests to ensure nothing broke**

Run: `cd ~/projects/BDE && npm test`
Expected: ALL PASS (data-testid attributes don't affect rendering or behavior)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/sprint/SprintPipeline.tsx src/renderer/src/components/sprint/PipelineStage.tsx src/renderer/src/components/sprint/PipelineBacklog.tsx src/renderer/src/components/sprint/TaskDetailDrawer.tsx src/renderer/src/components/sprint/SpecPanel.tsx
git commit -m "chore: add data-testid attributes to sprint pipeline components for E2E tests"
```

---

## Task 3: Rewrite sprint.spec.ts

**Files:**

- Modify: `e2e/sprint.spec.ts`
- Modify: `e2e/helpers/seed-data.ts` (verify IPC calls)

The old sprint.spec.ts tested KanbanBoard, NewTicketModal, and SpecDrawer — all deleted. Rewrite to test the current SprintPipeline UI.

- [ ] **Step 1: Verify seed-data.ts IPC calls are current**

Read `e2e/helpers/seed-data.ts`. It uses `window.api.sprint.create()` and `window.api.sprint.delete()`. Verify these exist in `src/preload/index.d.ts`. If the API signature changed, update `seed-data.ts`.

- [ ] **Step 2: Rewrite sprint.spec.ts**

Replace the entire file with tests targeting the current UI:

```ts
import { test, expect } from './fixtures'
import { seedTask, cleanupTestTasks } from './helpers/seed-data'

const PREFIX = 'e2e-sprint-'

test.describe('Sprint Pipeline', () => {
  test.afterEach(async ({ bde }) => {
    await cleanupTestTasks(bde.window, PREFIX)
  })

  test('pipeline view renders with stage columns', async ({ bde }) => {
    const { window } = bde
    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible()
    // Verify at least the main stage labels exist
    await expect(window.locator('.pipeline-stage__name--queued')).toBeVisible()
    await expect(window.locator('.pipeline-stage__name--active')).toBeVisible()
    await expect(window.locator('.pipeline-stage__name--done')).toBeVisible()
  })

  test('seeded backlog task appears in backlog sidebar', async ({ bde }) => {
    const { window } = bde
    const task = await seedTask(window, { title: `${PREFIX}backlog-task`, status: 'backlog' })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="pipeline-backlog"]')).toBeVisible()
    await expect(window.locator(`text=${PREFIX}backlog-task`)).toBeVisible()
  })

  test('seeded queued task appears in queued stage', async ({ bde }) => {
    const { window } = bde
    const task = await seedTask(window, {
      title: `${PREFIX}queued-task`,
      status: 'queued',
      spec: '## Overview\nTest task\n## Plan\nDo the thing'
    })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.pipeline-stage__name--queued')).toBeVisible()
    await expect(window.locator(`text=${PREFIX}queued-task`)).toBeVisible()
  })

  test('clicking a task pill opens the detail drawer', async ({ bde }) => {
    const { window } = bde
    const task = await seedTask(window, { title: `${PREFIX}detail-task`, status: 'backlog' })
    await window.keyboard.press('Meta+4')
    await window.locator(`text=${PREFIX}detail-task`).click()
    await expect(window.locator('[data-testid="task-detail-drawer"]')).toBeVisible()
  })

  test('blocked task shows blocked badge', async ({ bde }) => {
    const { window } = bde
    const dep = await seedTask(window, {
      title: `${PREFIX}dep-task`,
      status: 'queued',
      spec: '## A\nA\n## B\nB'
    })
    const blocked = await seedTask(window, {
      title: `${PREFIX}blocked-task`,
      status: 'blocked',
      depends_on: [{ id: dep.id, type: 'hard' }]
    })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.pipeline-stage__name--blocked')).toBeVisible()
    await expect(window.locator(`text=${PREFIX}blocked-task`)).toBeVisible()
  })
})
```

Adapt the test code based on what the actual `seedTask` helper returns and how the IPC creates tasks. The key patterns:

- Use `data-testid` selectors for structural elements (pipeline, backlog, drawer)
- Use CSS class selectors for stage-specific elements (`.pipeline-stage__name--queued`)
- Use text selectors for task titles
- Use `PREFIX` for test isolation + cleanup

- [ ] **Step 3: Commit**

```bash
git add e2e/sprint.spec.ts e2e/helpers/seed-data.ts
git commit -m "test: rewrite sprint e2e tests for SprintPipeline UI"
```

---

## Task 4: Verify all other E2E specs

**Files:**

- Review: `e2e/dashboard.spec.ts`, `e2e/agents.spec.ts`, `e2e/settings.spec.ts`, `e2e/ide.spec.ts`, `e2e/source-control.spec.ts`, `e2e/command-palette.spec.ts`, `e2e/cost.spec.ts`, `e2e/terminal.spec.ts`, `e2e/memory.spec.ts`, `e2e/pr-station.spec.ts`

- [ ] **Step 1: Read each spec and check for stale selectors**

Grep all e2e/\*.spec.ts files for `.sprint-center`, `.kanban-`, `.new-ticket-modal`, `.spec-drawer`, `.bde-task-table` — any stale class from the old SprintCenter component tree. Fix any found.

- [ ] **Step 2: Build the app for E2E**

Run: `cd ~/projects/BDE && npm run build`
Expected: Build succeeds (required before E2E tests can run)

- [ ] **Step 3: Run the full E2E suite**

Run: `cd ~/projects/BDE && npx playwright test --config playwright.config.ts`

If tests fail due to app launch issues (Electron not finding the build), check the Playwright config's `electronPath` and `args`. The app must be built first.

Note: E2E tests may need the app to be buildable, which requires `npm run build` to succeed. If the build fails, fix build issues first.

- [ ] **Step 4: Fix any failing specs**

Address failures iteratively. Common issues:

- Selectors for elements that render asynchronously need `await expect(...).toBeVisible({ timeout: 10_000 })`
- Text content may have changed — update expected strings
- Modal/drawer animations may need wait times

- [ ] **Step 5: Commit any fixes**

```bash
git add e2e/
git commit -m "fix: resolve remaining e2e test failures"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run renderer tests**

Run: `cd ~/projects/BDE && npm test`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run E2E suite**

Run: `cd ~/projects/BDE && npm run test:e2e`
Expected: All specs pass (or document known environment-dependent failures)
