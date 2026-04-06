/**
 * Command palette E2E tests.
 * Verifies opening, filtering, selecting, and closing the palette.
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Command palette navigation', () => {
  test('Cmd+P opens palette, typing Sprint navigates to Sprint view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Open command palette with Cmd+P
    await window.keyboard.press('Meta+p')

    // Assert command palette is visible
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Assert input is focused and ready
    const paletteInput = window.locator('.command-palette__input')
    await expect(paletteInput).toBeVisible({ timeout: 3_000 })

    // Type "Sprint" to filter commands
    await paletteInput.fill('Sprint')

    // Assert filtered results contain a Sprint/Pipeline navigation item
    const sprintItem = window.locator('.command-palette__item', { hasText: /Sprint|Pipeline/ })
    await expect(sprintItem.first()).toBeVisible({ timeout: 3_000 })

    // Press Enter to select
    await window.keyboard.press('Enter')

    // Assert Sprint view is now active — sprint-pipeline component renders
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })

    // Assert command palette closes (AnimatePresence exit animation may take a moment)
    await expect(palette).not.toBeVisible({ timeout: 5_000 })
  })

  test('palette opens and closes with Escape', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Open palette
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Verify the input exists
    await expect(window.locator('.command-palette__input')).toBeVisible({ timeout: 3_000 })

    // Close with Escape
    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 3_000 })
  })

  test('palette shows grouped commands with list', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // The command list should have items
    const items = palette.locator('.command-palette__item')
    await expect(items.first()).toBeVisible({ timeout: 3_000 })

    // Should have group headers
    const groups = palette.locator('.command-palette__group-header')
    const groupCount = await groups.count()
    expect(groupCount).toBeGreaterThan(0)

    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 3_000 })
  })
})
