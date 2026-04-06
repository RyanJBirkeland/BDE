/**
 * Sprint Pipeline E2E tests.
 * Validates the SprintPipeline UI: stage rendering, task placement,
 * detail drawer interaction, and dependency blocking.
 *
 * Uses `data-testid` selectors for structural elements and
 * `.pipeline-stage__name--{status}` for stage columns.
 * Test tasks are prefixed with `e2e-sprint-` and cleaned up after each test.
 */
import { test, expect, waitForAppShell } from './fixtures'
import { seedTask, cleanupTestTasks } from './helpers/seed-data'

const TEST_PREFIX = 'e2e-sprint-'

/** Navigate to Sprint view and wait for pipeline to render. */
async function navigateToSprint(window: import('@playwright/test').Page): Promise<void> {
  await waitForAppShell(window)
  await window.keyboard.press('Meta+4')
  await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })
}

test.describe('Sprint Pipeline — stage rendering', () => {
  test.afterEach(async ({ bde }) => {
    await cleanupTestTasks(bde.window, TEST_PREFIX)
  })

  test('Pipeline view renders with queued, active, and done stage columns', async ({ bde }) => {
    const { window } = bde
    await navigateToSprint(window)

    // Verify the three primary stages exist via data-testid
    await expect(window.locator('[data-testid="pipeline-stage-queued"]')).toBeVisible({
      timeout: 5_000
    })
    await expect(window.locator('[data-testid="pipeline-stage-active"]')).toBeVisible({
      timeout: 5_000
    })
    await expect(window.locator('[data-testid="pipeline-stage-done"]')).toBeVisible({
      timeout: 5_000
    })

    // Verify stage labels via CSS class selectors
    await expect(window.locator('.pipeline-stage__name--queued')).toContainText('Queued')
    await expect(window.locator('.pipeline-stage__name--active')).toContainText('Active')
    await expect(window.locator('.pipeline-stage__name--done')).toContainText('Done')
  })
})

test.describe('Sprint Pipeline — task placement', () => {
  test.afterEach(async ({ bde }) => {
    await cleanupTestTasks(bde.window, TEST_PREFIX)
  })

  test('Seeded backlog task appears in the backlog sidebar', async ({ bde }) => {
    const { window } = bde

    const task = await seedTask(window, {
      title: `${TEST_PREFIX}backlog-${Date.now()}`,
      status: 'backlog'
    })

    await navigateToSprint(window)

    // Backlog sidebar should contain the task title
    const backlog = window.locator('[data-testid="pipeline-backlog"]')
    await expect(backlog).toBeVisible({ timeout: 5_000 })
    await expect(backlog.locator('text=' + task.title)).toBeVisible({ timeout: 5_000 })
  })

  test('Seeded queued task appears in the queued stage', async ({ bde }) => {
    const { window } = bde

    const task = await seedTask(window, {
      title: `${TEST_PREFIX}queued-${Date.now()}`,
      status: 'queued',
      spec: '## Overview\nTest task\n\n## Details\nFor E2E testing'
    })

    await navigateToSprint(window)

    // Queued stage should contain the task
    const queuedStage = window.locator('[data-testid="pipeline-stage-queued"]')
    await expect(queuedStage.locator('text=' + task.title)).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Sprint Pipeline — detail drawer', () => {
  test.afterEach(async ({ bde }) => {
    await cleanupTestTasks(bde.window, TEST_PREFIX)
  })

  test('Clicking a task pill opens the detail drawer', async ({ bde }) => {
    const { window } = bde

    const task = await seedTask(window, {
      title: `${TEST_PREFIX}drawer-${Date.now()}`,
      status: 'queued',
      spec: '## Overview\nDrawer test\n\n## Details\nFor E2E testing'
    })

    await navigateToSprint(window)

    // Click the task pill in the queued stage
    const queuedStage = window.locator('[data-testid="pipeline-stage-queued"]')
    const pill = queuedStage.locator('text=' + task.title)
    await expect(pill).toBeVisible({ timeout: 5_000 })
    await pill.click()

    // Detail drawer should open and show the task title
    const drawer = window.locator('[data-testid="task-detail-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 5_000 })
    await expect(drawer).toContainText(task.title as string)
  })
})

test.describe('Sprint Pipeline — blocked tasks', () => {
  test.afterEach(async ({ bde }) => {
    await cleanupTestTasks(bde.window, TEST_PREFIX)
  })

  test('Blocked task with hard dependency shows in blocked stage', async ({ bde }) => {
    const { window } = bde
    const ts = Date.now()

    // Seed a parent task (queued)
    const parent = await seedTask(window, {
      title: `${TEST_PREFIX}parent-${ts}`,
      status: 'queued',
      spec: '## Overview\nParent task\n\n## Details\nFor E2E testing'
    })

    // Seed a child task (queued initially)
    const child = await seedTask(window, {
      title: `${TEST_PREFIX}child-${ts}`,
      status: 'queued',
      spec: '## Overview\nChild task\n\n## Details\nFor E2E testing'
    })

    // Add hard dependency and set child to blocked
    await window.evaluate(
      async ({ childId, parentId }) => {
        await (window as any).api.sprint.update(childId, {
          depends_on: [{ id: parentId, type: 'hard' }],
          status: 'blocked'
        })
      },
      { childId: child.id, parentId: parent.id }
    )

    await navigateToSprint(window)

    // The child task should appear in the blocked stage
    const blockedStage = window.locator('[data-testid="pipeline-stage-blocked"]')
    await expect(blockedStage).toBeVisible({ timeout: 5_000 })
    await expect(blockedStage.locator('text=' + child.title)).toBeVisible({ timeout: 5_000 })
  })
})
