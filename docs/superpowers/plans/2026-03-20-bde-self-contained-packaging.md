# BDE Self-Contained Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BDE from a multi-service setup into a single, self-contained macOS DMG that ships with built-in agent orchestration — no external task runner daemon needed.

**Architecture:** Replace the external `claude-task-runner` with an in-process `AgentManager` module in BDE's Electron main process. Add `AuthGuard` for Keychain-based Claude Code subscription auth. Remove all OpenClaw gateway and external task runner dependencies. Package as unsigned macOS arm64 DMG.

**Tech Stack:** Electron 39, electron-vite, React 19, TypeScript, `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `node-pty`, `electron-builder`

**Spec:** `docs/superpowers/specs/2026-03-20-bde-self-contained-packaging-design.md`

---

## File Map

### New Files

| File                                           | Responsibility                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `src/main/agent-manager/agent-manager.ts`      | Drain loop, concurrency pool, spawn/completion orchestration         |
| `src/main/agent-manager/worktree-ops.ts`       | Git worktree create/remove, file-based repo locking                  |
| `src/main/agent-manager/completion-handler.ts` | Post-agent: detect branch, push, open PR, update task status         |
| `src/main/agent-manager/watchdog.ts`           | Per-agent max runtime + idle timeout timers                          |
| `src/main/agent-manager/index.ts`              | Re-exports for clean imports                                         |
| `src/main/auth-guard.ts`                       | Keychain token validation, CLI detection, `ensureSubscriptionAuth()` |
| `src/main/handlers/auth-handlers.ts`           | IPC handlers for auth status checks                                  |
| `src/main/handlers/agent-manager-handlers.ts`  | IPC handlers for AgentManager operations                             |
| `src/renderer/src/components/Onboarding.tsx`   | First-run setup screen (CLI check, token check)                      |

### Deleted Files

| File                                    | Reason                                               |
| --------------------------------------- | ---------------------------------------------------- |
| `src/main/queue-api/server.ts`          | No external task runner to serve                     |
| `src/main/queue-api/router.ts`          | No external task runner to serve                     |
| `src/main/queue-api/event-store.ts`     | No external task runner to serve                     |
| `src/main/queue-api/sse.ts`             | No external task runner to serve                     |
| `src/main/handlers/queue-handlers.ts`   | Imports from deleted queue-api                       |
| `src/main/handlers/gateway-handlers.ts` | OpenClaw gateway — BDE is standalone                 |
| `src/main/sprint-sse.ts`                | SSE connection to external task runner               |
| `src/main/agents/cli-provider.ts`       | SDK-only going forward                               |
| `src/renderer/src/lib/gateway.ts`       | OpenClaw WebSocket client                            |
| `src/renderer/src/lib/taskRunnerSSE.ts` | Task runner SSE client                               |
| `src/renderer/src/stores/gateway.ts`    | Gateway connection store                             |
| `src/renderer/src/stores/sessions.ts`   | OpenClaw session store                               |
| `src/renderer/src/lib/rpc.ts`           | Gateway RPC helper (if solely gateway-dependent)     |
| `src/renderer/src/lib/message.ts`       | Gateway message helper (if solely gateway-dependent) |

### Modified Files

| File                                                          | Change                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`                                           | Remove queue-api/sprint-sse/gateway startup; add AgentManager + AuthGuard startup; rewrite CSP           |
| `src/main/agents/index.ts`                                    | Remove provider factory, export `SdkProvider` directly                                                   |
| `src/main/local-agents.ts`                                    | Remove `steerViaTaskRunner()`, remove `getTaskRunnerConfig` import, remove `createAgentProvider()` usage |
| `src/main/config.ts`                                          | Remove `getGatewayConfig()`, `getTaskRunnerConfig()`, `getAgentProvider()`                               |
| `src/main/settings.ts`                                        | Remove `migrateFromOpenClawConfig()`, add agent-manager settings helpers                                 |
| `src/preload/index.ts`                                        | Remove gateway APIs, add auth-status + agent-manager IPC bridges                                         |
| `src/renderer/src/App.tsx`                                    | Remove gateway store init, add onboarding gate                                                           |
| `src/renderer/src/components/settings/ConnectionsSection.tsx` | Remove gateway + task runner config UI, add auth status display                                          |
| `src/renderer/src/hooks/useSprintPolling.ts`                  | Remove `subscribeSSE` dependency                                                                         |
| `src/renderer/src/hooks/useTaskNotifications.ts`              | Remove `subscribeSSE` dependency                                                                         |
| `src/renderer/src/components/sprint/LogDrawer.tsx`            | Remove `subscribeSSE` imports, use event bus IPC only                                                    |
| `src/renderer/src/stores/sprintEvents.ts`                     | Remove SSE-dependent fields if any                                                                       |
| `src/shared/ipc-channels.ts`                                  | Remove gateway/queue IPC channel types, add auth + agent-manager channels                                |

---

## Task 1: AuthGuard Module

**Files:**

- Create: `src/main/auth-guard.ts`
- Test: `src/main/auth-guard.test.ts`

- [ ] **Step 1: Write failing tests for `checkAuthStatus()`**

```typescript
// src/main/auth-guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkAuthStatus, ensureSubscriptionAuth } from './auth-guard'
import { execFile } from 'child_process'

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

const mockExecFile = vi.mocked(execFile)

function mockKeychainResponse(response: string | null, error?: Error): void {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    if (error) {
      ;(cb as Function)(error, '', '')
    } else {
      ;(cb as Function)(null, response, '')
    }
    return {} as any
  })
}

describe('checkAuthStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all checks passing when valid token exists', async () => {
    const future = Date.now() + 3600_000
    const keychainData = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'test-token',
        expiresAt: String(future)
      }
    })
    mockKeychainResponse(keychainData)

    const status = await checkAuthStatus()
    expect(status.tokenFound).toBe(true)
    expect(status.tokenExpired).toBe(false)
  })

  it('returns tokenExpired when expiresAt is in the past', async () => {
    const past = Date.now() - 3600_000
    const keychainData = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'test-token',
        expiresAt: String(past)
      }
    })
    mockKeychainResponse(keychainData)

    const status = await checkAuthStatus()
    expect(status.tokenFound).toBe(true)
    expect(status.tokenExpired).toBe(true)
  })

  it('returns tokenFound false when keychain has no entry', async () => {
    mockKeychainResponse(null, new Error('security: SecKeychainSearchCopyNext'))

    const status = await checkAuthStatus()
    expect(status.tokenFound).toBe(false)
  })
})

describe('ensureSubscriptionAuth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when no token found', async () => {
    mockKeychainResponse(null, new Error('not found'))
    await expect(ensureSubscriptionAuth()).rejects.toThrow('claude login')
  })

  it('clears ANTHROPIC_API_KEY from env', async () => {
    process.env.ANTHROPIC_API_KEY = 'should-be-cleared'
    const future = Date.now() + 3600_000
    mockKeychainResponse(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'tok', expiresAt: String(future) }
      })
    )

    await ensureSubscriptionAuth()
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/auth-guard.test.ts`
Expected: FAIL — module `./auth-guard` not found

- [ ] **Step 3: Implement `auth-guard.ts`**

```typescript
// src/main/auth-guard.ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execFileAsync = promisify(execFile)

const CLI_SEARCH_PATHS = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  `${process.env.HOME}/.local/bin/claude`
]

export interface AuthStatus {
  cliFound: boolean
  tokenFound: boolean
  tokenExpired: boolean
  expiresAt?: Date
}

export async function checkAuthStatus(): Promise<AuthStatus> {
  const cliFound = detectClaudeCli()
  const tokenResult = await readKeychainToken()

  if (!tokenResult) {
    return { cliFound, tokenFound: false, tokenExpired: false }
  }

  const expiresAt = new Date(parseInt(tokenResult.expiresAt, 10))
  const tokenExpired = Date.now() >= expiresAt.getTime()

  return { cliFound, tokenFound: true, tokenExpired, expiresAt }
}

export async function ensureSubscriptionAuth(): Promise<void> {
  const token = await readKeychainToken()
  if (!token) {
    throw new Error('No Claude subscription token found — run: claude login')
  }

  const expiry = new Date(parseInt(token.expiresAt, 10))
  if (Date.now() >= expiry.getTime()) {
    throw new Error('Claude subscription token expired — run: claude login')
  }

  // Force subscription billing
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
}

function detectClaudeCli(): boolean {
  return CLI_SEARCH_PATHS.some((p) => existsSync(p))
}

interface OAuthToken {
  accessToken: string
  expiresAt: string
}

async function readKeychainToken(): Promise<OAuthToken | null> {
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf-8' }
    )
    const parsed = JSON.parse(stdout.trim())
    const oauth = parsed?.claudeAiOauth
    if (!oauth?.accessToken) return null
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/auth-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/auth-guard.ts src/main/auth-guard.test.ts
git commit -m "feat: add AuthGuard module for Keychain token validation"
```

---

## Task 2: Watchdog Module

**Files:**

- Create: `src/main/agent-manager/watchdog.ts`
- Test: `src/main/agent-manager/watchdog.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent-manager/watchdog.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchdog } from './watchdog'

describe('Watchdog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('calls onTimeout after maxRuntimeMs', () => {
    const onTimeout = vi.fn()
    const wd = new Watchdog({ maxRuntimeMs: 60_000, idleMs: 15_000, onTimeout })
    wd.start()

    vi.advanceTimersByTime(60_000)
    expect(onTimeout).toHaveBeenCalledWith('max_runtime')
  })

  it('calls onTimeout after idleMs with no activity', () => {
    const onTimeout = vi.fn()
    const wd = new Watchdog({ maxRuntimeMs: 3_600_000, idleMs: 15_000, onTimeout })
    wd.start()

    vi.advanceTimersByTime(15_000)
    expect(onTimeout).toHaveBeenCalledWith('idle')
  })

  it('resets idle timer on ping()', () => {
    const onTimeout = vi.fn()
    const wd = new Watchdog({ maxRuntimeMs: 3_600_000, idleMs: 15_000, onTimeout })
    wd.start()

    vi.advanceTimersByTime(14_000)
    wd.ping()
    vi.advanceTimersByTime(14_000)
    expect(onTimeout).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(onTimeout).toHaveBeenCalledWith('idle')
  })

  it('does not fire after stop()', () => {
    const onTimeout = vi.fn()
    const wd = new Watchdog({ maxRuntimeMs: 10_000, idleMs: 5_000, onTimeout })
    wd.start()
    wd.stop()

    vi.advanceTimersByTime(60_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/watchdog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `watchdog.ts`**

```typescript
// src/main/agent-manager/watchdog.ts

export type TimeoutReason = 'max_runtime' | 'idle'

export interface WatchdogOptions {
  maxRuntimeMs: number
  idleMs: number
  onTimeout: (reason: TimeoutReason) => void
}

export class Watchdog {
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly opts: WatchdogOptions

  constructor(opts: WatchdogOptions) {
    this.opts = opts
  }

  start(): void {
    this.maxTimer = setTimeout(() => this.opts.onTimeout('max_runtime'), this.opts.maxRuntimeMs)
    this.resetIdle()
  }

  ping(): void {
    this.resetIdle()
  }

  stop(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.maxTimer = null
    this.idleTimer = null
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.opts.onTimeout('idle'), this.opts.idleMs)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/watchdog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/watchdog.ts src/main/agent-manager/watchdog.test.ts
git commit -m "feat: add Watchdog module for agent timeout detection"
```

---

## Task 3: WorktreeOps Module

**Files:**

- Create: `src/main/agent-manager/worktree-ops.ts`
- Test: `src/main/agent-manager/worktree-ops.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent-manager/worktree-ops.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorktree, removeWorktree, acquireRepoLock, releaseRepoLock } from './worktree-ops'
import { execFile } from 'child_process'
import { mkdir, writeFile, unlink, access } from 'fs/promises'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error('ENOENT'))
}))

const mockExecFile = vi.mocked(execFile)

function mockExecSuccess(stdout = ''): void {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    ;(cb as Function)(null, stdout, '')
    return {} as any
  })
}

describe('createWorktree', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates worktree with correct branch name', async () => {
    mockExecSuccess()
    const result = await createWorktree('/repo', 'task-123', '/tmp/wt')

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'add']),
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
    expect(result.branch).toMatch(/^agent\//)
    expect(result.worktreePath).toBe('/tmp/wt/task-123')
  })
})

describe('removeWorktree', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes worktree and prunes', async () => {
    mockExecSuccess()
    await removeWorktree('/repo', '/tmp/wt/task-123')

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', '/tmp/wt/task-123'],
      expect.any(Object),
      expect.any(Function)
    )
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['worktree', 'prune'],
      expect.any(Object),
      expect.any(Function)
    )
  })
})

describe('repo locking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('acquires lock by writing lock file', async () => {
    await acquireRepoLock('/repo', '/tmp/wt')
    expect(vi.mocked(writeFile)).toHaveBeenCalled()
  })

  it('releases lock by deleting lock file', async () => {
    await releaseRepoLock('/repo', '/tmp/wt')
    expect(vi.mocked(unlink)).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/worktree-ops.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `worktree-ops.ts`**

```typescript
// src/main/agent-manager/worktree-ops.ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, unlink, access } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'

const execFileAsync = promisify(execFile)

export interface WorktreeResult {
  worktreePath: string
  branch: string
}

export async function createWorktree(
  repoPath: string,
  taskId: string,
  worktreeBase: string,
  baseBranch?: string
): Promise<WorktreeResult> {
  const worktreePath = join(worktreeBase, taskId)
  const branch = `agent/${taskId}`

  await mkdir(worktreeBase, { recursive: true })

  // Fetch latest from remote
  try {
    await execFileAsync('git', ['fetch', 'origin'], { cwd: repoPath })
  } catch {
    // Offline — proceed with local state
  }

  const base = baseBranch ?? (await getDefaultBranch(repoPath))

  await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, base], {
    cwd: repoPath
  })

  return { worktreePath, branch }
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath })
  } catch {
    // Worktree may already be gone
  }
  await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
}

export async function getActualBranch(worktreePath: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
  return stdout.trim()
}

// --- File-based repo locking ---

function lockPath(repoPath: string, worktreeBase: string): string {
  const hash = createHash('md5').update(repoPath).digest('hex').slice(0, 8)
  return join(worktreeBase, `.lock-${hash}`)
}

export async function acquireRepoLock(repoPath: string, worktreeBase: string): Promise<void> {
  const path = lockPath(repoPath, worktreeBase)
  await mkdir(worktreeBase, { recursive: true })

  // Spin-wait with a timeout
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      // Lock exists — wait
      await new Promise((r) => setTimeout(r, 500))
    } catch {
      // Lock doesn't exist — acquire
      await writeFile(path, String(process.pid))
      return
    }
  }
  throw new Error(`Timed out waiting for repo lock on ${repoPath}`)
}

export async function releaseRepoLock(repoPath: string, worktreeBase: string): Promise<void> {
  try {
    await unlink(lockPath(repoPath, worktreeBase))
  } catch {
    // Already released
  }
}

async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd: repoPath, encoding: 'utf-8' }
    )
    return stdout.trim() // e.g. "origin/main"
  } catch {
    return 'main'
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/worktree-ops.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree-ops.ts src/main/agent-manager/worktree-ops.test.ts
git commit -m "feat: add WorktreeOps module for git worktree management"
```

---

## Task 4: Completion Handler Module

**Files:**

- Create: `src/main/agent-manager/completion-handler.ts`
- Test: `src/main/agent-manager/completion-handler.test.ts`
- Reference: `src/main/git.ts` (existing git operations), `src/shared/types.ts` (SprintTask type)

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent-manager/completion-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleAgentCompletion, type CompletionContext } from './completion-handler'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('./worktree-ops', () => ({
  getActualBranch: vi.fn().mockResolvedValue('agent/task-123'),
  removeWorktree: vi.fn().mockResolvedValue(undefined)
}))

const mockExecFile = vi.mocked(await import('child_process')).execFile

function mockExecSuccess(stdout = ''): void {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    ;(cb as Function)(null, stdout, '')
    return {} as any
  })
}

const baseContext: CompletionContext = {
  taskId: 'task-123',
  agentId: 'agent-abc',
  repoPath: '/repo',
  worktreePath: '/tmp/wt/task-123',
  ghRepo: 'owner/repo',
  exitCode: 0,
  worktreeBase: '/tmp/wt',
  updateTask: vi.fn().mockResolvedValue(undefined)
}

describe('handleAgentCompletion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pushes branch and opens PR on success (exitCode 0)', async () => {
    // Mock gh pr create returning PR URL
    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      if (Array.isArray(args) && args[0] === 'push') {
        ;(cb as Function)(null, '', '')
      } else if (Array.isArray(args) && args[0] === 'pr') {
        ;(cb as Function)(null, 'https://github.com/owner/repo/pull/42\n', '')
      } else {
        ;(cb as Function)(null, '', '')
      }
      return {} as any
    })

    await handleAgentCompletion(baseContext)

    expect(baseContext.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        pr_url: 'https://github.com/owner/repo/pull/42'
      })
    )
  })

  it('requeues task on failure when under max retries', async () => {
    mockExecSuccess()
    const ctx = { ...baseContext, exitCode: 1, retryCount: 1 }

    await handleAgentCompletion(ctx)

    expect(ctx.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued'
      })
    )
  })

  it('sets error status when max retries exceeded', async () => {
    mockExecSuccess()
    const ctx = { ...baseContext, exitCode: 1, retryCount: 3 }

    await handleAgentCompletion(ctx)

    expect(ctx.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error'
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/completion-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `completion-handler.ts`**

```typescript
// src/main/agent-manager/completion-handler.ts
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getActualBranch, removeWorktree } from './worktree-ops'

const execFileAsync = promisify(execFile)

const MAX_RETRIES = 3
const FAST_FAIL_THRESHOLD_MS = 30_000
const MAX_FAST_FAILS = 3

export interface CompletionContext {
  taskId: string
  agentId: string
  repoPath: string
  worktreePath: string
  ghRepo: string
  exitCode: number
  worktreeBase: string
  retryCount?: number
  fastFailCount?: number
  durationMs?: number
  updateTask: (update: Record<string, unknown>) => Promise<void>
}

export async function handleAgentCompletion(ctx: CompletionContext): Promise<void> {
  try {
    if (ctx.exitCode === 0) {
      await handleSuccess(ctx)
    } else {
      await handleFailure(ctx)
    }
  } finally {
    await removeWorktree(ctx.repoPath, ctx.worktreePath).catch((err) => {
      console.error(`[completion] Failed to remove worktree ${ctx.worktreePath}:`, err)
    })
  }
}

async function handleSuccess(ctx: CompletionContext): Promise<void> {
  const branch = await getActualBranch(ctx.worktreePath)

  // Push branch to remote
  await execFileAsync('git', ['push', '-u', 'origin', branch], {
    cwd: ctx.worktreePath
  })

  // Open PR via gh CLI
  const prUrl = await openPullRequest(ctx.worktreePath, ctx.ghRepo, branch, ctx.taskId)
  const prNumber = prUrl ? parseInt(prUrl.split('/').pop() ?? '0', 10) : null

  await ctx.updateTask({
    status: 'done',
    pr_url: prUrl,
    pr_number: prNumber,
    pr_status: 'open',
    completed_at: new Date().toISOString()
  })
}

async function handleFailure(ctx: CompletionContext): Promise<void> {
  const retryCount = (ctx.retryCount ?? 0) + 1
  const isFastFail = (ctx.durationMs ?? Infinity) < FAST_FAIL_THRESHOLD_MS
  const fastFailCount = isFastFail ? (ctx.fastFailCount ?? 0) + 1 : 0

  if (fastFailCount >= MAX_FAST_FAILS) {
    await ctx.updateTask({
      status: 'error',
      retry_count: retryCount,
      fast_fail_count: fastFailCount,
      notes: `${MAX_FAST_FAILS} consecutive fast-fails — task spec may be invalid`
    })
    return
  }

  if (retryCount >= MAX_RETRIES) {
    await ctx.updateTask({
      status: 'error',
      retry_count: retryCount,
      fast_fail_count: fastFailCount
    })
    return
  }

  // Requeue for retry
  await ctx.updateTask({
    status: 'queued',
    retry_count: retryCount,
    fast_fail_count: fastFailCount,
    claimed_by: null,
    agent_run_id: null
  })
}

async function openPullRequest(
  cwd: string,
  ghRepo: string,
  branch: string,
  taskId: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--repo', ghRepo, '--head', branch, '--fill'],
      { cwd, encoding: 'utf-8' }
    )
    return stdout.trim()
  } catch (err) {
    console.error(`[completion] Failed to create PR for task ${taskId}:`, err)
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/completion-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion-handler.ts src/main/agent-manager/completion-handler.test.ts
git commit -m "feat: add CompletionHandler for post-agent branch push and PR"
```

---

## Task 5: AgentManager Core Module

**Files:**

- Create: `src/main/agent-manager/agent-manager.ts`
- Create: `src/main/agent-manager/index.ts`
- Test: `src/main/agent-manager/agent-manager.test.ts`
- Reference: `src/main/agents/sdk-provider.ts`, `src/main/agents/event-bus.ts`, `src/main/auth-guard.ts`, `src/shared/types.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent-manager/agent-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentManager, type AgentManagerDeps } from './agent-manager'

function createMockDeps(): AgentManagerDeps {
  return {
    getQueuedTasks: vi.fn().mockResolvedValue([]),
    updateTask: vi.fn().mockResolvedValue(undefined),
    ensureAuth: vi.fn().mockResolvedValue(undefined),
    spawnAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      events: (async function* () {
        yield { type: 'agent:started', model: 'sonnet', timestamp: Date.now() }
        yield {
          type: 'agent:completed',
          exitCode: 0,
          costUsd: 0.01,
          tokensIn: 100,
          tokensOut: 50,
          durationMs: 5000,
          timestamp: Date.now()
        }
      })(),
      steer: vi.fn(),
      stop: vi.fn()
    }),
    createWorktree: vi.fn().mockResolvedValue({ worktreePath: '/tmp/wt/t1', branch: 'agent/t1' }),
    handleCompletion: vi.fn().mockResolvedValue(undefined),
    emitEvent: vi.fn(),
    getRepoInfo: vi.fn().mockReturnValue({ repoPath: '/repo', ghRepo: 'owner/repo' }),
    config: {
      maxConcurrent: 3,
      worktreeBase: '/tmp/wt',
      maxRuntimeMs: 3_600_000,
      idleMs: 900_000,
      drainIntervalMs: 5_000
    }
  }
}

describe('AgentManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drains a queued task when started', async () => {
    const deps = createMockDeps()
    const task = {
      id: 't1',
      title: 'Fix bug',
      repo: 'BDE',
      prompt: 'fix it',
      priority: 1,
      status: 'queued' as const,
      retry_count: 0,
      fast_fail_count: 0
    }
    vi.mocked(deps.getQueuedTasks).mockResolvedValueOnce([task])

    const manager = new AgentManager(deps)
    manager.start()

    // Trigger first drain
    await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

    expect(deps.ensureAuth).toHaveBeenCalled()
    expect(deps.createWorktree).toHaveBeenCalled()
    expect(deps.spawnAgent).toHaveBeenCalled()

    manager.stop()
  })

  it('respects concurrency limit', async () => {
    const deps = createMockDeps()
    deps.config.maxConcurrent = 1

    // Mock agent that never completes
    vi.mocked(deps.spawnAgent).mockResolvedValue({
      id: 'agent-1',
      events: (async function* () {
        yield { type: 'agent:started', model: 'sonnet', timestamp: Date.now() }
        await new Promise(() => {})
      })(),
      steer: vi.fn(),
      stop: vi.fn()
    })

    const tasks = [
      {
        id: 't1',
        title: 'A',
        repo: 'BDE',
        prompt: 'a',
        priority: 1,
        status: 'queued' as const,
        retry_count: 0,
        fast_fail_count: 0
      },
      {
        id: 't2',
        title: 'B',
        repo: 'BDE',
        prompt: 'b',
        priority: 2,
        status: 'queued' as const,
        retry_count: 0,
        fast_fail_count: 0
      }
    ]
    vi.mocked(deps.getQueuedTasks).mockResolvedValue(tasks)

    const manager = new AgentManager(deps)
    manager.start()
    await vi.advanceTimersByTimeAsync(deps.config.drainIntervalMs)

    // Should only spawn one (max concurrent = 1)
    expect(deps.spawnAgent).toHaveBeenCalledTimes(1)

    manager.stop()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/agent-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `agent-manager.ts`**

```typescript
// src/main/agent-manager/agent-manager.ts
import { Watchdog } from './watchdog'
import type { AgentHandle } from '../agents/types'

export interface AgentManagerConfig {
  maxConcurrent: number
  worktreeBase: string
  maxRuntimeMs: number
  idleMs: number
  drainIntervalMs: number
}

interface QueuedTask {
  id: string
  title: string
  repo: string
  prompt: string | null
  priority: number
  status: string
  retry_count: number
  fast_fail_count: number
  template_name?: string | null
  spec?: string | null
}

export interface AgentManagerDeps {
  getQueuedTasks: () => Promise<QueuedTask[]>
  updateTask: (taskId: string, update: Record<string, unknown>) => Promise<void>
  ensureAuth: () => Promise<void>
  spawnAgent: (opts: { prompt: string; cwd: string; model?: string }) => Promise<AgentHandle>
  createWorktree: (
    repoPath: string,
    taskId: string,
    worktreeBase: string
  ) => Promise<{ worktreePath: string; branch: string }>
  handleCompletion: (ctx: Record<string, unknown>) => Promise<void>
  emitEvent: (agentId: string, event: unknown) => void
  getRepoInfo: (repoName: string) => { repoPath: string; ghRepo: string } | null
  config: AgentManagerConfig
}

interface ActiveAgent {
  taskId: string
  agentId: string
  worktreePath: string
  repoPath: string
  ghRepo: string
  watchdog: Watchdog
  startTime: number
  handle: AgentHandle
}

export class AgentManager {
  private readonly deps: AgentManagerDeps
  private readonly active = new Map<string, ActiveAgent>()
  private drainTimer: ReturnType<typeof setInterval> | null = null
  private draining = false

  constructor(deps: AgentManagerDeps) {
    this.deps = deps
  }

  start(): void {
    this.drainTimer = setInterval(() => this.drain(), this.deps.config.drainIntervalMs)
  }

  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer)
      this.drainTimer = null
    }
    for (const agent of this.active.values()) {
      agent.watchdog.stop()
      agent.handle.stop().catch(() => {})
    }
    this.active.clear()
  }

  get activeCount(): number {
    return this.active.size
  }

  get availableSlots(): number {
    return this.deps.config.maxConcurrent - this.active.size
  }

  async killAgent(taskId: string): Promise<boolean> {
    const agent = this.active.get(taskId)
    if (!agent) return false
    agent.watchdog.stop()
    await agent.handle.stop()
    return true
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      const slots = this.availableSlots
      if (slots <= 0) return

      const tasks = await this.deps.getQueuedTasks()
      const toRun = tasks.slice(0, slots)

      for (const task of toRun) {
        await this.runTask(task).catch((err) => {
          console.error(`[agent-manager] Failed to start task ${task.id}:`, err)
        })
      }
    } finally {
      this.draining = false
    }
  }

  private async runTask(task: QueuedTask): Promise<void> {
    // Validate auth before spawning
    await this.deps.ensureAuth()

    const repoInfo = this.deps.getRepoInfo(task.repo)
    if (!repoInfo) {
      await this.deps.updateTask(task.id, {
        status: 'error',
        notes: `Repo "${task.repo}" not found in settings`
      })
      return
    }

    // Mark active
    await this.deps.updateTask(task.id, {
      status: 'active',
      started_at: new Date().toISOString()
    })

    // Create worktree
    const { worktreePath, branch } = await this.deps.createWorktree(
      repoInfo.repoPath,
      task.id,
      this.deps.config.worktreeBase
    )

    // Build prompt
    const prompt = buildPrompt(task)

    // Spawn agent
    const handle = await this.deps.spawnAgent({ prompt, cwd: worktreePath })

    // Set up watchdog
    const watchdog = new Watchdog({
      maxRuntimeMs: this.deps.config.maxRuntimeMs,
      idleMs: this.deps.config.idleMs,
      onTimeout: (reason) => {
        console.warn(`[agent-manager] Watchdog timeout (${reason}) for task ${task.id}`)
        handle.stop().catch(() => {})
      }
    })

    const activeAgent: ActiveAgent = {
      taskId: task.id,
      agentId: handle.id,
      worktreePath,
      repoPath: repoInfo.repoPath,
      ghRepo: repoInfo.ghRepo,
      watchdog,
      startTime: Date.now(),
      handle
    }

    this.active.set(task.id, activeAgent)
    watchdog.start()

    // Update task with agent run ID
    await this.deps.updateTask(task.id, { agent_run_id: handle.id })

    // Consume events in background
    this.consumeEvents(activeAgent, task).catch((err) => {
      console.error(`[agent-manager] Event consumption failed for task ${task.id}:`, err)
    })
  }

  private async consumeEvents(agent: ActiveAgent, task: QueuedTask): Promise<void> {
    let exitCode = 1
    let durationMs = 0

    try {
      for await (const event of agent.handle.events) {
        const e = event as Record<string, unknown>
        agent.watchdog.ping()
        this.deps.emitEvent(agent.agentId, event)

        if (e.type === 'agent:completed') {
          exitCode = (e.exitCode as number) ?? 1
          durationMs = (e.durationMs as number) ?? Date.now() - agent.startTime
          break
        }
      }
    } catch (err) {
      console.error(`[agent-manager] Stream error for task ${agent.taskId}:`, err)
    } finally {
      agent.watchdog.stop()
      this.active.delete(agent.taskId)

      await this.deps.handleCompletion({
        taskId: agent.taskId,
        agentId: agent.agentId,
        repoPath: agent.repoPath,
        worktreePath: agent.worktreePath,
        ghRepo: agent.ghRepo,
        exitCode,
        durationMs,
        retryCount: task.retry_count,
        fastFailCount: task.fast_fail_count,
        worktreeBase: this.deps.config.worktreeBase
      })
    }
  }
}

function buildPrompt(task: QueuedTask): string {
  const parts: string[] = []
  if (task.spec) parts.push(task.spec)
  if (task.prompt) parts.push(task.prompt)
  if (parts.length === 0) parts.push(task.title)
  return parts.join('\n\n')
}
```

- [ ] **Step 4: Create `index.ts` re-export**

```typescript
// src/main/agent-manager/index.ts
export { AgentManager, type AgentManagerConfig, type AgentManagerDeps } from './agent-manager'
export { Watchdog } from './watchdog'
export {
  createWorktree,
  removeWorktree,
  getActualBranch,
  acquireRepoLock,
  releaseRepoLock
} from './worktree-ops'
export { handleAgentCompletion, type CompletionContext } from './completion-handler'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/agent-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Run all agent-manager tests together**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npx vitest run src/main/agent-manager/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/agent-manager/
git commit -m "feat: add AgentManager core module with drain loop and concurrency"
```

---

## Task 6: Remove External Service Dependencies (Main Process)

**Files:**

- Delete: `src/main/queue-api/` (all files)
- Delete: `src/main/handlers/queue-handlers.ts`
- Delete: `src/main/handlers/gateway-handlers.ts`
- Delete: `src/main/sprint-sse.ts`
- Delete: `src/main/agents/cli-provider.ts`
- Delete: `src/main/__tests__/sprint-sse.test.ts` (imports deleted module)
- Delete: `src/main/__tests__/queue-router-output.test.ts` (imports deleted module, if exists)
- Delete: `src/main/__tests__/event-store.test.ts` (imports deleted module, if exists)
- Modify: `src/main/config.ts` — remove `getGatewayConfig()`, `getTaskRunnerConfig()`, `getAgentProvider()`
- Modify: `src/main/agents/index.ts` — remove provider factory
- Modify: `src/main/local-agents.ts` — remove `steerViaTaskRunner()`, remove `getTaskRunnerConfig` import
- Modify: `src/main/settings.ts` — remove `migrateFromOpenClawConfig()`
- Modify: `src/main/index.ts` — remove all deleted imports and startup calls, rewrite CSP
- Modify: `src/main/db.ts` — add migration for `fast_fail_count` column

- [ ] **Step 1: Delete files (including associated test files)**

```bash
rm -rf src/main/queue-api/
rm src/main/handlers/queue-handlers.ts
rm src/main/handlers/gateway-handlers.ts
rm src/main/sprint-sse.ts
rm src/main/agents/cli-provider.ts
# Delete associated test files (use -f to ignore if they don't exist)
rm -f src/main/__tests__/sprint-sse.test.ts
rm -f src/main/__tests__/queue-router-output.test.ts
rm -f src/main/__tests__/event-store.test.ts
```

- [ ] **Step 2: Clean up `src/main/config.ts`**

Remove `getGatewayConfig()`, `getTaskRunnerConfig()`, `getAgentProvider()`, and their associated interfaces (`GatewayConfig`, `TaskRunnerConfig`). Keep `getGitHubToken()`, `getEventRetentionDays()`, `getSupabaseConfig()`.

- [ ] **Step 3: Simplify `src/main/agents/index.ts`**

Replace the provider factory with direct `SdkProvider` export:

```typescript
export type {
  AgentProvider,
  AgentHandle,
  AgentEvent,
  AgentSpawnOptions,
  AgentEventType
} from './types'
export { SdkProvider } from './sdk-provider'
```

- [ ] **Step 4: Clean up `src/main/local-agents.ts`**

- Remove `import { getTaskRunnerConfig } from './config'`
- Remove `import { createAgentProvider } from './agents'` — replace with `import { SdkProvider } from './agents'`
- Remove `steerViaTaskRunner()` function (lines 274-299)
- Update `steerAgent()` to return error when agent not found locally (no task-runner fallback)
- Update `spawnClaudeAgent()` to use `new SdkProvider()` directly

- [ ] **Step 5: Clean up `src/main/settings.ts`**

Remove `migrateFromOpenClawConfig()` function and its `OPENCLAW_CONFIG_PATH` import. It references gateway/task-runner settings that no longer exist.

- [ ] **Step 6: Rewrite `src/main/index.ts`**

Remove these imports and their startup/shutdown calls:

- `startSprintSseClient` / `stopSprintSseClient` (lines 20, 122-123)
- `startQueueApi` / `stopQueueApi` (lines 24, 131-132)
- `registerGatewayHandlers` (lines 11, 144)
- `registerQueueHandlers` (lines 15, 148)
- `getGatewayConfig` (lines 23, 186)
- `migrateFromOpenClawConfig` (lines 19, 117)

Rewrite `buildConnectSrc()` to a simple static string (no gateway config):

```typescript
function buildConnectSrc(): string {
  return 'https://api.github.com'
}
```

Add AgentManager and AuthGuard startup (to be wired in Task 8).

- [ ] **Step 7: Add DB migration for `fast_fail_count` column**

Add a new migration entry to the `migrations` array in `src/main/db.ts`:

```sql
ALTER TABLE sprint_tasks ADD COLUMN fast_fail_count INTEGER DEFAULT 0;
```

This column is used by the CompletionHandler's fast-fail detection logic. Check if `completed_at` column already exists — if not, add it too.

- [ ] **Step 8: Run typecheck**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck`
Expected: PASS — no compile errors from deleted code

- [ ] **Step 9: Run existing tests**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm test`
Expected: PASS — all test files that imported deleted modules have been removed

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: remove external service dependencies (queue-api, gateway, sprint-sse, cli-provider)"
```

---

## Task 7: Remove External Service Dependencies (Renderer)

**IMPORTANT:** This task has a large surface area. Many renderer files depend on `gateway.ts`, `sessions.ts`, `taskRunnerSSE.ts`, and `sprintEvents.ts` queue-health calls. Read each file before modifying. The goal is a compilable state after every step — do not delete files before updating their consumers.

**Files to delete:**

- `src/renderer/src/lib/gateway.ts`
- `src/renderer/src/lib/taskRunnerSSE.ts`
- `src/renderer/src/lib/rpc.ts` (verify it's solely gateway-dependent first)
- `src/renderer/src/lib/message.ts` (verify it's solely gateway-dependent first)
- `src/renderer/src/stores/gateway.ts`
- `src/renderer/src/stores/sessions.ts`
- `src/renderer/src/lib/__tests__/gateway.test.ts`
- `src/renderer/src/stores/__tests__/gateway.test.ts`
- `src/renderer/src/stores/__tests__/sessions.test.ts`

**Files to modify (read each carefully first):**

- `src/renderer/src/App.tsx` — remove `useGatewayStore`, remove `useSessionsStore` (runningCount), remove gateway init
- `src/renderer/src/components/layout/StatusBar.tsx` — remove `GatewayStatus` type import, replace with auth status
- `src/renderer/src/components/layout/ActivityBar.tsx` — remove gateway connection status references
- `src/renderer/src/stores/unifiedAgents.ts` — remove `useSessionsStore` dependency; this store merges local + gateway agents — after removing gateway, it only needs local agents
- `src/renderer/src/hooks/useSprintPolling.ts` — remove `subscribeSSE` import, remove `fetchQueueHealth` call
- `src/renderer/src/hooks/useTaskNotifications.ts` — remove `subscribeSSE` import, remove `useSessionsStore`
- `src/renderer/src/stores/sprintEvents.ts` — remove `fetchQueueHealth` and `queueHealth` state (the `queue:health` handler is deleted)
- `src/renderer/src/components/sprint/QueueDashboard.tsx` — remove or replace `QueueHealth` type usage (was from sprintEvents)
- `src/renderer/src/components/sprint/LogDrawer.tsx` — remove `subscribeSSE` imports, use event bus IPC only
- `src/renderer/src/components/sprint/NewTicketModal.tsx` — remove "Ask Paul" `invokeTool('sessions_send')` call (gateway is gone). Either remove the button or wire to local agent via AgentManager IPC.
- `src/renderer/src/components/sprint/SpecDrawer.tsx` — same as above: remove gateway `invokeTool` call
- `src/renderer/src/components/sprint/DesignModeContent.tsx` — same as above: remove gateway `invokeTool` call
- `src/renderer/src/components/settings/ConnectionsSection.tsx` — remove gateway + task runner config sections
- `src/preload/index.ts` — remove gateway APIs, remove `onSprintSseEvent`, remove `invokeTool`
- `src/shared/ipc-channels.ts` — remove gateway/queue channel types

- [ ] **Step 1: Update consumers BEFORE deleting source files**

Read and update every file listed above. Key changes:

**`unifiedAgents.ts`**: Remove `useSessionsStore` dependency. After removing gateway, this store only aggregates local agents. Remove the `fetchSessions()` calls and gateway-session merging logic. If the store becomes trivially thin, consider inlining into the local agents store.

**`App.tsx`**: Remove `useGatewayStore` import + init. Remove `useSessionsStore` import. Replace `runningCount` (from sessions) with `activeCount` from AgentManager IPC (or just remove it — Task 9 wires the onboarding gate). Remove `status` prop passed to `StatusBar`/`ActivityBar` that comes from gateway store.

**`StatusBar.tsx`**: Remove `import type { GatewayStatus }` from deleted `gateway.ts`. Replace the gateway connection indicator with a simple auth status indicator (can be a placeholder "Connected" badge — Task 10 wires the real auth status).

**`ActivityBar.tsx`**: Remove gateway connection status dot/indicator. Replace with auth status indicator or remove entirely.

**`sprintEvents.ts`**: Remove `fetchQueueHealth` action and `queueHealth` state. The `connectedRunners` concept is replaced by AgentManager's `activeCount`. Replace `QueueHealth` type with a simpler `AgentManagerStatus` type if needed by `QueueDashboard.tsx`, or inline.

**`NewTicketModal.tsx`, `SpecDrawer.tsx`, `DesignModeContent.tsx`**: Remove or disable the "Ask Paul" button / `invokeTool('sessions_send')` call. The gateway is gone. For now, remove the button and its handler. If local agent-powered spec generation is desired, that's a future feature.

**Hooks**: `useSprintPolling.ts` — remove `subscribeSSE` and `fetchQueueHealth`. `useTaskNotifications.ts` — remove `subscribeSSE` and `useSessionsStore`.

- [ ] **Step 2: Clean up `preload/index.ts`**

Remove: `getGatewayUrl`, `saveGatewayConfig`, `testGatewayConnection`, `signGatewayChallenge`, `onSprintSseEvent`, `invokeTool` (if solely gateway-backed).

- [ ] **Step 3: Clean up `src/shared/ipc-channels.ts`**

Remove gateway and queue-related channel type definitions (`gateway:invoke`, `gateway:test-connection`, `gateway:sign-challenge`, `gateway:getSessionHistory`, `queue:health`, `task:getEvents`).

- [ ] **Step 4: Delete source files**

Now that all consumers are updated, delete the source files:

```bash
rm src/renderer/src/lib/gateway.ts
rm src/renderer/src/lib/taskRunnerSSE.ts
rm src/renderer/src/stores/gateway.ts
rm src/renderer/src/stores/sessions.ts
rm -f src/renderer/src/lib/rpc.ts
rm -f src/renderer/src/lib/message.ts
rm -f src/renderer/src/lib/__tests__/gateway.test.ts
rm -f src/renderer/src/stores/__tests__/gateway.test.ts
rm -f src/renderer/src/stores/__tests__/sessions.test.ts
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck`
Expected: PASS — all imports resolved, no dead references

- [ ] **Step 6: Run tests**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm test`
Expected: PASS — some existing tests may need updating if they mock deleted modules

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove gateway, task runner SSE, sessions, and queue health from renderer"
```

---

## Task 8: Wire AgentManager + AuthGuard into BDE

**Files:**

- Create: `src/main/handlers/auth-handlers.ts`
- Create: `src/main/handlers/agent-manager-handlers.ts`
- Modify: `src/main/index.ts` — start AgentManager on app ready, register new handlers
- Modify: `src/preload/index.ts` — add auth and agent-manager IPC bridges
- Modify: `src/shared/ipc-channels.ts` — add new channel types
- Modify: `src/main/settings.ts` — add agent-manager config helpers

- [ ] **Step 1: Create `auth-handlers.ts`**

```typescript
// src/main/handlers/auth-handlers.ts
import { safeHandle } from '../ipc-utils'
import { checkAuthStatus } from '../auth-guard'

export function registerAuthHandlers(): void {
  safeHandle('auth:status', async () => {
    return checkAuthStatus()
  })
}
```

- [ ] **Step 2: Create `agent-manager-handlers.ts`**

```typescript
// src/main/handlers/agent-manager-handlers.ts
import { safeHandle } from '../ipc-utils'
import type { AgentManager } from '../agent-manager'

export function registerAgentManagerHandlers(manager: AgentManager): void {
  safeHandle('agent-manager:status', async () => {
    return {
      activeCount: manager.activeCount,
      availableSlots: manager.availableSlots
    }
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    return manager.killAgent(taskId)
  })
}
```

- [ ] **Step 3: Add settings helpers for agent-manager config**

Add to `src/main/settings.ts`:

```typescript
export const SETTING_MAX_CONCURRENT = 'agentManager.maxConcurrent'
export const SETTING_WORKTREE_BASE = 'agentManager.worktreeBase'
export const SETTING_MAX_RUNTIME_MINUTES = 'agentManager.maxRuntimeMinutes'

export function getMaxConcurrent(): number {
  return parseInt(getSetting(SETTING_MAX_CONCURRENT) ?? '3', 10)
}

export function getWorktreeBase(): string {
  return getSetting(SETTING_WORKTREE_BASE) ?? '/tmp/worktrees/bde'
}

export function getMaxRuntimeMinutes(): number {
  return parseInt(getSetting(SETTING_MAX_RUNTIME_MINUTES) ?? '60', 10)
}
```

- [ ] **Step 4: Wire into `src/main/index.ts`**

Add imports for `AgentManager`, `AuthGuard`, new handlers, and settings. In the `app.whenReady()` block:

```typescript
import { registerAuthHandlers } from './handlers/auth-handlers'
import { registerAgentManagerHandlers } from './handlers/agent-manager-handlers'
import { AgentManager } from './agent-manager'
import { ensureSubscriptionAuth } from './auth-guard'
import { createWorktree, handleAgentCompletion } from './agent-manager'
import { SdkProvider } from './agents'
import { getEventBus } from './agents/event-bus'
import { getMaxConcurrent, getWorktreeBase, getMaxRuntimeMinutes } from './settings'

// Inside app.whenReady():
const sdkProvider = new SdkProvider()
const eventBus = getEventBus()

const agentManager = new AgentManager({
  // ... wire deps from existing BDE modules
  config: {
    maxConcurrent: getMaxConcurrent(),
    worktreeBase: getWorktreeBase(),
    maxRuntimeMs: getMaxRuntimeMinutes() * 60_000,
    idleMs: 15 * 60_000,
    drainIntervalMs: 5_000
  }
})

agentManager.start()
app.on('will-quit', () => agentManager.stop())

registerAuthHandlers()
registerAgentManagerHandlers(agentManager)
```

- [ ] **Step 5: Add preload bridges**

Add to `src/preload/index.ts`:

```typescript
authStatus: () => typedInvoke('auth:status'),
agentManager: {
  status: () => typedInvoke('agent-manager:status'),
  kill: (taskId: string) => typedInvoke('agent-manager:kill', taskId),
},
```

- [ ] **Step 6: Update IPC channel types**

Add to `src/shared/ipc-channels.ts`:

```typescript
'auth:status': { args: []; result: { cliFound: boolean; tokenFound: boolean; tokenExpired: boolean; expiresAt?: string } }
'agent-manager:status': { args: []; result: { activeCount: number; availableSlots: number } }
'agent-manager:kill': { args: [taskId: string]; result: boolean }
```

- [ ] **Step 7: Run typecheck and tests**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: wire AgentManager and AuthGuard into BDE main process"
```

---

## Task 9: Onboarding UI Component

**Files:**

- Create: `src/renderer/src/components/Onboarding.tsx`
- Modify: `src/renderer/src/App.tsx` — gate main app behind onboarding check

- [ ] **Step 1: Create `Onboarding.tsx`**

A simple component that calls `window.api.authStatus()` and shows check results. Three status lines: CLI found, token found, token not expired. A "Check Again" button that re-runs the check. A "Skip" button that dismisses.

Uses existing BDE design tokens from `src/renderer/src/design-system/tokens.ts` and `lucide-react` icons (no new dependencies).

- [ ] **Step 2: Gate `App.tsx`**

Add state for auth status. On mount, call `window.api.authStatus()`. If all checks pass, render the main app. If any fail, render `<Onboarding />` with a callback that re-checks and transitions to the main app.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Onboarding.tsx src/renderer/src/App.tsx
git commit -m "feat: add onboarding screen with Claude auth status checks"
```

---

## Task 10: Update Settings View

**Files:**

- Modify: `src/renderer/src/components/settings/ConnectionsSection.tsx` — replace gateway/task-runner config with auth status + agent-manager settings

- [ ] **Step 1: Add auth status display**

Show current auth status (connected / expired / not configured) from `window.api.authStatus()`.

- [ ] **Step 2: Add agent-manager settings**

Settings inputs for:

- Max concurrent agents (number, default 3)
- Worktree base path (text, default `/tmp/worktrees/bde`)
- Max runtime minutes (number, default 60)

These read/write via `window.api.settings.set()` using the keys from `settings.ts`.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/ConnectionsSection.tsx
git commit -m "feat: update Settings view with auth status and agent-manager config"
```

---

## Task 11: Build & Package Verification

**Files:**

- Reference: `electron-builder.yml`, `package.json`

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm test`
Expected: All tests PASS

- [ ] **Step 3: Run production build**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run build`
Expected: Builds successfully to `out/`

- [ ] **Step 4: Build DMG**

Run: `cd /Users/RBTECHBOT/Documents/Repositories/BDE && npm run build:mac`
Expected: DMG produced in `release/` directory

- [ ] **Step 5: Smoke test the DMG**

Open the DMG, drag BDE to Applications, launch it. Verify:

- Onboarding screen appears (or main app if already authed)
- Settings view shows auth status
- Sprint view can queue a task
- An agent spawns in a worktree and runs to completion

- [ ] **Step 6: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix: address issues found during packaging smoke test"
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: BDE self-contained packaging complete"
```
