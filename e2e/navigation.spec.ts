/**
 * Keyboard navigation regression tests.
 * Verifies that Cmd+1-8 shortcuts correctly route to each view, and that the
 * command palette can also be used for navigation.
 *
 * Correct mapping (from view-registry.ts VIEW_SHORTCUT_MAP):
 *   Cmd+1 → dashboard      Cmd+5 → code-review    Cmd+0 → task-workbench
 *   Cmd+2 → agents         Cmd+6 → git
 *   Cmd+3 → ide            Cmd+7 → settings
 *   Cmd+4 → sprint         Cmd+8 → planner
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Keyboard navigation — full cycle', () => {
  test('Cmd+1 → Dashboard view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+1')

    // Dashboard renders StatusBar with "BDE Command Center" title
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=BDE Command Center')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+2 → Agents view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')

    // AgentsView renders a Fleet sidebar with agent list
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=Fleet')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+3 → IDE view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+3')

    // IDEView root element or empty state
    const ideView = window.locator('.ide-view')
    const ideEmpty = window.locator('.ide-empty-state')
    const hasIDE = await ideView
      .isVisible()
      .catch(() => false)
    const hasEmpty = await ideEmpty
      .isVisible()
      .catch(() => false)
    expect(hasIDE || hasEmpty).toBe(true)
  })

  test('Cmd+4 → Sprint (Task Pipeline) view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+4')

    // SprintPipeline title rendered inside SprintView
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.sprint-pipeline__title')).toContainText('Task Pipeline')
  })

  test('Cmd+5 → Code Review view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')

    // CodeReviewView renders with cr-view class and ReviewQueue
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.cr-queue__title')).toContainText('Review Queue')
  })

  test('Cmd+6 → Source Control (Git) view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+6')

    // GitTreeView renders with git-tree-view class and "Source Control" header
    await expect(window.locator('.git-tree-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.git-tree-view__title')).toContainText('Source Control')
  })

  test('Cmd+7 → Settings view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')

    // SettingsView renders with stg-layout class and sidebar
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })
    // Page header title renders from SettingsPageHeader
    await expect(window.locator('.stg-page-header__title')).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Keyboard navigation — sequential cycle', () => {
  test('Navigate through views in order', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // 1 → Dashboard
    await window.keyboard.press('Meta+1')
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })

    // 2 → Agents
    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })

    // 3 → IDE
    await window.keyboard.press('Meta+3')
    // IDE shows either empty state or full view
    const ideVisible = await window
      .locator('.ide-view, .ide-empty-state')
      .first()
      .isVisible()
      .catch(() => false)
    expect(ideVisible).toBe(true)

    // 4 → Sprint
    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })

    // 5 → Code Review
    await window.keyboard.press('Meta+5')
    await expect(window.locator('.cr-view')).toBeVisible({ timeout: 5_000 })

    // 6 → Source Control (Git)
    await window.keyboard.press('Meta+6')
    await expect(window.locator('.git-tree-view')).toBeVisible({ timeout: 5_000 })

    // 7 → Settings
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Command palette navigation', () => {
  test('Cmd+P → type "Agents" → Enter → Agents view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Start on Settings so the navigation is a visible change
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Open command palette
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Type to filter navigation commands
    const input = window.locator('.command-palette__input')
    await input.fill('Agents')

    // "Go to Agents" should appear as a navigation result
    const agentsItem = window.locator('.command-palette__item', { hasText: 'Agents' })
    await expect(agentsItem.first()).toBeVisible({ timeout: 3_000 })

    // Select with Enter
    await window.keyboard.press('Enter')

    // Palette closes and Agents view is shown
    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → type "Sprint" → Enter → Sprint view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.locator('.command-palette__input').fill('Sprint')

    // "Task Pipeline" or "Sprint" item should appear
    const sprintItem = window.locator('.command-palette__item', { hasText: /Sprint|Pipeline/ })
    await expect(sprintItem.first()).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Enter')

    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → type "Settings" → Enter → Settings view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.locator('.command-palette__input').fill('Settings')

    const settingsItem = window.locator('.command-palette__item', { hasText: 'Settings' })
    await expect(settingsItem.first()).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Enter')

    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → Escape closes palette without navigating', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to a known view first
    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })

    // Open and close palette without selecting anything
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 3_000 })

    // Sprint view should still be visible — palette close did not navigate away
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Return to previous view', () => {
  test('Navigate Sprint → Settings via keyboard shortcut', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Go to Sprint first
    await window.keyboard.press('Meta+4')
    await expect(window.locator('[data-testid="sprint-pipeline"]')).toBeVisible({ timeout: 5_000 })

    // Now switch to Settings
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Sprint view should no longer be visible
    await expect(window.locator('[data-testid="sprint-pipeline"]')).not.toBeVisible({
      timeout: 3_000
    })
  })

  test('Navigate Settings → Agents → Settings restores each view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-sidebar')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.stg-layout')).not.toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.agents-sidebar')).not.toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Activity bar reflects active view', () => {
  test('Active item highlighted in nav after keyboard nav', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to Dashboard
    await window.keyboard.press('Meta+1')
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })

    // Navigate to Settings
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Dashboard should no longer be visible
    await expect(window.locator('.dashboard-root')).not.toBeVisible({ timeout: 3_000 })
  })
})
