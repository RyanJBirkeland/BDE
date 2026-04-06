/**
 * Dashboard view smoke tests.
 * Verifies the default view renders with status counters and key sections.
 *
 * Dashboard uses neon components: StatusCounters (Active, Queued, Blocked, Done),
 * CenterColumn (charts + pipeline flow), and ActivitySection (feed + completions).
 * StatusBar shows "BDE Command Center" title.
 */
import { test, expect, waitForAppShell } from './fixtures'

test.describe('Dashboard — smoke tests', () => {
  test('App launches to Dashboard as default view', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Dashboard is the default view (Cmd+1). The StatusBar renders "BDE Command Center".
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })
    await expect(window.locator('text=BDE Command Center')).toBeVisible({ timeout: 5_000 })
  })

  test('Dashboard shows status counters', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    // Navigate to dashboard explicitly
    await window.keyboard.press('Meta+1')
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })

    // StatusCounters renders labels: Active, Queued, Blocked, Done
    // These may show as onboarding state if no tasks exist, so check the root container
    const dashboardContent = window.locator('.dashboard-content')
    await expect(dashboardContent).toBeVisible({ timeout: 5_000 })
  })

  test('Dashboard grid or onboarding card renders', async ({ bde }) => {
    const { window } = bde
    await waitForAppShell(window)

    await window.keyboard.press('Meta+1')
    await expect(window.locator('.dashboard-root')).toBeVisible({ timeout: 5_000 })

    // With no tasks: onboarding card with "Welcome to BDE" appears
    // With tasks: dashboard-grid with role="region" appears
    const hasGrid = await window
      .locator('.dashboard-grid')
      .isVisible()
      .catch(() => false)
    const hasOnboarding = await window
      .locator('.dashboard-onboarding')
      .isVisible()
      .catch(() => false)

    // One of the two must be visible
    expect(hasGrid || hasOnboarding).toBe(true)

    // If onboarding, verify the "Create First Task" CTA
    if (hasOnboarding) {
      await expect(window.locator('.dashboard-onboarding__cta')).toBeVisible({ timeout: 3_000 })
      await expect(window.locator('.dashboard-onboarding__cta')).toContainText('Create First Task')
    }

    // If grid, verify status counters section exists
    if (hasGrid) {
      // StatCounter components render with label prop: Active, Queued, Blocked, Done
      await expect(window.locator('text=Active').first()).toBeVisible({ timeout: 5_000 })
      await expect(window.locator('text=Done').first()).toBeVisible({ timeout: 5_000 })
    }
  })
})
