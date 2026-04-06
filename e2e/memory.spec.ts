/**
 * Memory section E2E tests.
 * Memory is a section within Settings (Cmd+7), not a standalone view.
 * Navigate to Settings then select the "Memory" sidebar item.
 */
import { test, expect, waitForAppShell } from './fixtures'

/** Navigate to the Memory settings section. */
async function navigateToMemorySection(window: import('@playwright/test').Page): Promise<void> {
  // Navigate to Settings via Cmd+7
  await window.keyboard.press('Meta+7')
  await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

  // Click the "Memory" item in the settings sidebar
  const memoryItem = window.locator('.stg-sidebar__item', { hasText: 'Memory' })
  await expect(memoryItem).toBeVisible({ timeout: 3_000 })
  await memoryItem.click()

  // Wait for the Memory section page header
  await expect(window.locator('.stg-page-header__title')).toContainText('Memory', { timeout: 5_000 })
}

test.describe('Memory Section', () => {
  test('Navigate to Memory section and shows page header', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToMemorySection(window)

    // Assert page header
    const title = window.locator('.stg-page-header__title')
    await expect(title).toBeVisible({ timeout: 3_000 })
    await expect(title).toContainText('Memory')

    // Assert subtitle
    const subtitle = window.locator('.stg-page-header__subtitle')
    await expect(subtitle).toBeVisible({ timeout: 3_000 })
    await expect(subtitle).toContainText('Agent memory files')
  })

  test('File list sidebar renders', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToMemorySection(window)

    // Assert sidebar is visible
    const sidebar = window.locator('.memory-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 5_000 })

    // Assert sidebar header shows "Files" label
    const sidebarTitle = sidebar.locator('.memory-sidebar__title')
    await expect(sidebarTitle).toBeVisible({ timeout: 3_000 })
    await expect(sidebarTitle).toContainText('Files')

    // Assert the file list container is present (may be loading or populated)
    const fileList = sidebar.locator('.memory-sidebar__list')
    await expect(fileList).toBeVisible({ timeout: 5_000 })
  })

  test('Search input exists in sidebar', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToMemorySection(window)

    // Assert the search input is visible in the sidebar
    const searchInput = window.locator('.memory-sidebar__search-input')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
  })
})
