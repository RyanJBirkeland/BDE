import { test, expect } from './fixtures'

test.describe('PR Station', () => {
  test('Navigate to PR Station', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to PR Station via Cmd+4
    await window.keyboard.press('Meta+4')

    // Assert PR Station wrapper renders
    const wrapper = window.locator('.pr-station-wrapper')
    await expect(wrapper).toBeVisible({ timeout: 5_000 })

    // Assert "PR Station" title is visible
    const title = window.locator('.pr-station__view-title')
    await expect(title).toBeVisible()
    await expect(title).toContainText('PR Station')
  })

  test('PR list panel renders', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load and navigate to PR Station
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.pr-station-wrapper')).toBeVisible({ timeout: 5_000 })

    // Assert list panel is visible
    const listPanel = window.locator('.pr-station__list-panel')
    await expect(listPanel).toBeVisible()

    // Assert "Open PRs" label is present in the list header
    const listTitle = listPanel.locator('.pr-station-list__title')
    await expect(listTitle).toBeVisible()
    await expect(listTitle).toContainText('Open PRs')

    // Assert refresh button is present
    const refreshButton = listPanel.locator('button[title="Refresh"]')
    await expect(refreshButton).toBeVisible()
  })

  test('Empty detail state shown when no PR selected', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load and navigate to PR Station
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+4')
    await expect(window.locator('.pr-station-wrapper')).toBeVisible({ timeout: 5_000 })

    // With no PR selected, the empty detail placeholder should be visible
    const emptyDetail = window.locator('.pr-station__empty-detail')
    await expect(emptyDetail).toBeVisible()
    await expect(emptyDetail).toContainText('Select a PR to view details')

    // Tabs should not be visible when no PR is selected
    const tabs = window.locator('.pr-station__tab')
    await expect(tabs).toHaveCount(0)
  })
})

test.describe('PR Station — filter bar', () => {
  test('filter bar renders with repo chips and sort selector', async ({ bde }) => {
    const { window } = bde

    // Navigate to PR Station via Cmd+5
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+5')
    await expect(window.locator('.pr-station-wrapper')).toBeVisible({ timeout: 5_000 })

    // Verify the filter bar group renders
    const filterBar = window.locator('.pr-station-filters')
    await expect(filterBar).toBeVisible({ timeout: 5_000 })

    // The "All" repo chip should always be present
    const allChip = filterBar.locator('button', { hasText: 'All' })
    await expect(allChip).toBeVisible()

    // "All" should be active (primary variant) by default
    await expect(allChip).toHaveClass(/bde-btn--primary/)

    // Verify the sort selector exists
    const sortSelect = filterBar.locator('#pr-sort-select')
    await expect(sortSelect).toBeVisible()

    // Default sort should be "Last updated"
    await expect(sortSelect).toHaveValue('updated')

    // If there are additional repo chips beyond "All", clicking one should
    // toggle it to active and deactivate "All"
    const repoChips = filterBar.locator('.pr-station-filters__repos button')
    const chipCount = await repoChips.count()
    if (chipCount > 1) {
      // Click the first repo-specific chip (index 1, since 0 is "All")
      const repoChip = repoChips.nth(1)
      await repoChip.click()

      // The clicked chip should now be primary
      await expect(repoChip).toHaveClass(/bde-btn--primary/)

      // "All" should now be ghost (not active)
      await expect(allChip).toHaveClass(/bde-btn--ghost/)
    }
  })
})
