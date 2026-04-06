/**
 * Agents view E2E tests.
 * Verifies the fleet sidebar, agent launchpad, and new agent button.
 *
 * The AgentsView has three zones:
 * 1. LiveActivityStrip (running agents as pills)
 * 2. Fleet sidebar (.agents-sidebar) + Agent Console / AgentLaunchpad
 * 3. Activity chart (collapsible)
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Agents view loads', () => {
  test('Agents view renders with fleet sidebar', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to Agents via Cmd+2
    await window.keyboard.press('Meta+2')

    // Wait for the fleet sidebar to be visible
    const sidebar = window.locator('.agents-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 5_000 })

    // Assert the sidebar has the "Fleet" label
    await expect(window.locator('text=Fleet')).toBeVisible({ timeout: 3_000 })

    // Assert the "New Agent" button (plus icon) is visible in sidebar header
    const newAgentBtn = window.locator('button[title="New Agent"]')
    await expect(newAgentBtn).toBeVisible({ timeout: 3_000 })
  })

  test('Empty state or launchpad shown when no agents exist', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })

    // With no agents, AgentLaunchpad or EmptyState should render
    // AgentLaunchpad shows when showLaunchpad is true or no agents exist
    // EmptyState shows "No agent selected" message
    const hasLaunchpad = await window
      .locator('text=No agent selected')
      .isVisible()
      .catch(() => false)
    const hasLaunchpadForm = await window
      .locator('[class*="agent-launchpad"]')
      .first()
      .isVisible()
      .catch(() => false)

    // Either launchpad or empty state should be present
    expect(hasLaunchpad || hasLaunchpadForm).toBe(true)
  })
})

test.describe('New agent flow', () => {
  test('Clicking New Agent button shows the launchpad', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })

    // Click the "New Agent" button
    const newAgentBtn = window.locator('button[title="New Agent"]')
    await expect(newAgentBtn).toBeVisible({ timeout: 3_000 })
    await newAgentBtn.click()

    // AgentLaunchpad should be visible (it replaces the console area)
    // Wait for launchpad content to render
    await expect(
      window.locator('[class*="agent-launchpad"]').first()
    ).toBeVisible({ timeout: 5_000 })
  })

  test('opens agent launchpad via command palette Spawn Agent command', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Open command palette with Cmd+P
    await window.keyboard.press('Meta+p')

    // Assert palette is visible
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Type "Spawn" to filter to the Spawn Agent command
    const paletteInput = window.locator('.command-palette__input')
    await paletteInput.fill('Spawn')

    // The "Spawn Agent" item should be visible
    const spawnItem = window.locator('.command-palette__item', { hasText: 'Spawn Agent' })
    await expect(spawnItem.first()).toBeVisible({ timeout: 3_000 })

    // Press Enter to select
    await window.keyboard.press('Enter')

    // Palette should close
    await expect(palette).not.toBeVisible({ timeout: 5_000 })

    // Should navigate to Agents view with launchpad open
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })
  })
})
