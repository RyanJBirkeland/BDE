import { test, expect } from './fixtures'

test.describe('Command palette navigation', () => {
  test('Cmd+P opens palette, typing Sprint navigates to Sprint view', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load on default Sessions view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('.sessions-chat')).toBeVisible({ timeout: 5_000 })

    // Open command palette with Cmd+P
    await window.keyboard.press('Meta+p')

    // Assert command palette is visible
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Type "Sprint" to filter commands
    const paletteInput = window.locator('.command-palette__input')
    await paletteInput.fill('Sprint')

    // Assert filtered results contain "Go to Sprint"
    const sprintItem = window.locator('.command-palette__item', { hasText: 'Go to Sprint' })
    await expect(sprintItem).toBeVisible()

    // Press Enter to select
    await window.keyboard.press('Enter')

    // Assert Sprint view is now active — sprint-center component renders
    const sprintView = window.locator('.sprint-center')
    await expect(sprintView).toBeVisible({ timeout: 5_000 })

    // Assert command palette closes (AnimatePresence exit animation may take a moment)
    await expect(palette).not.toBeVisible({ timeout: 5_000 })
  })

  test('palette opens and closes with Escape', async ({ bde }) => {
    const { window } = bde

    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Open palette
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Close with Escape
    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 2_000 })
  })
})
