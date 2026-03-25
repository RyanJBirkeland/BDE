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

test.describe('Settings — Connections tab', () => {
  test('Connections tab shows fields and accepts input', async ({ bde }) => {
    const { window } = bde

    // Navigate to Settings via Cmd+9
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+9')
    await expect(window.locator('.settings-view')).toBeVisible({ timeout: 5_000 })

    // Click the Connections tab (it is the default, but click explicitly to be sure)
    const connectionsTab = window.locator('.settings-view__tabs button', { hasText: 'Connections' })
    await expect(connectionsTab).toBeVisible()
    await connectionsTab.click()

    // Verify "Connections" section title is visible
    const sectionTitle = window.locator('.settings-section__title', { hasText: 'Connections' })
    await expect(sectionTitle).toBeVisible({ timeout: 3_000 })

    // Verify the Worktree Base Path input field exists (part of Agent Manager settings in Connections)
    const worktreeInput = window.locator('.settings-field__input[placeholder="/tmp/worktrees/bde"]')
    await expect(worktreeInput).toBeVisible()

    // Fill a test value into the Worktree Base Path field
    await worktreeInput.fill('/tmp/test-worktree-base')
    await expect(worktreeInput).toHaveValue('/tmp/test-worktree-base')

    // Verify the Save button becomes enabled after editing
    const saveBtn = window.locator('.settings-connection button', { hasText: 'Save' })
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).toBeEnabled()
  })
})
