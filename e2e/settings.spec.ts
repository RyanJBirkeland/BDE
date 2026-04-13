/**
 * Settings view (Cmd+7) E2E tests.
 * SettingsView uses a sidebar layout (.stg-layout) with .stg-sidebar and .stg-content.
 * Sections are selected via sidebar items, not tab buttons.
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Settings view', () => {
  test('Navigate to Settings', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')

    const settingsLayout = window.locator('.stg-layout')
    await expect(settingsLayout).toBeVisible({ timeout: 5_000 })

    // Page header should show the active section title
    const title = window.locator('.stg-page-header__title')
    await expect(title).toBeVisible({ timeout: 3_000 })
  })

  test('Sidebar section switching — Appearance', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Click the Appearance item in the sidebar
    const appearanceItem = window.locator('.stg-sidebar__item', { hasText: 'Appearance' })
    await expect(appearanceItem).toBeVisible({ timeout: 3_000 })
    await appearanceItem.click()

    // Page header should update to "Appearance"
    await expect(window.locator('.stg-page-header__title')).toContainText('Appearance', {
      timeout: 3_000
    })

    // Theme toggle buttons should be visible in AppearanceSection
    const themeButtons = window.locator('.settings-theme-buttons')
    await expect(themeButtons).toBeVisible({ timeout: 3_000 })

    await expect(themeButtons.locator('button', { hasText: 'Dark' })).toBeVisible({
      timeout: 3_000
    })
    await expect(themeButtons.locator('button', { hasText: 'Light' })).toBeVisible({
      timeout: 3_000
    })
  })

  test('Sidebar section switching — Repositories', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Click the Repositories item in the sidebar
    const reposItem = window.locator('.stg-sidebar__item', { hasText: 'Repositories' })
    await expect(reposItem).toBeVisible({ timeout: 3_000 })
    await reposItem.click()

    // Page header should update
    await expect(window.locator('.stg-page-header__title')).toContainText('Repositories', {
      timeout: 3_000
    })

    // "Add Repository" button should be visible in RepositoriesSection
    const addRepoBtn = window.locator('button.settings-repos__add-btn', {
      hasText: 'Add Repository'
    })
    await expect(addRepoBtn).toBeVisible({ timeout: 3_000 })
  })

  test('Settings sidebar shows search input', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Sidebar search input should be visible
    const searchInput = window.locator('.stg-sidebar__search-input')
    await expect(searchInput).toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Settings — Connections section', () => {
  test('Connections section shows fields and accepts input', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to Settings via Cmd+7
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

    // Click the Connections sidebar item (it is the default, but click explicitly to be sure)
    const connectionsItem = window.locator('.stg-sidebar__item', { hasText: 'Connections' })
    await expect(connectionsItem).toBeVisible({ timeout: 3_000 })
    await connectionsItem.click()

    // Verify page header is "Connections"
    await expect(window.locator('.stg-page-header__title')).toContainText('Connections', {
      timeout: 3_000
    })
  })
})
