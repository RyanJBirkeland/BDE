import { test, expect } from './fixtures'

test.describe('Memory View', () => {
  test('Navigate to Memory View', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Memory View via Cmd+5
    await window.keyboard.press('Meta+5')

    // Assert Memory View root renders
    const view = window.locator('.memory-view')
    await expect(view).toBeVisible({ timeout: 5_000 })

    // Assert "Memory" header title is visible
    const title = window.locator('.memory-view__title')
    await expect(title).toBeVisible()
    await expect(title).toContainText('Memory')
  })

  test('File list sidebar renders', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load and navigate to Memory View
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+5')
    await expect(window.locator('.memory-view')).toBeVisible({ timeout: 5_000 })

    // Assert sidebar is visible
    const sidebar = window.locator('.memory-sidebar')
    await expect(sidebar).toBeVisible()

    // Assert sidebar header shows "Files" label
    const sidebarTitle = sidebar.locator('.memory-sidebar__title')
    await expect(sidebarTitle).toBeVisible()
    await expect(sidebarTitle).toContainText('Files')

    // Assert the file list container is present (may be empty or populated)
    const fileList = sidebar.locator('.memory-sidebar__list')
    await expect(fileList).toBeVisible()
  })

  test('New file button exists in sidebar', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load and navigate to Memory View
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+5')
    await expect(window.locator('.memory-view')).toBeVisible({ timeout: 5_000 })

    // Assert the "+" new file button is visible in the sidebar actions
    const newFileButton = window.locator('.memory-sidebar__actions button[title="New file"]')
    await expect(newFileButton).toBeVisible()
    await expect(newFileButton).toContainText('+')
  })
})
