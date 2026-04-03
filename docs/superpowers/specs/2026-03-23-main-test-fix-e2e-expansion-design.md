# Main Test Fix + E2E Expansion — Design Spec

## Goal

Two independent improvements: (A) make main process tests self-healing so they pass regardless of invocation method, and (B) add E2E Playwright tests for PR Station, Settings, and Cost View.

## Part A: Fix Main Tests for Direct Vitest Invocation

### Problem

`npx vitest run --config src/main/vitest.main.config.ts` fails with `NODE_MODULE_VERSION` mismatch because it skips the `pretest:main` npm hook that rebuilds `better-sqlite3` for Node.js. Running `npm run test:main` works correctly (458/458 pass) because the pre/post lifecycle hooks handle the native module swap.

### Solution

Add a vitest `globalSetup` file that checks the native module at startup and runs the rebuild if needed.

**File:** `src/main/vitest-global-setup.ts`

Logic:

1. Try to `require('better-sqlite3')`
2. If it throws a `NODE_MODULE_VERSION` mismatch error, run `npm rebuild better-sqlite3 --build-from-source` synchronously via `execSync`
3. If rebuild succeeds, tests proceed normally
4. If rebuild fails, throw with a clear error message

**Config change:** Add `globalSetup: ['./src/main/vitest-global-setup.ts']` to `src/main/vitest.main.config.ts`.

The existing `pretest:main` / `posttest:main` hooks in package.json remain unchanged — they still work for `npm run test:main`. The globalSetup is a safety net for direct invocation.

### Teardown

No teardown needed — the `posttest:main` hook already rebuilds for Electron after `npm run test:main`. For direct vitest invocation, the user should run `npm run postinstall` or `npm run posttest:main` manually if they need the Electron build restored. Document this in a comment in the globalSetup file.

## Part B: E2E Tests

### Existing Infrastructure

- Playwright config at `playwright.config.ts` (30s timeout, 1 worker, serial execution)
- Custom `bde` fixture in `e2e/fixtures.ts` launches Electron app with `BDE_TEST_MODE=1`
- 5 existing spec files, 8 tests total
- Pattern: navigate via keyboard shortcuts, assert CSS selectors, interact with elements

### New Spec Files

#### `e2e/pr-station.spec.ts` (~3 tests)

- **Navigate to PR Station:** Cmd+4, verify `.pr-station` visible with list panel
- **PR list renders:** Verify "Open PRs" heading, refresh button visible
- **Empty detail state:** When no PR selected, verify empty detail placeholder

Selectors: `.pr-station`, `.pr-station__list-panel`, `.pr-station__detail-panel`, `.pr-station__empty-detail`, `.pr-station__view-title`

#### `e2e/settings.spec.ts` (~3 tests)

- **Navigate to Settings:** Cmd+7, verify `.settings-view` with "Settings" title
- **Tab switching — Appearance:** Click Appearance tab, verify theme controls
- **Tab switching — Repositories:** Click Repositories tab, verify "Add Repository" button

Selectors: `.settings-view`, `.settings-view__header-title`, `.settings-view__tabs`

#### `e2e/cost.spec.ts` (~2 tests)

- **Navigate to Cost View:** Cmd+6, verify `.cost-view` with "Cost Tracker" title
- **Summary panels render:** Verify cost panels are present (even with zero/empty data)

Selectors: `.cost-view`, `.cost-view__title`, `.cost-view__panels`

### Test Pattern

All tests follow the established pattern:

```typescript
import { test, expect } from './fixtures'

test.describe('View Name', () => {
  test('specific behavior', async ({ bde }) => {
    const { window } = bde
    await expect(window.locator('.app-shell')).toBeVisible({ timeout: 15_000 })
    // Navigate, interact, assert
  })
})
```

### Keyboard Shortcuts for Navigation

- Cmd+4 → PR Station
- Cmd+6 → Cost View
- Cmd+7 → Settings

These are defined in the app shell keyboard handler.
