import { test as base, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'path'

export type TestFixtures = {
  bde: { app: ElectronApplication; window: Page }
}

/**
 * Launch BDE Electron app in test mode.
 * Reused across all E2E specs via `test.use()`.
 */
async function launchBDE(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BDE_TEST_MODE: '1'
    }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return { app, window }
}

/**
 * Extended test fixture that provides a launched BDE instance.
 * Each test gets a fresh app that is closed after the test completes.
 */
export const test = base.extend<TestFixtures>({
  bde: async ({}, use) => {
    const bde = await launchBDE()
    await use(bde)
    await bde.app.close()
  }
})

export { expect } from '@playwright/test'
