import { test as base, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'

export type TestFixtures = {
  fleet: { app: ElectronApplication; window: Page }
}

/**
 * Launch FLEET Electron app in test mode.
 * Reused across all E2E specs via `test.use()`.
 */
async function launchFLEET(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      FLEET_TEST_MODE: '1'
    }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return { app, window }
}

/**
 * Extended test fixture that provides a launched FLEET instance.
 * Each test gets a fresh app that is closed after the test completes.
 */
export const test = base.extend<TestFixtures>({
  fleet: async ({}, use) => {
    const fleet = await launchFLEET()
    await use(fleet)
    await fleet.app.close()
  }
})

export { expect } from '@playwright/test'

/** Wait for the app shell to finish loading before asserting anything. */
export async function waitForAppShell(window: Page): Promise<void> {
  await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
}
