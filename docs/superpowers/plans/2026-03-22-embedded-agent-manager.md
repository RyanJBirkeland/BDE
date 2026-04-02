# Embedded Agent Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-process agent manager in BDE that spawns, monitors, and completes tasks locally — making BDE a standalone app that doesn't require the external task runner.

**Architecture:** New `src/main/agent-manager/` module with pure-logic entities (concurrency, watchdog, fast-fail), a git worktree adapter, an SDK adapter for agent spawning, a completion handler (push + PR), an orphan recovery loop, and a drain loop that wires everything together. Integrates with existing sprint-queries (Supabase), AuthGuard (Keychain), and IPC (renderer).

**Tech Stack:** TypeScript, Electron main process, `@anthropic-ai/claude-agent-sdk`, `execFile` for git/gh CLI

---

## File Structure

### New files
- `src/main/agent-manager/types.ts` — config, handle, state types
- `src/main/agent-manager/concurrency.ts` — ConcurrencyState entity (pure logic)
- `src/main/agent-manager/watchdog.ts` — idle/runtime/rate-limit monitoring
- `src/main/agent-manager/fast-fail.ts` — 30s exit detection
- `src/main/agent-manager/worktree.ts` — git worktree add/cleanup/prune/lock
- `src/main/agent-manager/sdk-adapter.ts` — spawns agents via Claude Agent SDK
- `src/main/agent-manager/completion.ts` — push branch, open PR, resolve exit
- `src/main/agent-manager/orphan-recovery.ts` — detect and recover stalled tasks
- `src/main/agent-manager/index.ts` — createAgentManager() factory + drain loop
- `src/main/agent-manager/__tests__/*.test.ts` — unit tests per module

### Modified files
- `src/main/data/sprint-queries.ts` — add `getQueuedTasks(limit)`, `getOrphanedTasks(claimedBy)` (note: `claimTask()` already exists)
- `src/main/index.ts` — wire AgentManager on startup
- `src/main/handlers/agent-handlers.ts` — replace throw with AgentManager delegation
- `src/main/handlers/agent-manager-handlers.ts` — already exists (21 lines, thin runner-client proxy) — replace with AgentManager calls
- `src/renderer/src/views/SettingsView.tsx` — add AgentManager settings section
- `package.json` — add `@anthropic-ai/claude-agent-sdk`

---

## Task 1: Types & Concurrency Entity

**Files:**
- Create: `src/main/agent-manager/types.ts`
- Create: `src/main/agent-manager/concurrency.ts`
- Create: `src/main/agent-manager/__tests__/concurrency.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// src/main/agent-manager/types.ts

export interface AgentManagerConfig {
  maxConcurrent: number       // default 2
  worktreeBase: string        // default /tmp/worktrees/bde
  maxRuntimeMs: number        // default 3_600_000 (60min)
  idleTimeoutMs: number       // default 900_000 (15min)
  pollIntervalMs: number      // default 30_000
  defaultModel: string        // default claude-sonnet-4-5
}

export const DEFAULT_CONFIG: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: '/tmp/worktrees/bde',
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 30_000,
  defaultModel: 'claude-sonnet-4-5',
}

export const EXECUTOR_ID = 'bde-embedded'
export const MAX_RETRIES = 3
export const MAX_FAST_FAILS = 3
export const FAST_FAIL_THRESHOLD_MS = 30_000
export const RATE_LIMIT_LOOP_THRESHOLD = 10
export const WATCHDOG_INTERVAL_MS = 10_000
export const SIGTERM_GRACE_MS = 5_000
export const RATE_LIMIT_COOLDOWN_MS = 60_000
export const ORPHAN_CHECK_INTERVAL_MS = 60_000
export const WORKTREE_PRUNE_INTERVAL_MS = 5 * 60 * 1000

export interface AgentHandle {
  messages: AsyncIterable<unknown>
  sessionId: string
  abort(): void
  steer(message: string): Promise<void>
}

export interface ActiveAgent {
  taskId: string
  agentRunId: string
  handle: AgentHandle
  model: string
  startedAt: number
  lastOutputAt: number
  rateLimitCount: number
  costUsd: number
  tokensIn: number
  tokensOut: number
}
```

- [ ] **Step 2: Write concurrency tests**

```typescript
// src/main/agent-manager/__tests__/concurrency.test.ts
import { describe, test, expect } from 'vitest'
import { makeConcurrencyState, availableSlots, applyBackpressure, tryRecover } from '../concurrency'

describe('concurrency', () => {
  test('availableSlots returns effective minus active', () => {
    const s = makeConcurrencyState(3)
    expect(availableSlots({ ...s, activeCount: 1 })).toBe(2)
  })

  test('applyBackpressure reduces slots', () => {
    const s = makeConcurrencyState(2)
    const next = applyBackpressure(s, 1000)
    expect(next.effectiveSlots).toBe(1)
    expect(next.atFloor).toBe(true)
  })

  test('at floor, backpressure does not reset recoveryDueAt', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 1000) // floor
    const rd = s.recoveryDueAt
    s = applyBackpressure(s, 2000) // at floor — no-op
    expect(s.recoveryDueAt).toBe(rd)
  })

  test('tryRecover increments after cooldown', () => {
    let s = makeConcurrencyState(2)
    s = applyBackpressure(s, 0)
    s = tryRecover(s, 60_001)
    expect(s.effectiveSlots).toBe(2)
    expect(s.atFloor).toBe(false)
  })
})
```

- [ ] **Step 3: Implement concurrency.ts**

```typescript
// src/main/agent-manager/concurrency.ts
import { RATE_LIMIT_COOLDOWN_MS } from './types'

export interface ConcurrencyState {
  maxSlots: number
  effectiveSlots: number
  activeCount: number
  recoveryDueAt: number | null
  consecutiveRateLimits: number
  atFloor: boolean
}

export function makeConcurrencyState(maxSlots: number): ConcurrencyState {
  return { maxSlots, effectiveSlots: maxSlots, activeCount: 0, recoveryDueAt: null, consecutiveRateLimits: 0, atFloor: false }
}

export function availableSlots(s: ConcurrencyState): number {
  return Math.max(0, s.effectiveSlots - s.activeCount)
}

export function applyBackpressure(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.atFloor) return { ...s, consecutiveRateLimits: s.consecutiveRateLimits + 1 }
  const newSlots = Math.max(1, s.effectiveSlots - 1)
  return {
    ...s, effectiveSlots: newSlots, recoveryDueAt: now + RATE_LIMIT_COOLDOWN_MS,
    consecutiveRateLimits: s.consecutiveRateLimits + 1, atFloor: newSlots <= 1,
  }
}

export function tryRecover(s: ConcurrencyState, now: number): ConcurrencyState {
  if (s.recoveryDueAt !== null && now >= s.recoveryDueAt && s.effectiveSlots < s.maxSlots) {
    const newSlots = Math.min(s.maxSlots, s.effectiveSlots + 1)
    return {
      ...s, effectiveSlots: newSlots,
      recoveryDueAt: newSlots < s.maxSlots ? now + RATE_LIMIT_COOLDOWN_MS : null,
      consecutiveRateLimits: 0, atFloor: false,
    }
  }
  return s
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/ryan/projects/BDE && npx vitest run src/main/agent-manager/__tests__/concurrency.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/types.ts src/main/agent-manager/concurrency.ts src/main/agent-manager/__tests__/concurrency.test.ts
git commit -m "feat(agent-manager): add types and concurrency entity"
```

---

## Task 2: Watchdog & Fast-Fail

**Files:**
- Create: `src/main/agent-manager/watchdog.ts`
- Create: `src/main/agent-manager/fast-fail.ts`
- Create: `src/main/agent-manager/__tests__/watchdog.test.ts`
- Create: `src/main/agent-manager/__tests__/fast-fail.test.ts`

- [ ] **Step 1: Write watchdog tests**

Test three modes: idle detection, max runtime detection, rate-limit loop detection. Use `Date.now()` overrides. The watchdog is a pure function: `checkAgent(agent, now, config) => 'ok' | 'idle' | 'max-runtime' | 'rate-limit-loop'`.

- [ ] **Step 2: Implement watchdog.ts**

```typescript
// src/main/agent-manager/watchdog.ts
import type { ActiveAgent, AgentManagerConfig } from './types'
import { RATE_LIMIT_LOOP_THRESHOLD } from './types'

export type WatchdogVerdict = 'ok' | 'idle' | 'max-runtime' | 'rate-limit-loop'

export function checkAgent(agent: ActiveAgent, now: number, config: AgentManagerConfig): WatchdogVerdict {
  if (now - agent.startedAt >= config.maxRuntimeMs) return 'max-runtime'
  if (now - agent.lastOutputAt >= config.idleTimeoutMs) return 'idle'
  if (agent.rateLimitCount >= RATE_LIMIT_LOOP_THRESHOLD) return 'rate-limit-loop'
  return 'ok'
}
```

- [ ] **Step 3: Write fast-fail tests**

Test: exit within 30s increments count, 3rd fast-fail returns `'exhausted'`, exit after 30s returns `'normal'`.

- [ ] **Step 4: Implement fast-fail.ts**

```typescript
// src/main/agent-manager/fast-fail.ts
import { FAST_FAIL_THRESHOLD_MS, MAX_FAST_FAILS } from './types'

export type FastFailResult = 'normal-exit' | 'fast-fail-requeue' | 'fast-fail-exhausted'

export function classifyExit(spawnedAt: number, exitedAt: number, currentFastFailCount: number): FastFailResult {
  if (exitedAt - spawnedAt >= FAST_FAIL_THRESHOLD_MS) return 'normal-exit'
  const newCount = currentFastFailCount + 1
  return newCount >= MAX_FAST_FAILS ? 'fast-fail-exhausted' : 'fast-fail-requeue'
}
```

- [ ] **Step 5: Run tests, commit**

```bash
npx vitest run src/main/agent-manager/__tests__/watchdog.test.ts src/main/agent-manager/__tests__/fast-fail.test.ts
git add src/main/agent-manager/watchdog.ts src/main/agent-manager/fast-fail.ts src/main/agent-manager/__tests__/
git commit -m "feat(agent-manager): add watchdog and fast-fail detection"
```

---

## Task 3: Worktree Management

**Files:**
- Create: `src/main/agent-manager/worktree.ts`
- Create: `src/main/agent-manager/__tests__/worktree.test.ts`

- [ ] **Step 1: Write worktree tests**

Test `branchNameForTask` (slug generation), `setupWorktree` (mocked execFile), `cleanupWorktree`, `pruneStaleWorktrees`.

- [ ] **Step 2: Implement worktree.ts**

Key functions:
- `branchNameForTask(title: string): string` — `agent/<slugified-title>`
- `setupWorktree(opts: { repoPath, branch, worktreePath, taskId }): Promise<{ worktreePath, branch }>`
  - Uses `execFile('git', ['worktree', 'add', '-b', branch, path])` in repoPath
  - File-based per-repo lock: write PID to `{worktreeBase}/.locks/{repoSlug}.lock`, check if PID alive before overwriting
- `cleanupWorktree(opts: { repoPath, branch, worktreePath }): void`
  - `git worktree remove <path>` then `git branch -D <branch>` (best-effort)
- `pruneStaleWorktrees(worktreeBase, isActive: (taskId) => boolean): void`
  - Scan `{worktreeBase}/{repo}/{taskId}` dirs, remove if `!isActive(taskId)`

- [ ] **Step 3: Run tests, commit**

```bash
git add src/main/agent-manager/worktree.ts src/main/agent-manager/__tests__/worktree.test.ts
git commit -m "feat(agent-manager): add worktree management with repo locking"
```

---

## Task 4: SDK Adapter

**Files:**
- Create: `src/main/agent-manager/sdk-adapter.ts`
- Create: `src/main/agent-manager/__tests__/sdk-adapter.test.ts`
- Modify: `package.json` — add `@anthropic-ai/claude-agent-sdk`

- [ ] **Step 1: Install SDK dependency**

```bash
cd /Users/ryan/projects/BDE && npm install @anthropic-ai/claude-agent-sdk
```

- [ ] **Step 2: Write SDK adapter tests**

Mock `createAgent` from the SDK. Test that `spawnAgent` returns a handle with `messages`, `sessionId`, `abort`, `steer`.

- [ ] **Step 3: Implement sdk-adapter.ts**

```typescript
// src/main/agent-manager/sdk-adapter.ts
import type { AgentHandle } from './types'

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  allowedTools?: string[]
}): Promise<AgentHandle> {
  // Clear ANTHROPIC_API_KEY to force subscription billing (same as task runner)
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const { createAgent } = await import('@anthropic-ai/claude-agent-sdk')
  const agent = await createAgent({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: 'bypassPermissions',
      allowedTools: opts.allowedTools,
    },
    env,
  })

  return {
    messages: agent,
    sessionId: agent.sessionId ?? crypto.randomUUID(),
    abort: () => agent.abort(),
    steer: (msg: string) => agent.steer(msg),
  }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add src/main/agent-manager/sdk-adapter.ts src/main/agent-manager/__tests__/sdk-adapter.test.ts package.json package-lock.json
git commit -m "feat(agent-manager): add SDK adapter for agent spawning"
```

---

## Task 5: Completion Handler

**Files:**
- Create: `src/main/agent-manager/completion.ts`
- Create: `src/main/agent-manager/__tests__/completion.test.ts`

- [ ] **Step 1: Write completion tests**

Test success flow (push branch, open PR, update task), failure flow (retry or fail), and `gh` CLI failure (log error, leave task active with no PR).

- [ ] **Step 2: Implement completion.ts**

```typescript
// src/main/agent-manager/completion.ts
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { updateTask } from '../data/sprint-queries'
import { createAgentRecord, finishAgentRecord } from '../agent-history'
import { MAX_RETRIES } from './types'

const execFile = promisify(execFileCb)

export async function resolveSuccess(opts: {
  taskId: string
  worktreePath: string
  taskTitle: string
  ghRepo: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  durationMs: number
}): Promise<void> {
  // 1. Detect actual branch
  const { stdout: branch } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: opts.worktreePath })
  const branchName = branch.trim()

  // 2. Push branch
  await execFile('git', ['push', 'origin', branchName], { cwd: opts.worktreePath })

  // 3. Open PR (best-effort)
  let prUrl: string | null = null
  let prNumber: number | null = null
  try {
    const { stdout } = await execFile('gh', [
      'pr', 'create', '--title', opts.taskTitle,
      '--body', `Automated by BDE agent manager`,
      '--head', branchName, '--repo', opts.ghRepo,
    ], { cwd: opts.worktreePath })
    const match = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/)
    if (match) { prUrl = match[0]; prNumber = parseInt(match[1], 10) }
  } catch (err) {
    console.error(`[agent-manager] PR creation failed for ${opts.taskId}: ${err instanceof Error ? err.message : err}`)
  }

  // 4. Update task — stays active with PR info
  await updateTask(opts.taskId, {
    ...(prUrl ? { pr_url: prUrl, pr_number: prNumber, pr_status: 'open' } : {}),
  })
}

export async function resolveFailure(opts: {
  taskId: string
  retryCount: number
}): Promise<void> {
  if (opts.retryCount < MAX_RETRIES) {
    await updateTask(opts.taskId, {
      status: 'queued', retry_count: opts.retryCount + 1, claimed_by: null,
    })
  } else {
    await updateTask(opts.taskId, {
      status: 'failed', completed_at: new Date().toISOString(),
    })
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/__tests__/completion.test.ts
git commit -m "feat(agent-manager): add completion handler (push + PR)"
```

---

## Task 6: Orphan Recovery

**Files:**
- Create: `src/main/agent-manager/orphan-recovery.ts`
- Create: `src/main/agent-manager/__tests__/orphan-recovery.test.ts`
- Modify: `src/main/data/sprint-queries.ts` — add `getQueuedTasks()` and `getOrphanedTasks()`

- [ ] **Step 1: Add queries to sprint-queries.ts**

```typescript
// Add to sprint-queries.ts:
export async function getQueuedTasks(limit: number): Promise<SprintTask[]> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks').select('*')
    .eq('status', 'queued').is('claimed_by', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function getOrphanedTasks(claimedBy: string): Promise<SprintTask[]> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks').select('*')
    .eq('status', 'active').eq('claimed_by', claimedBy)
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 2: Write orphan recovery tests**

Test: orphaned task with no branch → re-queues. Orphaned task with remote branch → pushes + PR. Task still active in agent map → skipped.

- [ ] **Step 3: Implement orphan-recovery.ts**

Checks `getOrphanedTasks('bde-embedded')` against the active agent map. For untracked tasks: check remote branch, push+PR if commits found, re-queue if not.

- [ ] **Step 4: Run tests, commit**

```bash
git add src/main/agent-manager/orphan-recovery.ts src/main/agent-manager/__tests__/orphan-recovery.test.ts src/main/data/sprint-queries.ts
git commit -m "feat(agent-manager): add orphan recovery and queued task query"
```

---

## Task 7: Agent Manager Core (Drain Loop)

**Files:**
- Create: `src/main/agent-manager/index.ts`
- Create: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Implement createAgentManager()**

The factory function that ties everything together:
- Creates `ConcurrencyState` from config
- Maintains `activeAgents: Map<string, ActiveAgent>`
- `start()`: runs orphan recovery, prunes worktrees, starts drain loop interval + watchdog interval
- `stop(timeoutMs=10_000)`: sets shutdown flag, aborts all active agents, waits up to timeout, force-kills
- `getStatus()`: returns running state, concurrency, active agent list

The drain loop:
1. Check shutdown
2. Check `availableSlots(concurrency)` — skip if 0
3. `AuthGuard.checkAuthStatus()` — skip cycle if expired
4. `getQueuedTasks(available)` — try/catch, log errors, continue
5. For each task: `claimTask(id, EXECUTOR_ID)` → if null, skip (already claimed)
6. `setupWorktree()` → on error, update task to `error`, continue
7. `spawnAgent()` → register in `activeAgents`, start consuming messages
8. Emit `agent-manager:agent-started` IPC event with `{ taskId, model, agentId }`
9. Message consumption loop: update watchdog state, track cost, emit `agent-manager:agent-output` IPC events, persist to event bus via `getEventBus().emit('agent:event', ...)`
10. On agent exit: classify (fast-fail or normal), resolve success/failure, cleanup worktree, write `agent_runs` record via `agent-history.ts`, unregister, emit `agent-manager:agent-completed` IPC event
11. On error: emit `agent-manager:error` IPC event
10. `tryRecover(concurrency)` at end of cycle

The watchdog loop (every 10s):
- For each active agent: `checkAgent()` → if not `ok`, abort agent + handle the verdict

- [ ] **Step 2: Write integration tests**

Mock sprint-queries, SDK adapter, execFile. Test: picks up queued task, claims it, spawns agent, completes successfully. Test: respects concurrency limit. Test: watchdog kills idle agent.

- [ ] **Step 3: Run tests, commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "feat(agent-manager): core drain loop with watchdog"
```

---

## Task 8: Wire into BDE

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/handlers/agent-handlers.ts`
- Modify: `src/main/handlers/agent-manager-handlers.ts`

- [ ] **Step 1: Update index.ts**

After the Queue API and PR poller setup (around line 92), add:

```typescript
import { createAgentManager } from './agent-manager'
import { checkAuthStatus } from './auth-guard'
import { getSettingJson } from './settings'

// After startQueueApi...
const agentManagerConfig = {
  maxConcurrent: getSettingJson('agentManager.maxConcurrent') ?? 2,
  worktreeBase: getSettingJson('agentManager.worktreeBase') ?? '/tmp/worktrees/bde',
  maxRuntimeMs: getSettingJson('agentManager.maxRuntimeMs') ?? 3_600_000,
  idleTimeoutMs: 900_000,
  pollIntervalMs: 30_000,
  defaultModel: getSettingJson('agentManager.defaultModel') ?? 'claude-sonnet-4-5',
}

const autoStart = getSettingJson('agentManager.autoStart') ?? true

const authStatus = await checkAuthStatus()
let agentManager: ReturnType<typeof createAgentManager> | null = null
if (autoStart && authStatus.tokenFound && !authStatus.tokenExpired) {
  agentManager = createAgentManager({ config: agentManagerConfig })
  agentManager.start()
  app.on('will-quit', () => agentManager?.stop(10_000))
}
```

Pass `agentManager` to handler registrations that need it.

- [ ] **Step 2: Update agent-handlers.ts**

Replace the `local:spawnClaudeAgent` throw with AgentManager-aware logic. Replace `agent:steer` and `agent:kill` to check local AgentManager first, fall back to runner-client.

```typescript
safeHandle('local:spawnClaudeAgent', async (_e, opts) => {
  if (!agentManager) throw new Error('Agent manager not available. Check Claude Code login.')
  // The AgentManager drain loop handles spawning — this IPC just queues the task
  // Alternatively, for manual launch: directly trigger spawn for a specific task
})

safeHandle('agent:steer', async (_e, { agentId, message }) => {
  // Try local AgentManager first
  if (agentManager) {
    const steered = agentManager.steerAgent(agentId, message)
    if (steered) return { ok: true }
  }
  // Fall back to runner-client
  return steerAgent(agentId, message)
})
```

- [ ] **Step 3: Update agent-manager-handlers.ts**

Replace runner-client proxy with direct AgentManager calls:

```typescript
safeHandle('agent-manager:status', async () => {
  if (!agentManager) return { running: false, activeCount: 0 }
  return agentManager.getStatus()
})

safeHandle('agent-manager:kill', async (_e, taskId: string) => {
  if (!agentManager) throw new Error('Agent manager not available')
  agentManager.killAgent(taskId)
})
```

- [ ] **Step 4: Run typecheck and tests**

```bash
cd /Users/ryan/projects/BDE && npm run typecheck && npm run test:main
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/handlers/agent-handlers.ts src/main/handlers/agent-manager-handlers.ts
git commit -m "feat: wire AgentManager into BDE main process"
```

---

## Task 9: Settings UI

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`

- [ ] **Step 1: Add AgentManager settings section to SettingsView**

Read the existing SettingsView to understand the pattern for settings fields. Add a new section "Agent Manager" with fields for:
- Max concurrent agents (`agentManager.maxConcurrent`, number input, default 2)
- Default model (`agentManager.defaultModel`, text input, default `claude-sonnet-4-5`)
- Worktree base (`agentManager.worktreeBase`, text input, default `/tmp/worktrees/bde`)
- Max runtime minutes (`agentManager.maxRuntimeMs`, number input, default 60, store as ms)
- Auto-start (`agentManager.autoStart`, toggle, default true)

Use existing `settings:setJson` / `settings:getJson` IPC calls. Follow the same UI pattern as other settings sections.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/views/SettingsView.tsx
git commit -m "feat: add AgentManager settings to Settings view"
```

---

## Task 10: Integration Verification

**Files:** None (manual verification)

- [ ] **Step 1: Start BDE**

```bash
cd /Users/ryan/projects/BDE && npm run dev
```

Verify no startup errors. Check console for "AgentManager started" or similar.

- [ ] **Step 2: Queue a task in Sprint board**

Create a task, push to queued. Verify:
- AgentManager picks it up within 30s
- Agent spawns in worktree
- Logs stream to LogDrawer
- On completion: branch pushed, PR opened

- [ ] **Step 3: Test failure scenarios**

- Kill BDE mid-task → restart → orphan recovery detects and re-queues
- Set `maxConcurrent: 1` in settings → queue 3 tasks → agents run sequentially
- Verify watchdog kills idle agent after 15 min (can reduce timeout for testing)

- [ ] **Step 4: Run full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit any fixes**

```bash
git commit -m "fix: integration fixes for embedded agent manager"
```
