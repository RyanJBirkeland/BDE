/**
 * Vitest global setup for main process tests.
 *
 * Ensures better-sqlite3 is compiled for Node.js (not Electron) before tests run.
 * This handles the case where tests are invoked directly via `npx vitest` instead
 * of `npm run test:main` (which has pre/post hooks for the native module swap).
 *
 * After running tests directly, restore the Electron build with:
 *   npm run posttest:main
 */
import { execFileSync } from 'node:child_process'

/**
 * Test the native binary by instantiating a Database in a child process.
 * A simple `require('better-sqlite3')` is not enough — the native .node binary
 * is lazy-loaded only when a Database is actually constructed.
 */
function isNativeModuleCompatible(): boolean {
  try {
    execFileSync(
      process.execPath,
      ['-e', "const db = require('better-sqlite3')(':memory:'); db.close();"],
      { stdio: 'pipe', cwd: process.cwd(), timeout: 10_000 }
    )
    return true
  } catch {
    return false
  }
}

export function setup(): void {
  if (isNativeModuleCompatible()) return

  console.log(
    '[vitest-global-setup] better-sqlite3 native binary is incompatible with current Node.js. Rebuilding...'
  )

  try {
    execFileSync('node-gyp', ['rebuild', '--directory=node_modules/better-sqlite3'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      timeout: 120_000,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `[vitest-global-setup] Failed to rebuild better-sqlite3 for Node.js:\n${msg}\n\nTry: node-gyp rebuild --directory=node_modules/better-sqlite3`
    )
  }

  if (!isNativeModuleCompatible()) {
    throw new Error(
      '[vitest-global-setup] Rebuilt better-sqlite3 but it still fails to load. Check your Node.js version and build tools.'
    )
  }

  console.log('[vitest-global-setup] Rebuild successful.')
}
