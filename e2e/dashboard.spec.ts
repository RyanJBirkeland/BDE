/**
 * Dashboard view smoke tests.
 * Verifies the default view renders with all 4 dashboard cards.
 */
import { test, expect } from './fixtures'

/** Wait for the app shell to finish loading before asserting anything. */
async function waitForAppShell(window: import('@playwright/test').Page): Promise<void> {
  await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
}

test.describe('Dashboard — smoke tests', () => {
  test('App launches to Dashboard as default view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Dashboard is the default view (Cmd+1). On launch, "Active Tasks" card text should be visible.
    await expect(window.locator('text=Active Tasks')).toBeVisible({ timeout: 5_000 })
  })

  test('Dashboard shows 4 cards', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to dashboard explicitly to be certain
    await window.keyboard.press('Meta+1')

    // Each DashboardCard renders a title span inside a header div.
    // The 4 cards are: Active Tasks, Recent Completions, Cost Summary, Open PRs
    await expect(window.locator('text=Active Tasks')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=Recent Completions')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=Cost Summary')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=Open PRs')).toBeVisible({ timeout: 5_000 })
  })

  test('Each card has a visible title', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+1')

    const expectedTitles = ['Active Tasks', 'Recent Completions', 'Cost Summary', 'Open PRs']

    for (const title of expectedTitles) {
      const titleLocator = window.locator(`text=${title}`)
      await expect(titleLocator).toBeVisible({ timeout: 5_000 })

      // The title text should be non-empty (rendered by DashboardCard's title span)
      const text = await titleLocator.textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }
  })
})
