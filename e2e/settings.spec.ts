import { test, expect } from './fixtures'

test.describe('Settings view', () => {
  test('Navigate to Settings', async ({ bde }) => {
    const { window } = bde

    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+7')

    const settingsView = window.locator('.settings-view')
    await expect(settingsView).toBeVisible({ timeout: 5_000 })

    const title = window.locator('.settings-view__header-title')
    await expect(title).toContainText('Settings')
  })

  test('Tab switching — Appearance', async ({ bde }) => {
    const { window } = bde

    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    const appearanceTab = window.locator('.settings-view__tabs button', { hasText: 'Appearance' })
    await expect(appearanceTab).toBeVisible()
    await appearanceTab.click()

    // Theme toggle buttons should be visible in AppearanceSection
    const themeButtons = window.locator('.settings-theme-buttons')
    await expect(themeButtons).toBeVisible({ timeout: 3_000 })

    await expect(themeButtons.locator('button', { hasText: 'Dark' })).toBeVisible()
    await expect(themeButtons.locator('button', { hasText: 'Light' })).toBeVisible()

    // Accent color swatches should be visible
    await expect(window.locator('.settings-colors')).toBeVisible()
  })

  test('Tab switching — Repositories', async ({ bde }) => {
    const { window } = bde

    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+7')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    const reposTab = window.locator('.settings-view__tabs button', { hasText: 'Repositories' })
    await expect(reposTab).toBeVisible()
    await reposTab.click()

    // "Add Repository" button should be visible in RepositoriesSection
    const addRepoBtn = window.locator('button.settings-repos__add-btn', { hasText: 'Add Repository' })
    await expect(addRepoBtn).toBeVisible({ timeout: 3_000 })
  })
})
