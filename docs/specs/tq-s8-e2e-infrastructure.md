# TQ-S8: E2E Infrastructure + 5 Critical Flows

**Epic:** Testing & QA
**Priority:** P2
**Estimate:** XL
**Type:** E2E Test

---

## Problem

BDE has zero end-to-end tests. Unit and component tests verify individual modules in isolation, but no test exercises the full Electron stack: renderer → preload → main → OS → response → UI update. This means:

- IPC channel mismatches between preload and handlers go undetected
- Visual regressions (layouts breaking, modals not opening) are invisible
- Multi-step user flows (spawn agent → see output → send message) are untested
- Electron-specific behavior (window lifecycle, native menus, PTY) is unverifiable

### Critical User Flows (unranked)

1. **Session list load** — app opens → gateway connects → sessions populate → count shows in title bar
2. **Agent spawn** — click "New Agent" → fill modal → spawn → agent appears in list → output streams
3. **Terminal I/O** — switch to Terminal view → PTY spawns → type command → see output
4. **Command palette** — Cmd+K → type filter → select action → view switches
5. **Agent log viewer** — select agent from history → log content loads → auto-scrolls

---

## Solution

### Framework Choice: Playwright + Electron

Playwright has first-class Electron support via `electron.launch()`. This gives us:
- Full Chromium DevTools protocol access
- Real IPC (no mocking needed)
- Screenshot comparison
- Network interception for gateway mock
- CI-compatible headless mode

### Alternative Considered: Spectron

Spectron is deprecated (last release 2021) and doesn't support modern Electron. Rejected.

---

## Infrastructure Setup

### Dependencies

```bash
npm install -D @playwright/test
```

### Directory Structure

```
e2e/
├── fixtures/
│   ├── mock-gateway.ts        # Lightweight HTTP server that mimics gateway responses
│   └── test-config.json       # Mock openclaw.json for test environment
├── helpers/
│   ├── electron-app.ts        # Launch/teardown helpers
│   └── selectors.ts           # Shared CSS/data-testid selectors
├── flows/
│   ├── session-list.spec.ts   # E2E-1
│   ├── agent-spawn.spec.ts    # E2E-2
│   ├── terminal-io.spec.ts    # E2E-3
│   ├── command-palette.spec.ts # E2E-4
│   └── agent-log.spec.ts      # E2E-5
└── playwright.config.ts
```

### Playwright Config

```ts
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './flows',
  timeout: 30_000,
  retries: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],
})
```

### Package.json Script

```json
"test:e2e": "npx playwright test --config e2e/playwright.config.ts"
```

### Mock Gateway

A minimal HTTP/WebSocket server that returns canned responses:

```ts
// e2e/fixtures/mock-gateway.ts
import { createServer } from 'http'

export function startMockGateway(port = 18789) {
  const server = createServer((req, res) => {
    if (req.url === '/tools/invoke') {
      // Return mock session list, agent data, etc.
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions: [...mockSessions] }))
    }
  })
  server.listen(port)
  return { server, port, stop: () => server.close() }
}
```

### Electron Launch Helper

```ts
// e2e/helpers/electron-app.ts
import { _electron as electron } from '@playwright/test'

export async function launchApp() {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      BDE_TEST_MODE: '1',
      HOME: '/tmp/bde-e2e-test', // Isolated home for test config
    },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}
```

---

## Test Specifications

### E2E-1: Session List Loads

**File:** `e2e/flows/session-list.spec.ts`

```
Precondition: Mock gateway running with 3 test sessions
Steps:
  1. Launch BDE
  2. Wait for sessions view to load
  3. Assert session list contains 3 items
  4. Assert title bar shows session count
  5. Assert each session shows model badge and timestamp
  6. Assert running sessions show green status indicator
Teardown: Close app, stop mock gateway
```

### E2E-2: Agent Spawn Flow

**File:** `e2e/flows/agent-spawn.spec.ts`

```
Precondition: Mock gateway running, claude CLI available in PATH
Steps:
  1. Launch BDE
  2. Click "New Agent" button (or Shift+Cmd+N shortcut)
  3. Assert SpawnModal opens
  4. Type "Write hello world" in task field
  5. Select repo from dropdown
  6. Click "Spawn" button
  7. Assert modal closes
  8. Assert new agent appears in session list
  9. Assert chat pane shows agent output (within 10s timeout)
Teardown: Kill spawned agent process, close app
```

**Note:** This test spawns a REAL claude process. For CI, mock the spawn or skip this test. For local dev, use a short task that completes quickly.

### E2E-3: Terminal I/O

**File:** `e2e/flows/terminal-io.spec.ts`

```
Precondition: App launched, Terminal view available
Steps:
  1. Switch to Terminal view (click sidebar or press Cmd+4)
  2. Wait for PTY to initialize (terminal canvas rendered)
  3. Type "echo BDE_E2E_TEST"
  4. Press Enter
  5. Assert terminal output contains "BDE_E2E_TEST"
  6. Type "exit"
  7. Press Enter
  8. Assert terminal tab shows exit indicator
Teardown: Close app
```

**Note:** Terminal testing with xterm.js requires interacting with the canvas element. Use Playwright's `keyboard.type()` and wait for the `terminal:data` IPC event.

### E2E-4: Command Palette Navigation

**File:** `e2e/flows/command-palette.spec.ts`

```
Precondition: App launched on Sessions view
Steps:
  1. Press Cmd+K
  2. Assert command palette modal is visible
  3. Type "terminal" in search field
  4. Assert filtered results contain "Terminal" option
  5. Press Enter (or click "Terminal")
  6. Assert command palette closes
  7. Assert Terminal view is now active
  8. Press Cmd+K again
  9. Type "sessions"
  10. Press Enter
  11. Assert Sessions view is now active
Teardown: Close app
```

### E2E-5: Agent Log Viewer

**File:** `e2e/flows/agent-log.spec.ts`

```
Precondition: Mock gateway with completed agent in history, log file on disk
Steps:
  1. Launch BDE
  2. Navigate to agent history panel
  3. Click on completed agent row
  4. Assert log viewer panel opens
  5. Assert log content is displayed
  6. Assert log content matches expected output
  7. Click different agent
  8. Assert log content updates
Teardown: Close app, clean up test log files
```

---

## Files to Create

| File | Purpose | Estimated LOC |
|------|---------|---------------|
| `e2e/playwright.config.ts` | Playwright configuration | ~25 |
| `e2e/fixtures/mock-gateway.ts` | Mock gateway HTTP server | ~80 |
| `e2e/fixtures/test-config.json` | Mock openclaw.json | ~15 |
| `e2e/helpers/electron-app.ts` | App launch/teardown helper | ~30 |
| `e2e/helpers/selectors.ts` | Shared CSS selectors | ~30 |
| `e2e/flows/session-list.spec.ts` | E2E-1: Session list | ~40 |
| `e2e/flows/agent-spawn.spec.ts` | E2E-2: Agent spawn | ~50 |
| `e2e/flows/terminal-io.spec.ts` | E2E-3: Terminal I/O | ~40 |
| `e2e/flows/command-palette.spec.ts` | E2E-4: Command palette | ~35 |
| `e2e/flows/agent-log.spec.ts` | E2E-5: Log viewer | ~40 |

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `test:e2e` script, add `@playwright/test` to devDependencies |
| `vitest.config.ts` | Add `e2e/**` to exclude (prevent vitest from picking up Playwright tests) |

---

## Implementation Notes

### Data-Testid Convention

Add `data-testid` attributes to key UI elements for stable selectors:

```tsx
// Example — not required for this story, but recommended for future stability
<button data-testid="spawn-agent-button">New Agent</button>
<div data-testid="session-list">...</div>
<div data-testid="terminal-view">...</div>
```

For this story, use CSS selectors and text content matching. Add `data-testid` incrementally as tests demand stable selectors.

### CI Considerations

- **E2E-2 (agent spawn)** requires the `claude` CLI to be installed. In CI, either:
  - Skip this test (`test.skip` with env check)
  - Mock the spawn at the OS level (not practical)
  - Use a stub binary that echoes canned output
- **E2E-3 (terminal)** requires a PTY (node-pty). This works on macOS and Linux CI runners but not in containers without `/dev/pts`.
- **Headless mode** — Electron runs headless by default in Playwright. xterm.js canvas rendering still works.
- **Timeout** — set 30s per test. Agent spawn and terminal tests may need longer initial waits.

### Environment Isolation

E2E tests should NOT touch the user's real `~/.openclaw/` directory. Use:
- `HOME=/tmp/bde-e2e-test` to isolate config
- Mock gateway on a random port to avoid conflicts
- Clean up `/tmp/bde-e2e-test` in `afterAll`

## Acceptance Criteria

- [ ] Playwright installed and configured for Electron
- [ ] Mock gateway server starts/stops reliably in test lifecycle
- [ ] E2E-1 (session list) passes with mock data
- [ ] E2E-2 (agent spawn) passes locally (may be skipped in CI)
- [ ] E2E-3 (terminal I/O) passes with real PTY
- [ ] E2E-4 (command palette) passes with keyboard navigation
- [ ] E2E-5 (agent log) passes with mock log data
- [ ] `npm run test:e2e` runs all flows
- [ ] Tests clean up after themselves (no leaked processes, temp files, ports)
- [ ] `e2e/**` excluded from vitest discovery
