/**
 * Panel layout regression tests.
 *
 * Guards against two classes of bugs:
 *   1. Sidebar panels collapsing to ~25px (missing width: 100% on view containers)
 *   2. Drawers/overlays being clipped by overflow: hidden on ancestor containers
 *
 * Each test navigates to a view and asserts that the sidebar has a meaningful
 * rendered width (>= 120px) — catching cases where react-resizable-panels fails
 * to distribute space because the outer container has no explicit width.
 */
import { test, expect, waitForAppShell } from './fixtures'
import { seedTask, cleanupTestTasks } from './helpers/seed-data'

const MIN_SIDEBAR_WIDTH = 120 // px — anything less signals a collapse bug

// ---------------------------------------------------------------------------
// Code Review sidebar
// ---------------------------------------------------------------------------

test.describe('Code Review — sidebar width', () => {
  test('cr-queue sidebar has usable width', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    const queue = window.locator('.cr-queue')
    await expect(queue).toBeVisible({ timeout: 3_000 })

    const box = await queue.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
  })

  test('cr-queue sidebar is not clipped — count badge fully visible', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    // Count badge must be within the visible viewport (not clipped off-screen)
    const badge = window.locator('.cr-queue__count')
    await expect(badge).toBeVisible({ timeout: 3_000 })

    const badgeBox = await badge.boundingBox()
    const viewBox = await window.locator('.cr-view').boundingBox()
    expect(badgeBox).not.toBeNull()
    expect(viewBox).not.toBeNull()

    // Badge x-position should be within the view bounds
    expect(badgeBox!.x).toBeGreaterThanOrEqual(viewBox!.x)
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(viewBox!.x + viewBox!.width + 1)
  })

  test('Code Review empty state — no task selected shows placeholder', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    // With no task selected the main area should render a placeholder / empty state
    const main = window.locator('.cr-main')
    await expect(main).toBeVisible({ timeout: 3_000 })

    // Main area must have real height — not squashed to 0
    const box = await main.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThan(100)
  })
})

// ---------------------------------------------------------------------------
// Settings sidebar
// ---------------------------------------------------------------------------

test.describe('Settings — sidebar width', () => {
  test('stg-sidebar has usable width', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    const sidebar = window.locator('.stg-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 3_000 })

    const box = await sidebar.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
  })

  test('Settings sidebar items are not clipped — Appearance item fully visible', async ({
    fleet
  }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    const item = window.locator('.stg-sidebar__item', { hasText: 'Appearance' })
    await expect(item).toBeVisible({ timeout: 3_000 })

    const itemBox = await item.boundingBox()
    const layoutBox = await window.locator('.stg-layout').boundingBox()
    expect(itemBox).not.toBeNull()
    expect(layoutBox).not.toBeNull()

    // Item must sit within the layout bounds
    expect(itemBox!.x).toBeGreaterThanOrEqual(layoutBox!.x)
    expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(layoutBox!.x + layoutBox!.width + 1)
  })
})

// ---------------------------------------------------------------------------
// Agents sidebar
// ---------------------------------------------------------------------------

test.describe('Agents — sidebar width', () => {
  test('agents-sidebar has usable width', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')

    const sidebar = window.locator('.agents-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 5_000 })

    const box = await sidebar.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
  })

  test('Fleet header and New Agent button are not clipped', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })

    const btn = window.locator('button[title="New Agent"]')
    await expect(btn).toBeVisible({ timeout: 3_000 })

    // Button bounding box must be within the sidebar
    const btnBox = await btn.boundingBox()
    const sidebarBox = await window.locator('.agents-sidebar').boundingBox()
    expect(btnBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()

    expect(btnBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x)
    expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width + 1)
  })

  test('Agents empty state — launchpad or empty message visible', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })

    // The right pane must show either the launchpad or the empty-state message
    const hasLaunchpad = await window
      .locator('[class*="agent-launchpad"]')
      .first()
      .isVisible()
      .catch(() => false)
    const hasEmptyMsg = await window
      .locator('text=No agent selected')
      .isVisible()
      .catch(() => false)

    expect(hasLaunchpad || hasEmptyMsg).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sprint — task detail drawer not clipped
// ---------------------------------------------------------------------------

test.describe('Sprint Pipeline — detail drawer not clipped', () => {
  const TEST_PREFIX = 'e2e-layout-'

  test.afterEach(async ({ fleet }) => {
    await cleanupTestTasks(fleet.window, TEST_PREFIX)
  })

  test('Task detail drawer renders at full height when opened', async ({ fleet }) => {
    const { window } = fleet
    await waitForAppShell(window)

    const task = await seedTask(window, {
      title: `${TEST_PREFIX}drawer-${Date.now()}`,
      status: 'queued',
      spec: '## Overview\nLayout test\n\n## Details\nFor E2E layout regression testing'
    })

    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })

    // Open the task detail drawer
    const pill = window
      .locator('[data-testid="pipeline-stage-queued"]')
      .locator('text=' + task.title)
    await expect(pill).toBeVisible({ timeout: 5_000 })
    await pill.click()

    const drawer = window.locator('[data-testid="task-detail-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 5_000 })

    // Drawer must have real height — proves it is not clipped to 0 by overflow: hidden
    const box = await drawer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThan(200)
    expect(box!.width).toBeGreaterThan(200)
  })
})
