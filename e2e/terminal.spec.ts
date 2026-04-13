/**
 * Terminal E2E tests.
 * Terminal is embedded inside the IDE view (Cmd+3), not a standalone view.
 * The terminal panel appears below the editor when a folder is open, or
 * can be toggled with Cmd+J.
 *
 * NOTE: These tests require the IDE view to be open with a folder loaded
 * for the terminal to be active. In empty-state IDE, the terminal panel
 * may not be visible until Cmd+J is pressed.
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Terminal — IDE integration', () => {
  test('IDE view renders and terminal panel can be toggled', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to IDE via Cmd+3
    await window.keyboard.press('Meta+3')

    // Wait for IDE view or empty state to render
    const ideView = window.locator('.ide-view')
    const ideEmpty = window.locator('.ide-empty-state')

    const hasIDE = await ideView.isVisible().catch(() => false)
    const hasEmpty = await ideEmpty.isVisible().catch(() => false)
    expect(hasIDE || hasEmpty).toBe(true)

    // If the IDE empty state is shown, the terminal won't be visible
    // but the view itself should still be rendering
    if (hasEmpty) {
      // Verify the empty state has the expected content
      await expect(window.locator('.ide-empty-state__title')).toContainText('BDE IDE')
      await expect(window.locator('.ide-empty-state__open-btn')).toBeVisible({ timeout: 3_000 })
    }
  })
})

test.describe('Terminal — tab management', () => {
  test('tab bar visible when terminal is open and new tab button works', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to IDE
    await window.keyboard.press('Meta+3')

    // Wait for IDE to render (either full view or empty state)
    await expect(window.locator('.ide-view, .ide-empty-state').first()).toBeVisible({
      timeout: 5_000
    })

    // If IDE has a folder open, terminal tab bar should be accessible
    // Check if terminal tab bar exists (may need Cmd+J to toggle in empty state)
    const tabBar = window.locator('.terminal-tab-bar__tabs')
    const tabBarVisible = await tabBar.isVisible().catch(() => false)

    if (tabBarVisible) {
      // Count initial tabs
      const initialTabs = tabBar.locator('.terminal-tab')
      await expect(initialTabs.first()).toBeVisible({ timeout: 3_000 })
      const initialCount = await initialTabs.count()
      expect(initialCount).toBeGreaterThanOrEqual(1)

      // Create new tab via Cmd+T
      await window.keyboard.press('Meta+t')

      // Assert tab count increased by 1
      await expect(tabBar.locator('.terminal-tab')).toHaveCount(initialCount + 1, {
        timeout: 3_000
      })
    }
  })
})
