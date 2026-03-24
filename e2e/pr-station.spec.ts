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
