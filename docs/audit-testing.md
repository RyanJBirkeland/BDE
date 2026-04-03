# Testing Audit

**Date:** 2026-03-16
**Auditor:** Claude (Opus 4.6)
**Scope:** BDE Electron app test suite (unit + component tests)

---

## Executive Summary

**Current status:** BDE has **26 test files** covering **~130+ test cases** across ~70 source files. All tests passing. Test infrastructure is solid (Vitest + React Testing Library + jsdom). Coverage has improved significantly from the initial 5-file baseline (2026-03-15) but gaps remain in critical areas:

- **Stores:** 7/11 covered (64% — missing: agentHistory, commandPalette, localAgents, unifiedAgents)
- **Components:** ~15/42 covered (36% — missing most sessions/, terminal/, sprint/, diff/ components)
- **Main process:** 0/6 files (0% — entire Electron main process untested)
- **Utilities:** 3/4 libs covered (75% — missing github-api.ts)

---

## Broken Tests (fix first)

✅ **No broken tests.** All 26 test files pass.

**Note:** The task description mentioned `gateway.test.ts`, `theme.test.ts`, `TitleBar.test.tsx`, and `ErrorBoundary.test.tsx` as "pre-existing broken tests" — **these are now passing**. Recent work (2026-03-15 to 2026-03-16) appears to have fixed them.

**Evidence:**

- `src/renderer/src/lib/__tests__/gateway.test.ts`: 8 tests passing (WS mock, auth flow, call queue, timeout)
- `src/renderer/src/stores/__tests__/theme.test.ts`: 7 tests passing (theme toggle, localStorage persist)
- `src/renderer/src/components/layout/__tests__/TitleBar.test.tsx`: 5 tests passing (repo filter, cost display, theme toggle)
- `src/renderer/src/components/ui/__tests__/ErrorBoundary.test.tsx`: 4 tests passing (catches errors, custom fallback)

---

## Coverage Gaps

### Untested Stores (4 files — HIGH PRIORITY)

These stores have complex state logic and are used across the app:

1. **`stores/agentHistory.ts`** (107 LOC)
   - **Why critical:** Manages agent execution history, log polling with setInterval
   - **Risk:** Log polling interval leaks, fetchAgents race conditions, importExternal data corruption
   - **Should test:**
     - `fetchAgents` populates agents list from window.api
     - `selectAgent(id)` clears previous interval, starts new log polling
     - `stopLogPolling` clears interval (no leak)
     - `importExternal` calls api.agents.import and refreshes list

2. **`stores/localAgents.ts`** (162 LOC)
   - **Why critical:** Spawns local Claude agents, tracks PIDs, manages log tailing, persists to localStorage
   - **Risk:** PID tracking mismatch, spawnedAgents desyncs, log interval leaks, localStorage corruption
   - **Should test:**
     - `spawnAgent` calls window.api.spawnLocalAgent and adds to spawnedAgents
     - `spawnAgent` persists to localStorage (check partialize)
     - `selectLocalAgent(pid)` stops old polling, starts new
     - `killLocalAgent` calls api.killLocalAgent
     - `startLogPolling` / `stopLogPolling` interval management

3. **`stores/commandPalette.ts`** (16 LOC)
   - **Why critical:** Controls Cmd+K modal visibility
   - **Risk:** Low (simple boolean toggle)
   - **Should test:**
     - `open()` sets isOpen: true
     - `close()` sets isOpen: false
     - `toggle()` flips state

4. **`stores/unifiedAgents.ts`** (181 LOC — React hook, not Zustand)
   - **Why critical:** Merges 4 data sources (sessions, subAgents, processes, historyAgents) into unified list
   - **Risk:** Data source merge bugs, stale timestamp logic, status normalization errors
   - **Should test:**
     - `useUnifiedAgents` merges all 4 sources
     - `groupUnifiedAgents` categorizes by status (active, recent, history)
     - `getStaleLevel` calculates correct staleness (fresh < 1h, aging < 1d, stale < 7d, dead)
     - `normalizeStatus` maps raw status strings correctly

### Untested Components (HIGH PRIORITY)

**Sessions components (0/9 tested):**

| Component                 | LOC  | Why Critical                                                        |
| ------------------------- | ---- | ------------------------------------------------------------------- |
| `ChatThread.tsx`          | ~150 | Core chat UI — renders message stream, handles polling, auto-scroll |
| `LiveFeed.tsx`            | ~80  | Real-time agent output stream — WebSocket data handling             |
| `AgentHistoryPanel.tsx`   | ~120 | Shows agent history, log viewer — table rendering, selection        |
| `AgentList.tsx`           | ~100 | Renders unified agent list with grouping                            |
| `AgentRow.tsx`            | ~80  | Individual agent row — status badges, kill button                   |
| `LocalAgentRow.tsx`       | ~90  | Local agent row with interactive steering                           |
| `LocalAgentLogViewer.tsx` | ~70  | Log tail viewer with polling                                        |
| `SessionHeader.tsx`       | ~60  | Session metadata display                                            |
| `SessionLogViewer.tsx`    | ~80  | Session output log viewer                                           |

**Terminal components (0/4 tested):**

| Component            | LOC  | Why Critical                                  |
| -------------------- | ---- | --------------------------------------------- |
| `TerminalPane.tsx`   | ~180 | xterm.js integration, PTY lifecycle, find bar |
| `FindBar.tsx`        | ~60  | Terminal search UI — xterm-addon-search       |
| `ShellPicker.tsx`    | ~40  | Shell selector dropdown                       |
| `AgentOutputTab.tsx` | ~50  | Agent output display in terminal view         |

**Sprint/Git components (0/2 tested):**

- `SprintBoard.tsx` (~100 LOC) — Task board with drag-drop (react-dnd?)
- `DiffViewer.tsx` (~120 LOC) — Git diff rendering with syntax highlighting

**Layout components:**

- **✅ Tested:** TitleBar, StatusBar, ToastContainer, CommandPalette (5 test files)
- **❌ Missing:** ActivityBar.tsx (~80 LOC — sidebar navigation)

**UI components:**

- **✅ Tested:** Badge, Button, EmptyState, ErrorBoundary, Input, Spinner, Textarea (7 test files)
- **❌ Missing:** Card, Divider, Kbd, Panel, Tooltip (5 files — all simple wrappers, P2 priority)

### Untested Libraries

**`lib/github-api.ts`** (~60 LOC)

- **Why critical:** GitHub PR integration — lists open PRs, merges PRs
- **Risk:** API auth errors, rate limiting, merge conflicts
- **Should test:**
  - `listOpenPRs(token)` returns PR list
  - `listOpenPRs` with invalid token throws
  - `mergePR(token, owner, repo, number)` calls correct endpoint

### Untested Main Process (0% coverage — CRITICAL GAP)

**All main process files have zero tests:**

1. **`main/index.ts`** (240 LOC) — **HIGHEST RISK**
   - All IPC handlers (22 handlers: gateway, git, terminal, agents, config, fs)
   - Terminal PTY lifecycle (create, write, resize, kill)
   - Window management
   - **Risk:** IPC handler crashes, PTY memory leaks, terminal zombie processes
   - **Should test (unit tests with mock ipcMain):**
     - `terminal:create` creates PTY and returns id
     - `terminal:write` writes to correct PTY
     - `terminal:kill` cleans up PTY from Map
     - `gateway:invoke` proxies HTTP correctly
     - `git:status` calls gitStatus and returns result
     - `local:spawnClaudeAgent` calls spawnClaudeAgent
     - `agents:list` calls listAgents with correct args

2. **`main/local-agents.ts`** (~150 LOC)
   - `getAgentProcesses()` — parses `ps aux` output
   - `spawnClaudeAgent(args)` — spawns child process, logs to file
   - `tailAgentLog(args)` — reads log file from byte offset
   - `cleanupOldLogs()` — deletes logs older than 7 days
   - **Risk:** Process spawn failures, log file race conditions, log cleanup deletes active logs

3. **`main/agent-history.ts`** (~120 LOC)
   - Agent metadata DB (JSON files in ~/.bde/agents/)
   - `listAgents(limit, status)` — reads dir, parses JSON
   - `importAgent(meta, content)` — writes meta + log files
   - **Risk:** Concurrent writes, corrupted JSON, file handle leaks

4. **`main/git.ts`** (~200 LOC)
   - Git operations via child_process (status, diff, log, commit, push, branches, checkout)
   - **Risk:** Command injection, race conditions, uncommitted changes lost

5. **`main/fs.ts`** (~80 LOC)
   - Filesystem operations (listMemoryFiles, readMemoryFile, writeMemoryFile)
   - **Risk:** Path traversal, permission errors

6. **`main/config.ts`** (~60 LOC)
   - Reads OpenClaw config from `~/.openclaw/openclaw.json`
   - **Risk:** Missing config file, malformed JSON, missing required fields

### Untested Views (smoke tests exist ✅)

**All 7 views have smoke tests** (`views/__tests__/smoke.test.tsx`):

- SessionsView, SprintView, DiffView, MemoryView, CostView, SettingsView, TerminalView

These verify views render without crashing. **No behavioral tests** (user interactions, data fetching).

### Untested Hooks

**`hooks/useTaskNotifications.ts`** (~40 LOC)

- Desktop notification on task completion
- **Risk:** Notification permission errors, notification spam

---

## Unit Test Plan (by file)

### Stores (Priority: P0)

#### `stores/agentHistory.ts`

```
✓ fetchAgents populates agents list
✓ fetchAgents handles API error gracefully
✓ selectAgent clears previous log interval
✓ selectAgent starts new log polling
✓ clearSelection stops polling
✓ stopLogPolling clears interval
✓ importExternal calls api.agents.import
✓ importExternal refreshes agents list after import
```

#### `stores/localAgents.ts`

```
✓ spawnAgent calls window.api.spawnLocalAgent
✓ spawnAgent adds to spawnedAgents array
✓ spawnAgent persists to localStorage
✓ sendToAgent calls api with correct pid and message
✓ killLocalAgent calls api.killLocalAgent
✓ selectLocalAgent stops old polling, clears state
✓ startLogPolling polls every 1s
✓ stopLogPolling clears interval
```

#### `stores/commandPalette.ts`

```
✓ initial state isOpen: false
✓ open() sets isOpen: true
✓ close() sets isOpen: false
✓ toggle() flips state
```

#### `stores/unifiedAgents.ts`

```
✓ useUnifiedAgents merges sessions into agents list
✓ useUnifiedAgents merges subAgents
✓ useUnifiedAgents merges local processes
✓ useUnifiedAgents merges history agents (non-running only)
✓ groupUnifiedAgents categorizes by status (active, recent, history)
✓ groupUnifiedAgents sorts by timestamp
✓ getStaleLevel returns 'fresh' for < 1h
✓ getStaleLevel returns 'stale' for > 1d
✓ normalizeStatus maps 'completed' → 'done'
✓ normalizeStatus maps unknown → 'unknown'
```

### Libraries (Priority: P0)

#### `lib/github-api.ts`

```
✓ listOpenPRs returns PR array
✓ listOpenPRs with no token throws
✓ listOpenPRs handles API errors
✓ mergePR calls correct endpoint
✓ mergePR handles merge conflicts
```

### Main Process (Priority: P0 — use vitest with Node environment)

#### `main/index.ts` (IPC handlers)

```
✓ terminal:create spawns PTY and returns id
✓ terminal:write writes to correct PTY
✓ terminal:resize calls pty.resize
✓ terminal:kill removes PTY from map
✓ gateway:invoke proxies HTTP POST
✓ git:status calls gitStatus with cwd
✓ local:spawnClaudeAgent calls spawnClaudeAgent
✓ agents:list calls listAgents
```

#### `main/local-agents.ts`

```
✓ getAgentProcesses parses ps output
✓ spawnClaudeAgent spawns child process
✓ spawnClaudeAgent creates log file
✓ tailAgentLog reads from byte offset
✓ tailAgentLog handles missing log file
✓ cleanupOldLogs deletes old logs only
```

#### `main/agent-history.ts`

```
✓ listAgents reads agent metadata
✓ listAgents filters by status
✓ importAgent writes meta and log files
✓ pruneOldAgents deletes agents older than 30d
```

#### `main/git.ts`

```
✓ gitStatus parses git status output
✓ gitDiffFile returns diff for file
✓ gitCommit executes git commit
✓ gitPush handles no upstream
```

### Components (Priority: P1)

#### `components/sessions/ChatThread.tsx`

```
✓ renders message lines from chat store
✓ auto-scrolls on new messages
✓ applies correct styling for user vs agent messages
✓ shows timestamp on hover
```

#### `components/sessions/LiveFeed.tsx`

```
✓ renders live feed header
✓ appends chunks as they arrive
✓ marks feed as done when stream ends
✓ auto-scrolls to bottom
```

#### `components/sessions/AgentHistoryPanel.tsx`

```
✓ fetches agents on mount
✓ renders agent rows
✓ clicking row selects agent
✓ shows log viewer when agent selected
```

#### `components/terminal/TerminalPane.tsx` (mock xterm)

```
✓ creates PTY on mount
✓ disposes PTY on unmount
✓ writes input to PTY
✓ handles PTY data events
✓ handles PTY exit events
✓ find bar toggles visibility
```

#### `components/layout/ActivityBar.tsx`

```
✓ renders view buttons
✓ clicking view button calls setActiveView
✓ active view has correct styling
```

---

## E2E Test Plan

**Infrastructure:** Use Playwright with Electron runner (`@playwright/test` + `electron` package).

**Setup:**

```bash
npm install -D @playwright/test playwright-electron
```

**Config:** `playwright.config.ts` with `webServer` pointing to dev server.

### Critical User Flows (5 tests)

#### E2E-1: Session list loads and shows agents

```
Given: Gateway is running
When: User opens BDE
Then: Session list fetches from gateway
  And: Displays running/recent sections
  And: Shows session count in title bar
```

#### E2E-2: Spawn agent flow

```
Given: User clicks "New Agent" button
When: Spawn modal opens
Then: User enters task description
  And: Selects model (sonnet/haiku/opus)
  And: Selects repo path
  And: Clicks "Spawn"
Then: Agent appears in session list
  And: Session is selected
  And: Chat pane shows agent output
```

#### E2E-3: Terminal opens and accepts input

```
Given: User clicks Terminal view
When: Terminal pane loads
Then: PTY is created
  And: User types "echo hello"
  And: Presses Enter
Then: Terminal shows "hello"
```

#### E2E-4: Command palette (Cmd+P) navigation

```
Given: User presses Cmd+P
When: Command palette opens
Then: Shows list of commands
  And: User types "sessions"
Then: Filters to session commands
  And: User presses Enter on "Go to Sessions"
Then: Switches to Sessions view
  And: Command palette closes
```

#### E2E-5: Agent log viewer shows output

```
Given: User selects a running agent
When: Chat pane loads
Then: Shows agent chat messages
  And: Shows live feed (if active)
  And: User can scroll through history
  And: Auto-scrolls when new messages arrive
```

---

## Infrastructure Gaps

### ✅ What's Working

1. **Vitest config** (`vitest.config.ts`)
   - jsdom environment ✅
   - globals: true ✅
   - setupFiles: test-setup.ts ✅

2. **Test setup** (`src/renderer/src/test-setup.ts`)
   - Imports @testing-library/jest-dom ✅

3. **Mocks**
   - window.api IPC mocked in test files ✅
   - Zustand stores reset between tests ✅
   - WebSocket mocked in gateway.test.ts ✅

### ❌ What's Missing

1. **No E2E tests** (Playwright not configured)
   - Missing: `playwright.config.ts`
   - Missing: `e2e/` directory
   - Missing: Electron Playwright integration

2. **No main process tests** (main/ folder has zero tests)
   - Need separate vitest config for Node environment
   - Need IPC mocking strategy (mock ipcMain/ipcRenderer)

3. **No coverage reporting**
   - No vitest coverage config (c8/istanbul)
   - No coverage thresholds
   - No CI badge

4. **No CI/CD test runner**
   - No GitHub Actions workflow for tests
   - No pre-commit hook for test validation

5. **window.api mock is scattered**
   - Each test file defines its own window.api mock
   - Should centralize in test-setup.ts or test-utils.ts
   - Missing: shared mock factory for window.api

6. **No test utils/helpers**
   - Missing: `test-utils.tsx` with custom render (e.g., `renderWithProviders`)
   - Missing: Mock data factories (e.g., `makeMockSession()`, `makeMockAgent()`)

### Recommended Additions

1. **`vitest.config.main.ts`** (for main process tests)

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts']
  }
})
```

2. **`src/renderer/src/test-utils.tsx`** (shared test utilities)

```ts
import { render } from '@testing-library/react'
import { ReactElement } from 'react'

// Mock window.api factory
export const mockWindowApi = (overrides = {}) => ({
  getGatewayConfig: vi.fn().mockResolvedValue({ url: 'http://localhost', token: 'tok' }),
  terminal: {
    create: vi.fn().mockResolvedValue(1),
    write: vi.fn(),
    kill: vi.fn()
  },
  ...overrides
})

// Custom render with providers
export const renderWithProviders = (ui: ReactElement) => {
  return render(ui)
}

// Mock data factories
export const makeMockSession = (overrides = {}) => ({
  key: 'test-key',
  sessionId: 'sess-1',
  model: 'sonnet',
  displayName: 'Test',
  ...overrides
})
```

3. **`playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    headless: false
  }
})
```

4. **`.github/workflows/test.yml`** (CI)

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test
```

---

## Quick Wins

**3 tests you could write in under 30 min that would catch bugs Ryan hit:**

### Quick Win #1: `stores/localAgents.test.ts` — Spawn agent tracking

**Why:** Ryan likely hit bugs with spawned agents not appearing in the list or log viewer not loading.

```ts
it('spawnAgent adds to spawnedAgents and persists', async () => {
  const result = await useLocalAgentsStore.getState().spawnAgent({
    task: 'test task',
    repoPath: '/path/to/repo'
  })

  expect(useLocalAgentsStore.getState().spawnedAgents).toHaveLength(1)
  expect(useLocalAgentsStore.getState().spawnedAgents[0].pid).toBe(result.pid)

  // Check localStorage persistence
  const stored = JSON.parse(localStorage.getItem('bde-local-agents') || '{}')
  expect(stored.state.spawnedAgents).toHaveLength(1)
})
```

### Quick Win #2: `main/local-agents.test.ts` — PTY spawn errors

**Why:** Ryan likely hit errors when spawning agents (missing claude binary, permission errors).

```ts
it('spawnClaudeAgent throws on missing binary', async () => {
  vi.mock('child_process', () => ({
    spawn: vi.fn(() => {
      throw new Error('spawn ENOENT')
    })
  }))

  await expect(
    spawnClaudeAgent({ task: 'test', repoPath: '/path', model: 'sonnet' })
  ).rejects.toThrow('spawn ENOENT')
})
```

### Quick Win #3: `components/sessions/MessageInput.test.tsx` — Send button disabled state

**Why:** Ryan likely tried to send empty messages or messages while agent is running.

```ts
it('Send button is disabled when input is empty', async () => {
  render(<MessageInput onSent={vi.fn()} disabled={false} />)

  const sendButton = screen.getByRole('button', { name: /send/i })
  expect(sendButton).toBeDisabled()
})

it('Send button is disabled when disabled prop is true', async () => {
  render(<MessageInput onSent={vi.fn()} disabled={true} />)

  const textarea = screen.getByRole('textbox')
  await userEvent.type(textarea, 'test message')

  const sendButton = screen.getByRole('button', { name: /send/i })
  expect(sendButton).toBeDisabled()
})
```

---

## Test Coverage Summary

| Category                  | Files  | Tested | %       | Priority |
| ------------------------- | ------ | ------ | ------- | -------- |
| **Stores**                | 11     | 7      | 64%     | P0       |
| **Libs**                  | 4      | 3      | 75%     | P0       |
| **Main Process**          | 6      | 0      | 0%      | P0       |
| **UI Components**         | 12     | 7      | 58%     | P1       |
| **Layout Components**     | 5      | 4      | 80%     | P1       |
| **Session Components**    | 13     | 3      | 23%     | P0       |
| **Terminal Components**   | 4      | 0      | 0%      | P1       |
| **Sprint/Git Components** | 3      | 0      | 0%      | P1       |
| **Views**                 | 7      | 7      | 100%\*  | P1       |
| **Hooks**                 | 1      | 0      | 0%      | P2       |
| **Total**                 | **66** | **31** | **47%** | —        |

\* Views have smoke tests only (render without crashing)

---

## Next Steps

### Immediate (before next prod deploy)

1. **Add main process tests** — highest risk area
2. **Test untested stores** — agentHistory, localAgents, unifiedAgents, commandPalette
3. **Add Quick Wins** — catch bugs Ryan hit

### Short-term (this sprint)

4. **Add E2E tests** — Playwright setup + 5 critical flows
5. **Test session components** — ChatThread, LiveFeed, AgentHistoryPanel
6. **Centralize test utils** — test-utils.tsx with shared mocks

### Long-term (next sprint)

7. **Coverage reporting** — vitest coverage config, CI badge
8. **CI/CD integration** — GitHub Actions workflow
9. **Pre-commit hooks** — run tests before commit (husky + lint-staged)

---

## Appendix: Test File Inventory

### ✅ Tested (26 files)

**Stores (7):**

- `stores/__tests__/chat.test.ts`
- `stores/__tests__/gateway.test.ts`
- `stores/__tests__/sessions.test.ts`
- `stores/__tests__/terminal.test.ts`
- `stores/__tests__/theme.test.ts`
- `stores/__tests__/toasts.test.ts`
- `stores/__tests__/ui.test.ts`

**Libs (3):**

- `lib/__tests__/cost.test.ts`
- `lib/__tests__/diff-parser.test.ts`
- `lib/__tests__/gateway.test.ts`
- `lib/__tests__/rpc.test.ts`

**UI Components (7):**

- `components/ui/__tests__/Badge.test.tsx`
- `components/ui/__tests__/Button.test.tsx`
- `components/ui/__tests__/EmptyState.test.tsx`
- `components/ui/__tests__/ErrorBoundary.test.tsx`
- `components/ui/__tests__/Input.test.tsx`
- `components/ui/__tests__/Spinner.test.tsx`
- `components/ui/__tests__/Textarea.test.tsx`

**Layout (4):**

- `components/layout/__tests__/CommandPalette.test.tsx`
- `components/layout/__tests__/StatusBar.test.tsx`
- `components/layout/__tests__/TitleBar.test.tsx`
- `components/layout/__tests__/ToastContainer.test.tsx`

**Session Components (3):**

- `components/sessions/__tests__/AgentDirector.test.tsx`
- `components/sessions/__tests__/MessageInput.test.tsx`
- `components/sessions/__tests__/SessionList.test.tsx`

**Views (1 smoke test file):**

- `views/__tests__/smoke.test.tsx` (7 views)

### ❌ Untested (40 files)

**Stores (4):**

- `stores/agentHistory.ts`
- `stores/commandPalette.ts`
- `stores/localAgents.ts`
- `stores/unifiedAgents.ts`

**Libs (1):**

- `lib/github-api.ts`

**Main Process (6):**

- `main/index.ts`
- `main/agent-history.ts`
- `main/config.ts`
- `main/fs.ts`
- `main/git.ts`
- `main/local-agents.ts`

**UI Components (5):**

- `components/ui/Card.tsx`
- `components/ui/Divider.tsx`
- `components/ui/Kbd.tsx`
- `components/ui/Panel.tsx`
- `components/ui/Tooltip.tsx`

**Layout (1):**

- `components/layout/ActivityBar.tsx`

**Session Components (10):**

- `components/sessions/AgentHistoryPanel.tsx`
- `components/sessions/AgentList.tsx`
- `components/sessions/AgentRow.tsx`
- `components/sessions/ChatPane.tsx`
- `components/sessions/ChatThread.tsx`
- `components/sessions/LiveFeed.tsx`
- `components/sessions/LocalAgentLogViewer.tsx`
- `components/sessions/LocalAgentRow.tsx`
- `components/sessions/SessionHeader.tsx`
- `components/sessions/SessionLogViewer.tsx`
- `components/sessions/SpawnModal.tsx`
- `components/sessions/TaskComposer.tsx`

**Terminal Components (4):**

- `components/terminal/AgentOutputTab.tsx`
- `components/terminal/FindBar.tsx`
- `components/terminal/ShellPicker.tsx`
- `components/terminal/TerminalPane.tsx`

**Sprint/Git (3):**

- `components/sprint/PRList.tsx`
- `components/sprint/SprintBoard.tsx`
- `components/diff/DiffViewer.tsx`

**Hooks (1):**

- `hooks/useTaskNotifications.ts`

---

**End of Report**
