/**
 * Code Review view (Cmd+5) E2E tests.
 * PR Station was replaced by Code Review Station. The view renders
 * ReviewQueue (sidebar), ReviewDetail (main), and ReviewActions.
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Code Review', () => {
  test('Navigate to Code Review view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to Code Review via Cmd+5
    await window.keyboard.press('Meta+5')

    // Assert Code Review view renders with cr-view class
    const crView = window.locator('.cr-view')
    await expect(crView).toBeVisible({ timeout: 5_000 })

    // Assert "Review Queue" title is visible in the queue sidebar
    const title = window.locator('.cr-queue__title')
    await expect(title).toBeVisible({ timeout: 3_000 })
    await expect(title).toContainText('Review Queue')
  })

  test('Review queue sidebar renders with count badge', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    // Assert queue sidebar is visible
    const queue = window.locator('.cr-queue')
    await expect(queue).toBeVisible({ timeout: 3_000 })

    // Count badge should be visible (shows number of review tasks)
    const count = queue.locator('.cr-queue__count')
    await expect(count).toBeVisible({ timeout: 3_000 })

    // Queue list should exist (may be empty)
    const list = queue.locator('.cr-queue__list')
    await expect(list).toBeVisible({ timeout: 3_000 })
  })

  test('Main content area renders when no task selected', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    // Main content area should exist
    const main = window.locator('.cr-main')
    await expect(main).toBeVisible({ timeout: 3_000 })
  })
})
