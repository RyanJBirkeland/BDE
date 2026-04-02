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

test.describe('Spawn agent modal — extended', () => {
  test('opens SpawnModal via spawn button, fills task, verifies Spawn button', async ({ bde }) => {
    const { window } = bde

    // Navigate to Agents view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+2')
    await expect(window.locator('.agents-view')).toBeVisible({ timeout: 5_000 })

    // Click the spawn button (plus icon) in the sidebar header
    const spawnBtn = window.locator('.agents-view__spawn-btn')
    await expect(spawnBtn).toBeVisible()
    await spawnBtn.click()

    // Assert SpawnModal opens
    const spawnModal = window.locator('.spawn-modal.glass-modal')
    await expect(spawnModal).toBeVisible({ timeout: 5_000 })

    // Verify modal title
    const modalTitle = spawnModal.locator('#spawn-modal-title')
    await expect(modalTitle).toContainText('Spawn Agent')

    // Fill in the task title field
    const taskField = spawnModal.locator('textarea.spawn-modal__textarea')
    await expect(taskField).toBeVisible()
    await taskField.fill('E2E test: implement feature X')
    await expect(taskField).toHaveValue('E2E test: implement feature X')

    // Verify Repository select is present
    const repoSelect = spawnModal.locator('select.spawn-modal__select')
    await expect(repoSelect).toBeVisible()

    // Verify Model chips section is present
    const modelChips = spawnModal.locator('.spawn-modal__chips')
    await expect(modelChips).toBeVisible()

    // Verify Spawn submit button exists (don't click — needs OAuth token)
    const submitBtn = spawnModal.locator('button[type="submit"]', { hasText: /Spawn|Loading/ })
    await expect(submitBtn).toBeVisible()

    // Verify Cancel button exists
    const cancelBtn = spawnModal.locator('button', { hasText: 'Cancel' })
    await expect(cancelBtn).toBeVisible()
  })
})
