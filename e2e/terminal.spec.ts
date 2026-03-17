import { test, expect } from './fixtures'

test.describe('Terminal I/O', () => {
  test('tab bar visible and new tab button creates a tab', async ({ bde }) => {
    const { window } = bde

    // Wait for app to load
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })

    // Navigate to Terminal view via Cmd+2
    await window.keyboard.press('Meta+2')

    // Wait for terminal view to be visible
    const terminalView = window.locator('.terminal-view')
    await expect(terminalView).toBeVisible({ timeout: 5_000 })

    // Assert tab bar is visible (container is .terminal-tab-bar__tabs)
    const tabBar = window.locator('.terminal-tab-bar__tabs')
    await expect(tabBar).toBeVisible()

    // Count initial tabs — at least one default shell tab (each tab is .terminal-tab)
    const initialTabs = tabBar.locator('.terminal-tab')
    await expect(initialTabs.first()).toBeVisible({ timeout: 3_000 })
    const initialCount = await initialTabs.count()
    expect(initialCount).toBeGreaterThanOrEqual(1)

    // Create new tab via Cmd+T
    await window.keyboard.press('Meta+t')

    // Assert tab count increased by 1
    await expect(tabBar.locator('.terminal-tab')).toHaveCount(initialCount + 1, {
      timeout: 3_000,
    })
  })

  test('type echo hello and see output', async ({ bde }) => {
    const { window } = bde

    // Navigate to Terminal view
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Meta+2')
    await expect(window.locator('.terminal-view')).toBeVisible({ timeout: 5_000 })

    // Wait for terminal canvas/content to be ready
    const terminalContent = window.locator('.terminal-content')
    await expect(terminalContent).toBeVisible({ timeout: 5_000 })

    // Give PTY time to initialize
    await window.waitForTimeout(1_000)

    // Type into the terminal — xterm.js captures keyboard input on the focused canvas
    await window.keyboard.type('echo BDE_E2E_HELLO')
    await window.keyboard.press('Enter')

    // Wait for the output to appear in the terminal
    // xterm.js renders to canvas, so we check via the xterm accessibility tree
    // or evaluate inside the renderer process
    const output = await window.waitForFunction(
      () => {
        const rows = document.querySelectorAll('.xterm-rows > div')
        for (const row of rows) {
          if (row.textContent?.includes('BDE_E2E_HELLO')) return true
        }
        return false
      },
      { timeout: 5_000 },
    )
    expect(output).toBeTruthy()
  })
})
