import { test, expect } from './fixtures'

test.describe('Agents view loads', () => {
  test('Agents view renders with agent list and sidebar', async ({ bde }) => {
    const { window } = bde

    // Default view is Dashboard — navigate to Agents via Cmd+2
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+2')

    // Wait for the agents view to be visible
    const agentsView = window.locator('.agents-view')
    await expect(agentsView).toBeVisible({ timeout: 5_000 })

    // Assert the sidebar header is visible
    const sidebarHeader = window.locator('.agents-view__sidebar-header')
    await expect(sidebarHeader).toBeVisible()

    // Assert the sidebar has the "Agents" title
    const agentsTitle = window.locator('.agents-view__title')
    await expect(agentsTitle).toHaveText('Agents')

    // Assert AgentList renders — even if empty, the component mounts
    // The search input inside the sidebar is always present
    const filterInput = agentsView.locator('input[placeholder="Filter agents..."]')
    await expect(filterInput).toBeVisible()

    // Assert the spawn button (plus icon) is visible in the sidebar header
    const spawnButton = window.locator('.agents-view__spawn-btn')
    await expect(spawnButton).toBeVisible()
  })
})

test.describe('Spawn agent modal', () => {
  test('opens SpawnModal via command palette and fills form', async ({ bde }) => {
    const { window } = bde

    // Wait for app to fully load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

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
    await expect(spawnItem).toBeVisible()

    // Press Enter to select
    await window.keyboard.press('Enter')

    // Assert SpawnModal opens (class is "spawn-modal glass-modal" on the motion.div)
    const spawnModal = window.locator('.spawn-modal.glass-modal')
    await expect(spawnModal).toBeVisible({ timeout: 5_000 })

    // Fill in the task field
    const taskField = window.locator('textarea[placeholder="Describe the task for the agent..."]')
    await taskField.fill('Write a hello world script')

    // Assert the task textarea has the value
    await expect(taskField).toHaveValue('Write a hello world script')

    // The Spawn button should be visible (may be disabled until repos load, but it's rendered)
    const spawnButton = spawnModal.locator('button', { hasText: 'Spawn' })
    await expect(spawnButton).toBeVisible()
  })
})
