import { test, expect } from './fixtures'

test.describe('Session list loads', () => {
  test('Sessions view renders with agent list and glass sidebar', async ({ bde }) => {
    const { window } = bde

    // Wait for the sessions view to be visible (it's the default active view)
    const sessionsView = window.locator('.sessions-chat')
    await expect(sessionsView).toBeVisible({ timeout: 15_000 })

    // Assert the glass sidebar panel is visible
    const sidebar = window.locator('.sessions-chat__sidebar')
    await expect(sidebar).toBeVisible()

    // Assert the sidebar has the AGENTS section header
    const agentsTitle = window.locator('.session-list__title')
    await expect(agentsTitle).toHaveText('AGENTS')

    // Assert AgentList renders — even if empty, the component mounts
    // The search input inside the sidebar is always present
    const filterInput = sidebar.locator('input[placeholder="Filter agents…"]')
    await expect(filterInput).toBeVisible()

    // Assert the spawn button (plus icon) is visible in the sidebar header
    const spawnButton = window.locator('.session-list__new-btn')
    await expect(spawnButton).toBeVisible()
  })
})
