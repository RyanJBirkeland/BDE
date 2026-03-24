import { test, expect } from './fixtures'

test.describe('Cost View', () => {
  test('navigates to Cost View and shows title', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Cost View via Cmd+6
    await window.keyboard.press('Meta+6')

    // Assert Cost View renders
    const costView = window.locator('.cost-view')
    await expect(costView).toBeVisible({ timeout: 5_000 })

    // Assert title is "Cost Tracker"
    const title = costView.locator('.cost-view__title')
    await expect(title).toBeVisible()
    await expect(title).toHaveText('Cost Tracker')
  })

  test('summary panels container is visible and contains content', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Cost View via Cmd+6
    await window.keyboard.press('Meta+6')

    // Wait for the Cost View to appear
    await expect(window.locator('.cost-view')).toBeVisible({ timeout: 5_000 })

    // Assert scroll container and panels container are visible
    const scroll = window.locator('.cost-view__scroll')
    await expect(scroll).toBeVisible()

    const panels = window.locator('.cost-view__panels')
    await expect(panels).toBeVisible()

    // Panels container should have at least one child element
    await expect(panels.locator('> *').first()).toBeVisible({ timeout: 5_000 })
  })
})
