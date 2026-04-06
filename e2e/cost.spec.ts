/**
 * Cost & Usage section E2E tests.
 * Cost is a section within Settings (Cmd+7), not a standalone view.
 * Navigate to Settings then select the "Cost & Usage" sidebar item.
 */
import { test, expect, waitForAppShell } from './fixtures'

/** Navigate to the Cost & Usage settings section. */
async function navigateToCostSection(window: import('@playwright/test').Page): Promise<void> {
  // Navigate to Settings via Cmd+7
  await window.keyboard.press('Meta+7')
  await expect(window.locator('.stg-layout')).toBeVisible({ timeout: 5_000 })

  // Click the "Cost & Usage" item in the settings sidebar
  const costItem = window.locator('.stg-sidebar__item', { hasText: 'Cost & Usage' })
  await expect(costItem).toBeVisible({ timeout: 3_000 })
  await costItem.click()

  // Wait for the Cost section content to render
  await expect(window.locator('.cost-view')).toBeVisible({ timeout: 5_000 })
}

test.describe('Cost & Usage Section', () => {
  test('navigates to Cost section and shows page header', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToCostSection(window)

    // Assert page header title
    const title = window.locator('.stg-page-header__title')
    await expect(title).toBeVisible({ timeout: 3_000 })
    await expect(title).toContainText('Cost & Usage')
  })

  test('cost panels container is visible', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToCostSection(window)

    // Assert scroll container and panels container are visible
    const scroll = window.locator('.cost-view__scroll')
    await expect(scroll).toBeVisible({ timeout: 5_000 })

    const panels = window.locator('.cost-view__panels')
    await expect(panels).toBeVisible({ timeout: 5_000 })

    // Panels container should have at least one child element
    await expect(panels.locator('> *').first()).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Cost & Usage — export', () => {
  test('Export CSV button exists and shows "Copied!" feedback on click', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await navigateToCostSection(window)

    // Verify the Export CSV button exists
    const exportBtn = window.locator('button', { hasText: 'Export CSV' })
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })

    // Click the Export CSV button
    await exportBtn.click()

    // Verify the "Copied!" feedback text appears
    const copiedBtn = window.locator('button', { hasText: 'Copied!' })
    await expect(copiedBtn).toBeVisible({ timeout: 3_000 })

    // After the flash duration, it should revert back to "Export CSV"
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })
  })
})
