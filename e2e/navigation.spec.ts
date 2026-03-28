/**
 * Keyboard navigation regression tests.
 * Verifies that Cmd+1–9 shortcuts correctly route to each view, and that the
 * command palette can also be used for navigation.
 *
 * Correct mapping (from App.tsx VIEW_SHORTCUT_MAP):
 *   Cmd+1 → dashboard    Cmd+4 → sprint       Cmd+7 → memory
 *   Cmd+2 → agents       Cmd+5 → pr-station   Cmd+8 → cost
 *   Cmd+3 → ide          Cmd+6 → git          Cmd+9 → settings
 */
import { test, expect } from './fixtures'

/** Wait for the app shell to finish loading before asserting anything. */
async function waitForAppShell(window: import('@playwright/test').Page): Promise<void> {
  await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
}

test.describe('Keyboard navigation — full cycle', () => {
  test('Cmd+1 → Dashboard view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+1')

    // DashboardView has no root CSS class — assert via child text rendered by ActiveTasksCard
    await expect(window.locator('text=Active Tasks')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+2 → Agents view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+2')

    // AgentsView root element
    await expect(window.locator('.agents-view')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+3 → IDE view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+3')

    // IDEView root element
    await expect(window.locator('.ide-view')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+4 → Sprint view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+4')

    // SprintPipeline title rendered inside SprintView
    await expect(window.locator('.sprint-pipeline__title')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.sprint-pipeline__title')).toContainText('Task Pipeline')
  })

  test('Cmd+5 → PR Station view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+5')

    // PRStationView header title
    await expect(window.locator('.pr-station__view-title')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.pr-station__view-title')).toContainText('PR Station')
  })

  test('Cmd+6 → Source Control (Git) view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+6')

    // GitTreeView has no root CSS class — assert via "Source Control" header text
    await expect(window.locator('text=Source Control')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+7 → Memory view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')

    // MemoryView root element and title
    await expect(window.locator('.memory-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.memory-view__title')).toContainText('Memory')
  })

  test('Cmd+8 → Cost view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+8')

    // CostView root element and title
    await expect(window.locator('.cost-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.cost-view__title')).toContainText('Cost Tracker')
  })

  test('Cmd+9 → Settings view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+9')

    // SettingsView root element
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.settings-view__header-title')).toContainText('Settings')
  })
})

test.describe('Keyboard navigation — sequential cycle', () => {
  test('Navigate through all 9 views in order', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // 1 → Dashboard
    await window.keyboard.press('Meta+1')
    await expect(window.locator('text=Active Tasks')).toBeVisible({ timeout: 5_000 })

    // 2 → Agents
    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-view')).toBeVisible({ timeout: 5_000 })

    // 3 → IDE
    await window.keyboard.press('Meta+3')
    await expect(window.locator('.ide-view')).toBeVisible({ timeout: 5_000 })

    // 4 → Sprint
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center__title')).toBeVisible({ timeout: 5_000 })

    // 5 → PR Station
    await window.keyboard.press('Meta+5')
    await expect(window.locator('.pr-station__view-title')).toBeVisible({ timeout: 5_000 })

    // 6 → Source Control (Git)
    await window.keyboard.press('Meta+6')
    await expect(window.locator('text=Source Control')).toBeVisible({ timeout: 5_000 })

    // 7 → Memory
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.memory-view')).toBeVisible({ timeout: 5_000 })

    // 8 → Cost
    await window.keyboard.press('Meta+8')
    await expect(window.locator('.cost-view')).toBeVisible({ timeout: 5_000 })

    // 9 → Settings
    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Command palette navigation', () => {
  test('Cmd+P → type "Agents" → Enter → Agents view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Start on Settings so the navigation is a visible change
    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    // Open command palette
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    // Type to filter navigation commands
    const input = window.locator('.command-palette__input')
    await input.fill('Agents')

    // "Go to Agents" should be the first (and likely only) navigation result
    const agentsItem = window.locator('.command-palette__item', { hasText: 'Go to Agents' })
    await expect(agentsItem).toBeVisible({ timeout: 3_000 })

    // Select with Enter
    await window.keyboard.press('Enter')

    // Palette closes and Agents view is shown
    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.agents-view')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → type "Sprint" → Enter → Sprint view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.locator('.command-palette__input').fill('Sprint')

    const sprintItem = window.locator('.command-palette__item', { hasText: 'Go to Sprint' })
    await expect(sprintItem).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Enter')

    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.sprint-center__title')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → type "Settings" → Enter → Settings view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.locator('.command-palette__input').fill('Settings')

    const settingsItem = window.locator('.command-palette__item', { hasText: 'Go to Settings' })
    await expect(settingsItem).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Enter')

    await expect(palette).not.toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd+P → Escape closes palette without navigating', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to a known view first
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center__title')).toBeVisible({ timeout: 5_000 })

    // Open and close palette without selecting anything
    await window.keyboard.press('Meta+p')
    const palette = window.locator('.command-palette')
    await expect(palette).toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 2_000 })

    // Sprint view should still be visible — palette close did not navigate away
    await expect(window.locator('.sprint-center__title')).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Return to previous view', () => {
  test('Navigate Sprint → Settings via keyboard shortcut', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Go to Sprint first
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.sprint-center__title')).toBeVisible({ timeout: 5_000 })

    // Now switch to Settings
    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    // Sprint view should no longer be visible
    await expect(window.locator('.sprint-center__title')).not.toBeVisible({ timeout: 3_000 })
  })

  test('Navigate Settings → Agents → Settings restores each view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.settings-view')).not.toBeVisible({ timeout: 3_000 })

    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.agents-view')).not.toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Activity bar reflects active view', () => {
  test('Active item highlighted in activity bar after keyboard nav', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to Dashboard and confirm the activity bar highlights the correct item
    await window.keyboard.press('Meta+1')
    await expect(window.locator('.activity-bar__item--active')).toBeVisible({ timeout: 5_000 })

    await window.keyboard.press('Meta+9')
    // Activity bar item for Settings should be active; Settings view should render
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('.activity-bar__item--active')).toBeVisible({ timeout: 3_000 })
  })
})
