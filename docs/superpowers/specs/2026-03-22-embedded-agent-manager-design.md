# Embedded Agent Manager for BDE

**Date:** 2026-03-22
**Status:** Approved
**Scope:** BDE
**Effort:** 2-3 days

## Problem

BDE currently has no local agent spawning capability. The `local:spawnClaudeAgent` IPC handler throws an error directing users to the external task runner. This makes BDE unusable as a standalone app — users can't spawn agents without Ryan's personal task runner service running.

For BDE to be packageable and shareable, it needs an embedded agent manager that spawns and monitors agents locally using the user's own Claude Code subscription.

## Solution

Build `src/main/agent-manager/` — an in-process agent executor in the Electron main process. It follows the same proven patterns from the task runner (concurrency backpressure, watchdog, fast-fail, orphan recovery) but is wired into BDE's existing infrastructure (Supabase via sprint-queries, IPC, Keychain auth).

```
User clicks "Launch" or task enters queued
  ↓
AgentManager drain loop picks up queued tasks
  ↓
AuthGuard validates Claude Code subscription token
  ↓
Worktree created for task (git worktree add)
  ↓
Agent spawned via Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
  ↓
Watchdog monitors: idle (15min), max runtime (60min), rate-limit loops
  ↓
On completion: push branch, open PR via gh CLI
  ↓
SprintPrPoller (already exists, 60s) detects merge → marks done
```

### Key Design Decisions

- **Independent implementation, same patterns** — BDE's Electron context (IPC, Keychain, SQLite) is different enough from the headless task runner that a shared library would create awkward abstractions. The patterns are well-proven; reimplementing them cleanly in BDE's context is straightforward.
- **Default concurrency: 2** — Personal Claude Code subscriptions have lower rate limits than Ryan's plan. Default 2 with dynamic backpressure (recoveryDueAt + atFloor pattern from HD-S8).
- **No HTTP API** — The agent manager is in-process. The renderer communicates via IPC, not HTTP. The Queue API on port 18790 remains for the external task runner (Ryan's personal use).

---

## Module Structure

All new files under `src/main/agent-manager/`:

```
src/main/agent-manager/
  index.ts              — createAgentManager() factory, drain loop, shutdown
  sdk-adapter.ts        — spawns agents via @anthropic-ai/claude-agent-sdk, consumes event stream
  concurrency.ts        — ConcurrencyState, applyBackpressure, tryRecover (port from task runner entity)
  watchdog.ts           — idle timeout, max runtime, rate-limit loop detection
  fast-fail.ts          — 30s threshold, 3-strike detection
  worktree.ts           — git worktree add/cleanup, branch naming, repo locking
  completion.ts         — push branch, open PR via gh CLI, resolve exit
  orphan-recovery.ts    — detect active tasks with dead agents, re-queue or recover
  types.ts              — AgentManagerConfig, AgentHandle, internal types
  __tests__/            — unit tests for each module
```

### New Dependency

**`@anthropic-ai/claude-agent-sdk`** — required for agent spawning. The SDK provides `createAgent()` which returns an async iterable of typed messages (tool calls, results, thinking, rate-limit events, cost data). This is the same SDK the task runner uses. Justification: it handles Claude Code process lifecycle, stdin/stdout protocol, and event parsing — reimplementing this via raw CLI spawning would be fragile and duplicate significant work.

### Agent Spawning via SDK

```typescript
// src/main/agent-manager/sdk-adapter.ts
import { createAgent } from '@anthropic-ai/claude-agent-sdk'

interface AgentHandle {
  messages: AsyncIterable<SdkMessage> // typed event stream
  sessionId: string
  abort(): void // SIGTERM the agent
  steer(message: string): Promise<void> // send follow-up message via stdin
}

// Spawn an agent in a worktree directory
async function spawnAgent(opts: {
  prompt: string
  cwd: string // worktree path
  model: string
}): Promise<AgentHandle>
```

The `messages` async iterable emits typed events including:

- `tool_use` / `tool_result` — tool calls and results
- `rate_limited` — rate-limit events (drives backpressure)
- `cost` — token usage and cost data (drives cost tracking)
- `thinking` — extended thinking blocks

`lastOutputAt` is updated on every message from the iterable. Rate-limit events increment `rateLimitCount`; all other messages reset it to 0.

### Cost Tracking

Cost data is extracted from the SDK's `cost` messages during the event consumption loop. On agent completion, `costUsd`, `tokensIn`, and `tokensOut` are written to the `agent_runs` record in SQLite. The existing Cost view already reads from `agent_runs` — no new pipeline needed.

---

## AgentManager Interface

```typescript
// src/main/agent-manager/index.ts

export interface AgentManagerDeps {
  logger: Logger
  config: AgentManagerConfig
}

export interface AgentManager {
  start(): void // begin drain loop + orphan recovery
  stop(timeoutMs?: number): Promise<void> // graceful shutdown (default 10s), then force-kill remaining
  getStatus(): AgentManagerStatus // concurrency, active count, health
}

export interface AgentManagerConfig {
  maxConcurrent: number // default 2
  worktreeBase: string // default /tmp/worktrees/bde
  maxRuntimeMs: number // default 60 * 60 * 1000
  idleTimeoutMs: number // default 15 * 60 * 1000
  pollIntervalMs: number // default 30_000
  defaultModel: string // default claude-sonnet-4-5
}

export interface AgentManagerStatus {
  running: boolean
  concurrency: ConcurrencyState
  activeAgents: Array<{ taskId: string; model: string; startedAt: string; durationMs: number }>
}
```

---

## Drain Loop

The drain loop runs every `pollIntervalMs` (default 30s) and picks up queued tasks:

```
1. Check shutdownGuard — abort if shutting down
2. Check concurrency — skip if no available slots
3. getQueuedTasks() from Supabase via sprint-queries (see below)
4. For each queued task:
   a. AuthGuard.checkAuthStatus() — if expired, log warning, skip entire cycle
   b. claimTask(task.id, 'bde-embedded') — atomic via Supabase
   c. If claim fails (409 / already claimed) → skip, continue to next
   d. Setup worktree (git worktree add -b agent/<slug>)
   e. Spawn agent via SDK adapter
   f. Consume SDK messages in async loop (updates lastOutputAt, tracks cost, emits IPC events)
   g. Register in active agent map
   h. Start watchdog for this agent
5. tryRecover(concurrency) — attempt to restore slots after rate-limit cooldown
```

Errors in the drain loop (Supabase unreachable, unexpected exceptions) are caught, logged, and the cycle continues on the next interval. The loop never crashes.

### New Query: `getQueuedTasks()`

Add to `sprint-queries.ts`:

```typescript
export async function getQueuedTasks(limit: number): Promise<SprintTask[]> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .select('*')
    .eq('status', 'queued')
    .is('claimed_by', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data ?? []
}
```

Filters by `status='queued'` AND `claimed_by IS NULL` to avoid picking up tasks already claimed by the external task runner.

### Claimed-By Identifier

The embedded agent manager uses `'bde-embedded'` as its `claimedBy` value. The external task runner uses its `EXECUTOR_ID` (default `'claude-task-runner-1'`). This distinction is critical for orphan recovery — the embedded manager only recovers tasks where `claimed_by = 'bde-embedded'`, ignoring tasks owned by the external runner.

### Claiming Conflict with External Task Runner

Both the embedded manager and the external task runner may poll the same Supabase queue. The atomic claim via `.eq('status', 'queued')` prevents double-claiming — whichever claims first wins. Worktree setup happens AFTER a successful claim, never before (avoids wasted setup on claim failure). This is by design: Ryan can run both his task runner and BDE simultaneously without conflict.

### Event Consumption & IPC

The SDK adapter returns an `AsyncIterable<SdkMessage>`. The drain loop consumes this in an async for-of loop:

```typescript
for await (const msg of handle.messages) {
  // Update watchdog
  agent.lastOutputAt = Date.now()

  // Track rate limits
  if (msg.type === 'rate_limited') {
    agent.rateLimitCount++
  } else {
    agent.rateLimitCount = 0
  }

  // Track cost
  if (msg.type === 'cost') {
    agent.costUsd += msg.costUsd
    agent.tokensIn += msg.tokensIn
    agent.tokensOut += msg.tokensOut
  }

  // Emit to renderer via IPC
  mainWindow.webContents.send('agent-manager:agent-output', {
    taskId: agent.taskId,
    type: msg.type,
    content: msg
  })

  // Persist to agent_events table (existing event bus)
  getEventBus().emit('agent:event', agent.id, msg)
}
```

This integrates with the existing `agent_events` pipeline used by the Agents view, so no parallel event path is needed.

### Steer Support

Running agents accept follow-up messages via `handle.steer(message)` (SDK method). The IPC handler `agent:steer` delegates to the active agent map:

```typescript
safeHandle('agent:steer', async (_e, { taskId, message }) => {
  const agent = activeAgents.get(taskId)
  if (!agent) throw new Error('Agent not active')
  await agent.handle.steer(message)
})
```

---

## Watchdog

Three failure modes, checked every 10 seconds per active agent:

| Mode                | Threshold                        | Action                                           |
| ------------------- | -------------------------------- | ------------------------------------------------ |
| **Idle**            | 15 min no output                 | SIGTERM → 5s grace → SIGKILL. Re-queue task.     |
| **Max runtime**     | 60 min wall clock                | SIGTERM → 5s grace → SIGKILL. Mark task `error`. |
| **Rate-limit loop** | 10 consecutive rate-limit events | SIGTERM. Apply backpressure. Re-queue task.      |

The watchdog tracks `lastOutputAt` (updated on every SDK message) and `rateLimitCount` (incremented on rate-limit events, reset on any non-rate-limit message).

---

## Fast-Fail Detection

If an agent exits within 30 seconds of spawn:

1. Increment `fastFailCount` on the task
2. If `fastFailCount >= 3`: mark task `error` with note "Fast-fail exhausted"
3. If `fastFailCount < 3`: re-queue task (will be picked up on next drain cycle)

Fast-fails do NOT consume retry count — they indicate an environment/config problem, not a task problem.

---

## Concurrency & Rate-Limit Backpressure

Direct port of the HD-S8 pattern:

```typescript
interface ConcurrencyState {
  maxSlots: number // from config (default 2)
  effectiveSlots: number // reduced by rate limits
  activeCount: number
  recoveryDueAt: number | null
  consecutiveRateLimits: number
  atFloor: boolean // when true, further rate-limits don't reset recovery timer
}
```

- `applyBackpressure()`: reduces `effectiveSlots` by 1. At floor (`effectiveSlots === 1`), stops resetting `recoveryDueAt`.
- `tryRecover()`: after 60s cooldown, increments `effectiveSlots` by 1. Repeats until back to `maxSlots`.

---

## Worktree Management

Per-task git worktree isolation:

```
/tmp/worktrees/bde/{repo}/{taskId}/
```

- **Setup**: `git worktree add -b agent/<slug> <path>` from the repo's main branch
- **Cleanup**: `git worktree remove <path>` after agent completes (success or failure)
- **Branch naming**: `agent/<slugified-task-title>` (same as task runner's `branchNameForTask`)
- **Repo locking**: File-based per-repo lock to prevent concurrent worktree setup races
- **Stale cleanup**: On startup and every 5 minutes, prune worktrees for tasks that are no longer active

---

## Completion Flow

When an agent exits with code 0:

1. Detect the branch name (may differ from worktree branch — check `git rev-parse --abbrev-ref HEAD` in worktree)
2. Push branch to remote: `git push origin <branch>`
3. Open PR: `gh pr create --title "<task title>" --body "..." --head <branch>`
4. Update task: `prUrl`, `prNumber`, `prStatus: 'open'`. Status stays `active` — NOT `done`.
5. Clean up worktree
6. Write `agent_runs` record with `costUsd`, `tokensIn`, `tokensOut`, `durationMs`

**Status clarification:** The task remains `active` with `prStatus: 'open'` until the PR is merged. The existing `SprintPrPoller` (60s interval) detects PR merge and transitions to `done`, or PR close and transitions to `cancelled`. This is consistent with the external task runner's flow and avoids double-setting `done`.

When an agent exits with non-zero code:

1. Check retry eligibility: `retryCount < MAX_RETRIES (3)`
2. If retriable: increment `retryCount`, set `status: 'queued'`, clear `claimed_by` (re-queue)
3. If exhausted: set `status: 'failed'`, `completedAt: now()`
4. Clean up worktree
5. Write `agent_runs` record with exit code

**`gh` CLI prerequisite:** PR creation requires `gh auth login`. BDE's onboarding screen already checks for `git` and `gh` CLI prerequisites. If `gh pr create` fails (auth or other), log the error and leave the task `active` with no PR — the user can manually create the PR from the pushed branch.

---

## Orphan Recovery

On startup and every 60 seconds:

1. Query tasks with `status: 'active'` AND `claimed_by: 'bde-embedded'` (only recover our own tasks, never the external task runner's)
2. For each, check if the agent is tracked in the active agent map
3. If not tracked (BDE crashed, agent died):
   a. Check for existing branch with commits on remote (same as HD-S3 pattern)
   b. If branch with commits: push + open PR → leave task `active` with PR info
   c. If no branch: re-queue task (set `status: 'queued'`, clear `claimed_by`)

---

## IPC Integration

The agent manager emits events to the renderer via IPC:

| IPC Event                       | When                 | Data                                        |
| ------------------------------- | -------------------- | ------------------------------------------- |
| `agent-manager:status`          | Every drain cycle    | `AgentManagerStatus`                        |
| `agent-manager:agent-started`   | Agent spawned        | `{ taskId, model, agentId }`                |
| `agent-manager:agent-output`    | SDK message received | `{ taskId, type, content }`                 |
| `agent-manager:agent-completed` | Agent exits          | `{ taskId, exitCode, costUsd, durationMs }` |
| `agent-manager:error`           | Unrecoverable error  | `{ taskId, message }`                       |

These feed into the existing Sprint LogDrawer and Agents view.

---

## Settings

New settings in BDE Settings view (persisted to SQLite `settings` table):

| Setting               | Key                          | Default              | Description                    |
| --------------------- | ---------------------------- | -------------------- | ------------------------------ |
| Max concurrent agents | `agentManager.maxConcurrent` | `2`                  | Concurrency slots              |
| Worktree base         | `agentManager.worktreeBase`  | `/tmp/worktrees/bde` | Where worktrees are created    |
| Max runtime           | `agentManager.maxRuntimeMs`  | `3600000` (60min)    | Per-agent wall clock limit     |
| Default model         | `agentManager.defaultModel`  | `claude-sonnet-4-5`  | Model for new agents           |
| Auto-start            | `agentManager.autoStart`     | `true`               | Start drain loop on app launch |

Config changes require app restart (read once at startup, per existing BDE convention).

---

## Startup Sequence

```
BDE main process starts
  ↓
1. Initialize SQLite DB (existing)
2. Start Queue API on 18790 (existing)
3. Start SprintPrPoller (existing)
4. AuthGuard.checkAuthStatus()
   ├─ If valid: create AgentManager, call start()
   └─ If expired/missing: log warning, skip AgentManager (user sees onboarding)
5. AgentManager.start():
   a. Run orphan recovery (one-time)
   b. Prune stale worktrees
   c. Start drain loop (setInterval)
   d. Start watchdog loop (setInterval, 10s)
```

---

## What Changes in Existing Code

| File                                          | Change                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`                           | Import and wire AgentManager. Start after auth check.                                                                                     |
| `src/main/handlers/agent-handlers.ts`         | Replace the "not supported" throw with delegation to AgentManager for `local:spawnClaudeAgent`. Add IPC handlers for status, steer, kill. |
| `src/main/handlers/agent-manager-handlers.ts` | Replace runner-client proxy with direct AgentManager calls.                                                                               |
| `src/renderer/src/views/SettingsView.tsx`     | Add AgentManager settings section.                                                                                                        |

---

## What Does NOT Change

- Queue API (18790) — stays for external task runner compatibility
- SprintPrPoller — already handles PR merge detection
- Sprint UI — already shows task status, LogDrawer, etc.
- Supabase data layer — AgentManager uses `sprint-queries.ts` directly
- Auth flow — AuthGuard already validates tokens

---

## Testing Strategy

- **Concurrency entity**: Pure unit tests (same pattern as task runner's `concurrency-pressure.test.ts`)
- **Watchdog**: Unit tests with mock clock (setTimeout/setInterval mocked)
- **Fast-fail**: Unit tests with mock agent exit times
- **Completion**: Unit tests with mocked `git push` and `gh pr create`
- **Drain loop**: Integration test with mocked sprint-queries and SDK adapter
- **Orphan recovery**: Unit test with mock active task list vs agent map

## Verification

1. BDE starts with `agentManager.autoStart: true` — drain loop begins
2. Queue a task in Sprint board → AgentManager picks it up within 30s
3. Agent spawns in worktree, logs stream to LogDrawer
4. Agent completes → branch pushed, PR opened automatically
5. PR merged → SprintPrPoller marks task done
6. Kill BDE mid-task → restart → orphan recovery detects and re-queues
7. Set `maxConcurrent: 1`, queue 3 tasks → agents run sequentially
8. Agent hits rate limit → concurrency reduces, recovers after cooldown
9. Agent stalls for 15 min → watchdog kills and re-queues
10. Agent fast-fails 3 times → task marked `error`
11. `npm run typecheck` passes
12. `npm test` passes
