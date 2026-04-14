# Security: Review Handler Input Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the input validation gap in BDE's code review IPC handlers — renderer-supplied git refs, file paths, and worktree paths flow into subprocess calls without validation.

**Architecture:** Add validation at the top of each affected IPC handler before any git/filesystem operations. No structural changes to handlers.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3, execFile (no shell), Vitest for tests.

---

## Build & Test Commands

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

## Files to Modify

| File | Change |
|------|--------|
| `src/main/handlers/review.ts` | Add `base` ref validation and `worktreePath`/`filePath` path validation to query handlers |
| `src/main/sprint-pr-poller.ts` | Make `onTaskTerminal` required in `SprintPrPollerDeps` interface; throw if not provided |
| `src/main/handlers/webhook-handlers.ts` | Add host validation to reject loopback/private/link-local addresses in webhook URLs |
| `src/main/handlers/__tests__/review.test.ts` | Add security boundary tests for each finding |
| `src/main/__tests__/sprint-pr-poller.test.ts` | Update existing test that omits `onTaskTerminal` (now required); add throw test |
| `src/main/handlers/__tests__/webhook-handlers.test.ts` | Add SSRF host validation tests |

---

## Finding 1 — F-t2-cmdinj-3: Git ref injection via `base` parameter (Critical)

### Context

In `src/main/handlers/review.ts`, three handlers accept `base` from the renderer payload and interpolate it directly into git revision range arguments:

- `review:getDiff` (line 52): `['diff', '--numstat', `${base}...HEAD`]`
- `review:getCommits` (line 85): `['log', `${base}..HEAD`, ...]`
- `review:getFileDiff` (line 107): `['diff', `${base}...HEAD`, '--', filePath]`

Even with `execFile` (no shell), git's argument parser treats strings like `--format=%(body)` as option flags, and inputs like `../../etc` can traverse git object namespaces. The fix is to validate `base` against a safe pattern before use.

### Step 1.1 — Write failing tests

Add the following test block to `src/main/handlers/__tests__/review.test.ts` inside the `describe('handler functions', ...)` block (after the existing handler registration tests, before the merge tests):

```typescript
describe('input validation — base ref', () => {
  function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {}
    vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown
    })
    registerReviewHandlers({ onStatusTerminal: vi.fn() })
    return handlers
  }

  const _mockEvent = {} as IpcMainInvokeEvent
  const VALID_WORKTREE = '/Users/ryan/worktrees/bde/Users-ryan-projects-BDE/some-task-id'

  it.each([
    ['main', true],
    ['abc123def456abc1', true],        // 16-char hex SHA prefix
    ['a'.repeat(40), true],            // full SHA
    ['feat/my-branch', true],
    ['origin/main', true],
    ['HEAD~1', false],                  // tilde not allowed
    ['--format=%(body)', false],        // flag injection
    ['../../etc/passwd', false],        // path traversal
    ['', false],                        // empty
    ['; rm -rf /', false],             // shell metachar
    ['a'.repeat(201), false],          // too long
  ])('review:getDiff base="%s" → valid=%s', async (base, shouldPass) => {
    const handlers = captureHandlers()
    if (shouldPass) {
      // Should not throw — git call may fail but that's fine in unit test
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
      ).rejects.toThrow(/invalid git ref/i)
    }
  })

  it.each([
    ['main', true],
    ['abc123def456abc1', true],
    ['--format=%(body)', false],
    ['../../etc', false],
    ['', false],
  ])('review:getCommits base="%s" → valid=%s', async (base, shouldPass) => {
    const handlers = captureHandlers()
    if (shouldPass) {
      await expect(
        handlers['review:getCommits'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getCommits'](_mockEvent, { worktreePath: VALID_WORKTREE, base })
      ).rejects.toThrow(/invalid git ref/i)
    }
  })

  it.each([
    ['main', true],
    ['abc123def456abc1', true],
    ['--format=%(body)', false],
    ['', false],
  ])('review:getFileDiff base="%s" → valid=%s', async (base, shouldPass) => {
    const handlers = captureHandlers()
    if (shouldPass) {
      await expect(
        handlers['review:getFileDiff'](_mockEvent, {
          worktreePath: VALID_WORKTREE,
          base,
          filePath: 'src/foo.ts'
        })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getFileDiff'](_mockEvent, {
          worktreePath: VALID_WORKTREE,
          base,
          filePath: 'src/foo.ts'
        })
      ).rejects.toThrow(/invalid git ref/i)
    }
  })
})
```

Run tests — these should fail because validation doesn't exist yet:

```bash
npm test -- --reporter=verbose src/main/handlers/__tests__/review.test.ts
```

### Step 1.2 — Add validation to `review.ts`

In `src/main/handlers/review.ts`, add the following validation helper after the existing `getRepoConfig` function (around line 38), before `registerReviewHandlers`:

```typescript
/**
 * Safe git ref pattern: commit SHAs, branch names, and remote refs.
 * Allows: a-z A-Z 0-9 / _ . -
 * Rejects: leading dashes (option flags), path traversal (..), shell metacharacters,
 *          tilde (~), caret (^), and other git special syntax.
 * Max length: 200 characters (git itself limits ref names to ~256 bytes).
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,198}$/

function validateGitRef(ref: string | undefined | null): void {
  if (!ref || !SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}". Must match pattern [a-zA-Z0-9/_.-], max 200 chars.`)
  }
}
```

Then add `validateGitRef(base)` as the first line inside each of the three handlers:

**`review:getDiff`** (line ~49):
```typescript
safeHandle('review:getDiff', async (_e, payload) => {
  const { worktreePath, base } = payload
  validateGitRef(base)                          // <-- ADD THIS LINE
  // ... rest unchanged
```

**`review:getCommits`** (line ~83):
```typescript
safeHandle('review:getCommits', async (_e, payload) => {
  const { worktreePath, base } = payload
  validateGitRef(base)                          // <-- ADD THIS LINE
  // ... rest unchanged
```

**`review:getFileDiff`** (line ~104):
```typescript
safeHandle('review:getFileDiff', async (_e, payload) => {
  const { worktreePath, filePath, base } = payload
  validateGitRef(base)                          // <-- ADD THIS LINE
  // ... rest unchanged
```

### Step 1.3 — Run tests

```bash
npm run typecheck
npm test -- src/main/handlers/__tests__/review.test.ts
```

All new tests should now pass. Fix any failures before continuing.

### Step 1.4 — Commit

```bash
git add src/main/handlers/review.ts src/main/handlers/__tests__/review.test.ts
git commit -m "fix: validate git ref 'base' param in review IPC handlers to prevent ref injection"
```

---

## Finding 2 — F-t2-pathval-1+2: Unvalidated `worktreePath` and `filePath` (High)

### Context

- `review:getDiff` and `review:getCommits` accept `worktreePath` from the renderer. A malicious payload could point this at an arbitrary directory (e.g. `/etc`), causing git commands to run outside the expected worktree base.
- `review:getFileDiff` accepts `filePath` with no traversal check — a value like `../../etc/passwd` or `/etc/hosts` would cause git to attempt to diff an arbitrary path.

The valid `worktreePath` always lives under the configured `agentManager.worktreeBase` (default: `~/worktrees/bde`). The validation must resolve symlinks to prevent bypass via `~/../etc`.

### Step 2.1 — Write failing tests

Add to `src/main/handlers/__tests__/review.test.ts` inside `describe('handler functions', ...)`:

```typescript
describe('input validation — worktreePath', () => {
  function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {}
    vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown
    })
    registerReviewHandlers({ onStatusTerminal: vi.fn() })
    return handlers
  }

  const _mockEvent = {} as IpcMainInvokeEvent
  const VALID_BASE = 'main'

  it.each([
    // [worktreePath, shouldPass]
    ['/Users/ryan/worktrees/bde/Users-ryan-projects-BDE/abc123', true],
    ['/etc/passwd', false],
    ['../../etc', false],
    ['/tmp/evil', false],
    ['', false],
  ])('review:getDiff worktreePath="%s" → valid=%s', async (worktreePath, shouldPass) => {
    const { getSettingJson } = await import('../../settings')
    vi.mocked(getSettingJson).mockReturnValue(undefined) // no repos needed for path check

    const handlers = captureHandlers()
    if (shouldPass) {
      // May throw for other reasons (git not found etc.) but not path validation
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath, base: VALID_BASE })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getDiff'](_mockEvent, { worktreePath, base: VALID_BASE })
      ).rejects.toThrow(/invalid worktree path/i)
    }
  })

  it.each([
    ['/Users/ryan/worktrees/bde/Users-ryan-projects-BDE/abc123', true],
    ['/etc', false],
    ['', false],
  ])('review:getCommits worktreePath="%s" → valid=%s', async (worktreePath, shouldPass) => {
    const handlers = captureHandlers()
    if (shouldPass) {
      await expect(
        handlers['review:getCommits'](_mockEvent, { worktreePath, base: VALID_BASE })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getCommits'](_mockEvent, { worktreePath, base: VALID_BASE })
      ).rejects.toThrow(/invalid worktree path/i)
    }
  })
})

describe('input validation — filePath', () => {
  function captureHandlers(): Record<string, (...args: unknown[]) => unknown> {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {}
    vi.mocked(safeHandle).mockImplementation((channel: string, handler: unknown) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown
    })
    registerReviewHandlers({ onStatusTerminal: vi.fn() })
    return handlers
  }

  const _mockEvent = {} as IpcMainInvokeEvent
  const VALID_WORKTREE = '/Users/ryan/worktrees/bde/Users-ryan-projects-BDE/abc123'
  const VALID_BASE = 'main'

  it.each([
    ['src/main/foo.ts', true],
    ['README.md', true],
    ['src/renderer/src/App.tsx', true],
    ['../../etc/passwd', false],        // path traversal
    ['/etc/hosts', false],              // absolute path
    ['src/../../../etc', false],        // embedded traversal
    ['', false],                        // empty
  ])('review:getFileDiff filePath="%s" → valid=%s', async (filePath, shouldPass) => {
    const handlers = captureHandlers()
    if (shouldPass) {
      await expect(
        handlers['review:getFileDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base: VALID_BASE, filePath })
      ).resolves.not.toThrow()
    } else {
      await expect(
        handlers['review:getFileDiff'](_mockEvent, { worktreePath: VALID_WORKTREE, base: VALID_BASE, filePath })
      ).rejects.toThrow(/invalid file path/i)
    }
  })
})
```

Run tests to confirm they fail:

```bash
npm test -- src/main/handlers/__tests__/review.test.ts
```

### Step 2.2 — Add worktreePath validation helper to `review.ts`

Add the following imports at the top of `src/main/handlers/review.ts` (after existing imports):

```typescript
import { resolve } from 'path'
import { homedir } from 'os'
import { getSetting } from '../settings'
```

Add the following helpers after `validateGitRef` (before `registerReviewHandlers`):

```typescript
/**
 * Returns the configured worktree base directory, defaulting to ~/worktrees/bde.
 * Resolved to an absolute path (no trailing slash).
 */
function getWorktreeBase(): string {
  const configured = getSetting('agentManager.worktreeBase')
  const raw = configured ?? `${homedir()}/worktrees/bde`
  return resolve(raw)
}

/**
 * Validates that a renderer-supplied worktreePath is inside the configured
 * worktree base directory. Throws if not.
 *
 * Security: prevents a compromised renderer from running git commands in
 * arbitrary directories (e.g. /etc, /).
 */
function validateWorktreePath(worktreePath: string | undefined | null): void {
  if (!worktreePath) {
    throw new Error('Invalid worktree path: must not be empty.')
  }
  const resolved = resolve(worktreePath)
  const base = getWorktreeBase()
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error(
      `Invalid worktree path: "${worktreePath}" is not inside the configured worktree base (${base}).`
    )
  }
}

/**
 * Validates a renderer-supplied file path for use inside a git diff command.
 * Rejects absolute paths and path traversal sequences.
 *
 * Security: git diff with '--' separator passes the file path directly to git;
 * absolute paths or traversal could reference files outside the worktree.
 */
function validateFilePath(filePath: string | undefined | null): void {
  if (!filePath) {
    throw new Error('Invalid file path: must not be empty.')
  }
  if (filePath.startsWith('/')) {
    throw new Error(`Invalid file path: "${filePath}" must not be an absolute path.`)
  }
  if (filePath.includes('..')) {
    throw new Error(`Invalid file path: "${filePath}" must not contain path traversal sequences.`)
  }
}
```

**Important:** The `getSetting` import is already indirectly available via `getSettingJson` — but `getSetting` (string return) needs to be added to the import. Update the settings import line in `review.ts`:

```typescript
// Before:
import { getSettingJson } from '../settings'
// After:
import { getSettingJson, getSetting } from '../settings'
```

### Step 2.3 — Wire validation into handlers

In `review:getDiff` (after `validateGitRef(base)`):
```typescript
safeHandle('review:getDiff', async (_e, payload) => {
  const { worktreePath, base } = payload
  validateGitRef(base)
  validateWorktreePath(worktreePath)    // <-- ADD THIS LINE
  // ... rest unchanged
```

In `review:getCommits` (after `validateGitRef(base)`):
```typescript
safeHandle('review:getCommits', async (_e, payload) => {
  const { worktreePath, base } = payload
  validateGitRef(base)
  validateWorktreePath(worktreePath)    // <-- ADD THIS LINE
  // ... rest unchanged
```

In `review:getFileDiff` (after `validateGitRef(base)`):
```typescript
safeHandle('review:getFileDiff', async (_e, payload) => {
  const { worktreePath, filePath, base } = payload
  validateGitRef(base)
  validateWorktreePath(worktreePath)    // <-- ADD THIS LINE
  validateFilePath(filePath)            // <-- ADD THIS LINE
  // ... rest unchanged
```

### Step 2.4 — Fix the worktreePath tests' mock for `getSetting`

The test file mocks `../../settings` with `getSettingJson` only. Add `getSetting` to the mock:

In `src/main/handlers/__tests__/review.test.ts`, find:

```typescript
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))
```

Replace with:

```typescript
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  getSetting: vi.fn().mockReturnValue(undefined)  // returns undefined → uses default ~/worktrees/bde
}))
```

The test uses `/Users/ryan/worktrees/bde/...` as the valid path, which matches the default base. If tests run in CI where `homedir()` differs, you may need to set the mock to return a fixed base. To make the test portable, update the valid worktree constant in the test to use `homedir()`:

At the top of the test file (in the describe block where tests are written), add:
```typescript
import { homedir } from 'os'
// ...
const VALID_WORKTREE = `${homedir()}/worktrees/bde/Users-ryan-projects-BDE/abc123`
```

And replace the hardcoded `/Users/ryan/worktrees/bde/...` string in all test cases with `VALID_WORKTREE`.

### Step 2.5 — Run tests

```bash
npm run typecheck
npm test -- src/main/handlers/__tests__/review.test.ts
```

All new tests should pass. Fix any failures.

### Step 2.6 — Commit

```bash
git add src/main/handlers/review.ts src/main/handlers/__tests__/review.test.ts
git commit -m "fix: validate worktreePath and filePath in review IPC handlers to prevent path traversal"
```

---

## Finding 3 — F-t3-tasktrans-2: `onTaskTerminal` optional in `SprintPrPollerDeps` (High)

### Context

`SprintPrPollerDeps` in `src/main/sprint-pr-poller.ts` declares `onTaskTerminal` as optional (`onTaskTerminal?`). When it is absent, the poller logs a warning but silently skips dependency resolution. This means blocked downstream tasks never get unblocked after a PR merges.

The current call site (`startSprintPrPoller` in the same file) always wires it. Making it required enforces correct usage at compile time.

**Breaking change note:** The existing test `'does not call onTaskTerminal when it is not provided'` (line 198 in `sprint-pr-poller.test.ts`) creates a poller *without* `onTaskTerminal` and expects no crash. That test must be updated to either (a) provide the callback, or (b) test that construction throws when the callback is missing.

### Step 3.1 — Write failing tests

Add to `src/main/__tests__/sprint-pr-poller.test.ts` (at the end of the `describe('createSprintPrPoller', ...)` block):

```typescript
it('throws at construction when onTaskTerminal is not provided', () => {
  const { onTaskTerminal: _omit, ...depsWithoutTerminal } = makeDeps()
  expect(() => createSprintPrPoller(depsWithoutTerminal)).toThrow(/onTaskTerminal is required/)
})
```

Run to confirm it fails:

```bash
npm test -- src/main/__tests__/sprint-pr-poller.test.ts
```

### Step 3.2 — Make `onTaskTerminal` required

In `src/main/sprint-pr-poller.ts`, change the interface:

```typescript
// Before:
export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTask[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => string[]
  markTaskCancelledByPrNumber: (prNumber: number) => string[]
  updateTaskMergeableState: (prNumber: number, state: string | null) => void
  onTaskTerminal?: (taskId: string, status: string) => void
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
  initialDelayMs?: number
}

// After:
export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTask[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => string[]
  markTaskCancelledByPrNumber: (prNumber: number) => string[]
  updateTaskMergeableState: (prNumber: number, state: string | null) => void
  /** Required: called after PR merge/close to trigger dependency resolution. */
  onTaskTerminal: (taskId: string, status: string) => void
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
  initialDelayMs?: number
}
```

Add a guard at the start of `createSprintPrPoller`:

```typescript
export function createSprintPrPoller(deps: SprintPrPollerDeps): SprintPrPollerInstance {
  if (!deps.onTaskTerminal) {
    throw new Error(
      '[createSprintPrPoller] onTaskTerminal is required — dependency resolution will not fire without it.'
    )
  }

  let timer: ReturnType<typeof setInterval> | null = null
  // ... rest unchanged
```

Remove the now-unreachable `if (deps.onTaskTerminal)` guard in the `poll()` function's merged and closed branches. The optionality check is no longer needed:

```typescript
// Before (merged branch, ~line 66-80):
if (deps.onTaskTerminal) {
  const promises = ids.map((id) => { ... })
  ...
} else {
  log.warn(`[sprint-pr-poller] onTaskTerminal not wired — dependency resolution will not fire`)
}

// After:
const promises = ids.map((id) => {
  log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`)
  return Promise.resolve(deps.onTaskTerminal(id, 'done'))
})
const results = await Promise.allSettled(promises)
const failed = results
  .map((r, i) =>
    r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null
  )
  .filter(Boolean)
if (failed.length > 0) {
  log.warn(
    `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
  )
}
```

Apply the same simplification to the closed/cancelled branch (the `if (deps.onTaskTerminal)` around line 93).

Also remove the non-null assertion `deps.onTaskTerminal!(id, ...)` — it's now known non-null.

### Step 3.3 — Update the existing test that omits `onTaskTerminal`

In `src/main/__tests__/sprint-pr-poller.test.ts`, update the test at line ~198:

```typescript
// Before:
it('does not call onTaskTerminal when it is not provided', async () => {
  const task = makeTask()
  const { onTaskTerminal: _omit, ...depsWithoutTerminal } = makeDeps({
    listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
    pollPrStatuses: vi
      .fn()
      .mockResolvedValue([
        { taskId: 'task-1', merged: true, state: 'MERGED', mergeableState: null }
      ]),
    markTaskDoneByPrNumber: vi.fn().mockReturnValue(['task-1'])
  })

  const poller = createSprintPrPoller(depsWithoutTerminal)
  // ...
})

// After (rename and repurpose):
it('throws at construction when onTaskTerminal is not provided', () => {
  const { onTaskTerminal: _omit, ...depsWithoutTerminal } = makeDeps()
  expect(() => createSprintPrPoller(depsWithoutTerminal)).toThrow(/onTaskTerminal is required/)
})
```

**Important:** The `makeDeps()` helper in the test file already includes `onTaskTerminal: vi.fn()` by default. All other existing tests pass `onTaskTerminal` via `makeDeps()` and will continue to work. Only the one test that explicitly omits it needs updating.

### Step 3.4 — Run tests

```bash
npm run typecheck
npm test -- src/main/__tests__/sprint-pr-poller.test.ts
```

### Step 3.5 — Commit

```bash
git add src/main/sprint-pr-poller.ts src/main/__tests__/sprint-pr-poller.test.ts
git commit -m "fix: make onTaskTerminal required in SprintPrPollerDeps — prevents silent dep resolution failure"
```

---

## Finding 4 — F-t2-ipcval-3: Webhook URL host validation (Medium)

### Context

`webhook:create`, `webhook:update`, and `webhook:test` in `src/main/handlers/webhook-handlers.ts` accept URLs from the renderer. The `webhook:test` handler fires an outbound `fetch()` to the stored webhook URL. Current validation only checks scheme (if at all). Loopback (`127.0.0.1`, `localhost`), private ranges (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`), and link-local (`169.254.x.x`) addresses are not blocked. A compromised renderer could create a webhook pointing at internal services.

### Step 4.1 — Write failing tests

In `src/main/handlers/__tests__/webhook-handlers.test.ts`, add a new describe block after the existing tests:

```typescript
describe('webhook URL host validation', () => {
  const mockEvent = {}

  it.each([
    // [url, shouldPass, description]
    ['https://example.com/hook', true, 'public HTTPS URL'],
    ['https://hooks.slack.com/services/xxx', true, 'Slack webhook'],
    ['http://example.com/hook', true, 'HTTP public URL'],
    ['https://localhost/hook', false, 'localhost'],
    ['https://127.0.0.1/hook', false, 'IPv4 loopback'],
    ['https://[::1]/hook', false, 'IPv6 loopback'],
    ['https://0.0.0.0/hook', false, 'all-interfaces'],
    ['https://192.168.1.1/hook', false, 'RFC1918 192.168.x.x'],
    ['https://10.0.0.1/hook', false, 'RFC1918 10.x.x.x'],
    ['https://172.16.0.1/hook', false, 'RFC1918 172.16.x.x'],
    ['https://172.31.255.255/hook', false, 'RFC1918 172.31.x.x'],
    ['https://169.254.169.254/hook', false, 'link-local (AWS metadata)'],
    ['https://169.254.0.1/hook', false, 'link-local range'],
    ['ftp://example.com/hook', false, 'non-http scheme'],
    ['not-a-url', false, 'invalid URL'],
    ['', false, 'empty string'],
  ])('webhook:create url="%s" (%s) → valid=%s', async (url, shouldPass, _desc) => {
    const handler = handlers.get('webhook:create')!
    if (shouldPass) {
      await expect(handler(mockEvent, { url, events: [] })).resolves.toBeDefined()
    } else {
      await expect(handler(mockEvent, { url, events: [] })).rejects.toThrow(/invalid webhook url/i)
    }
  })

  it.each([
    ['https://example.com/hook', true],
    ['https://localhost/hook', false],
    ['https://10.0.0.1/hook', false],
  ])('webhook:update url="%s" → valid=%s', async (url, shouldPass) => {
    const handler = handlers.get('webhook:update')!
    if (shouldPass) {
      await expect(handler(mockEvent, { id: 'wh-123', url })).resolves.toBeDefined()
    } else {
      await expect(handler(mockEvent, { id: 'wh-123', url })).rejects.toThrow(/invalid webhook url/i)
    }
  })
})
```

Run to confirm failures:

```bash
npm test -- src/main/handlers/__tests__/webhook-handlers.test.ts
```

### Step 4.2 — Add `validateWebhookUrl` to `webhook-handlers.ts`

Add the following helper at the top of `src/main/handlers/webhook-handlers.ts`, after the imports:

```typescript
/**
 * Validates a webhook URL is a public HTTP/HTTPS endpoint.
 * Rejects:
 *   - Non-http(s) schemes (ftp://, javascript://, etc.)
 *   - Loopback addresses: localhost, 127.x.x.x, ::1, 0.0.0.0
 *   - RFC 1918 private ranges: 10.x, 172.16-31.x, 192.168.x
 *   - Link-local range: 169.254.x.x (AWS/GCP metadata endpoint)
 *
 * Security: prevents SSRF — a compromised renderer could otherwise fire
 * webhooks at internal AWS metadata services, local dev servers, or
 * Kubernetes pod IPs.
 */
function validateWebhookUrl(url: string | undefined | null): void {
  if (!url) {
    throw new Error('Invalid webhook URL: URL must not be empty.')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid webhook URL: "${url}" is not a valid URL.`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid webhook URL: scheme "${parsed.protocol}" is not allowed. Use http or https.`
    )
  }

  const hostname = parsed.hostname.toLowerCase()

  // Loopback
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    throw new Error(`Invalid webhook URL: loopback host "${hostname}" is not allowed.`)
  }

  // IPv4 ranges — only check if it looks like an IPv4 address
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number)
    // 127.x.x.x — loopback
    if (a === 127) {
      throw new Error(`Invalid webhook URL: loopback address "${hostname}" is not allowed.`)
    }
    // 10.x.x.x — RFC 1918
    if (a === 10) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 172.16.0.0 – 172.31.255.255 — RFC 1918
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 192.168.x.x — RFC 1918
    if (a === 192 && b === 168) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 169.254.x.x — link-local (AWS/GCP metadata)
    if (a === 169 && b === 254) {
      throw new Error(`Invalid webhook URL: link-local address "${hostname}" is not allowed.`)
    }
  }
}
```

### Step 4.3 — Wire into handlers

In `webhook:create`:
```typescript
safeHandle(
  'webhook:create',
  async (_e, payload: { url: string; events: string[]; secret?: string }) => {
    validateWebhookUrl(payload.url)        // <-- ADD THIS LINE
    const webhook = createWebhook(payload)
    logger.info(`Created webhook ${webhook.id} for ${payload.url}`)
    return webhook
  }
)
```

In `webhook:update` (only validate if `url` is provided, since it's optional on update):
```typescript
safeHandle(
  'webhook:update',
  async (
    _e,
    payload: { id: string; url?: string; events?: string[]; secret?: string | null; enabled?: boolean }
  ) => {
    if (payload.url !== undefined) {
      validateWebhookUrl(payload.url)      // <-- ADD THIS LINE
    }
    const webhook = updateWebhook(payload)
    logger.info(`Updated webhook ${payload.id}`)
    return webhook
  }
)
```

The `webhook:test` handler uses the URL already stored in the DB (retrieved via `getWebhookById`), so it does not need validation — the URL was validated at `create`/`update` time.

### Step 4.4 — Run tests

```bash
npm run typecheck
npm test -- src/main/handlers/__tests__/webhook-handlers.test.ts
```

### Step 4.5 — Commit

```bash
git add src/main/handlers/webhook-handlers.ts src/main/handlers/__tests__/webhook-handlers.test.ts
git commit -m "fix: add SSRF host validation to webhook URL create/update handlers"
```

---

## Final Verification

Run the full CI suite to confirm no regressions:

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

All four commands must exit zero before opening a PR.

### Expected test additions summary

| Test file | New tests added |
|-----------|----------------|
| `src/main/handlers/__tests__/review.test.ts` | ~22 parameterized cases (base ref, worktreePath, filePath validation) |
| `src/main/__tests__/sprint-pr-poller.test.ts` | 1 (throws when `onTaskTerminal` missing); 1 updated (renamed) |
| `src/main/handlers/__tests__/webhook-handlers.test.ts` | ~18 parameterized cases (host validation for create + update) |

### Regression risk

- The existing review handler tests pass valid `worktreePath` values like `/tmp/worktrees/test`. These will now **fail** the new validation (not under `~/worktrees/bde`). Fix by updating their `worktreePath` to use `${homedir()}/worktrees/bde/some-uuid` or by setting `getSetting` mock to return `/tmp` as the worktree base in those tests. See the note in Step 2.4.
- All existing `sprint-pr-poller.test.ts` tests use `makeDeps()` which includes `onTaskTerminal: vi.fn()`. Only the one test that explicitly destructures it out needs updating.
