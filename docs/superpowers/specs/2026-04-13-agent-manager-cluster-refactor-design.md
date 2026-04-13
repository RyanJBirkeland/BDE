# Agent-Manager Cluster Refactor

**Date:** 2026-04-13  
**Status:** Draft  
**Effort:** 3–4 days (Phase 1: ~1 day, Phase 2: ~2–3 days)  
**Dependencies:** None — pure internal refactor, no external API changes

## Problem

Three files in `src/main/agent-manager/` have grown into god modules that mix infrastructure, domain logic, and orchestration:

| File | Lines | Concerns mixed |
|------|-------|----------------|
| `index.ts` | 957 | Orchestration + task mapping + dep enforcement + backward-compat re-exports |
| `run-agent.ts` | 789 | Spawn + message consumption + playground + diff capture + OAuth refresh |
| `completion.ts` | 707 | Git ops + state transitions + auto-merge rules + PR management |

**Why this matters:** These files act as templates. Agents and developers reading the codebase infer that it is acceptable to mix concerns at this scale. New code lands in whichever god module is closest, perpetuating the pattern. The coupling also prevents isolated unit testing — internal phases like `consumeMessages()`, `spawnAndWireAgent()`, and `executeSquashMerge()` are only testable indirectly through their parent orchestrators.

### What's already clean

16 focused modules exist and are NOT being touched: `circuit-breaker.ts`, `watchdog-handler.ts`, `oauth-checker.ts`, `concurrency.ts`, `fast-fail.ts`, `metrics.ts`, `orphan-recovery.ts`, `diff-snapshot.ts`, `disk-space.ts`, `file-lock.ts`, `sdk-adapter.ts`, `turn-tracker.ts`, `worktree.ts`, `git-operations.ts`, `resolve-dependents.ts`, `types.ts`.

## Solution

Establish three explicit layers inside `src/main/agent-manager/`. Each layer has a one-sentence responsibility. No file calls downward more than one layer.

```
┌─────────────────────────────────────────────────────┐
│  ORCHESTRATION LAYER  (~150–200 lines each)         │
│  index.ts · run-agent.ts · completion.ts            │
│  "Wire the pieces together, make the calls"         │
└──────────────────────┬──────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────┐
│  DOMAIN LAYER  (decisions, rules, policies)         │
│  task-mapper.ts          map + validate queue tasks │
│  message-consumer.ts     consume SDK message stream │
│  playground-handler.ts   detect + emit playground   │
│  partial-diff-capture.ts capture failed-agent diff  │
│  review-transition.ts    transition task → review   │
└──────────────────────┬──────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────┐
│  INFRASTRUCTURE LAYER  (I/O, no business logic)     │
│  git-operations.ts  (already exists — extended)     │
│  sdk-adapter.ts     (already exists — extended)     │
│  worktree.ts        (already exists — unchanged)    │
└─────────────────────────────────────────────────────┘

Auto-merge rules: src/main/services/auto-review.ts (already exists — already isolated)
```

**Layer invariants:**
- Infrastructure modules have no knowledge of tasks, rules, or state transitions
- Domain modules contain decisions and policies; they may call infrastructure but not vice versa
- Orchestrators sequence calls but contain minimal logic of their own

**Note on `partial-diff-capture.ts`:** `capturePartialDiff()` calls `execFile('git', ...)` directly because the git call is inseparable from the error-classification and size-capping policy. This is an accepted exception to the layer invariant — it is documented here so the implementer does not refactor it unnecessarily.

## Architecture

### New files (Domain Layer)

**`task-mapper.ts`**  
Extracts `_mapQueuedTask()` and `_checkAndBlockDeps()` from `index.ts` as standalone functions.

- `mapQueuedTask(raw, logger): MappedTask | null` — validates required fields, normalises types, returns null with a warning on invalid input. Takes `Logger` as a parameter since the current implementation calls `this.logger.warn()`.
- `checkAndBlockDeps(taskId, rawDeps, taskStatusMap, repo, depIndex, logger): boolean` — checks dependency satisfaction and calls `repo.updateTask()` to block if unsatisfied. Takes `repo`, `depIndex`, and `logger` as parameters (replaces `this.repo`, `this._depIndex`, `this.logger` references).

Both functions are pure in the sense that all dependencies are injected via parameters — no class state.

**`message-consumer.ts`**  
Extracts the SDK message loop from `run-agent.ts`.

Exported interface:
```typescript
export interface ConsumeMessagesOpts {
  handle: AgentHandle
  agent: ActiveAgent
  task: RunAgentTask
  worktreePath: string
  agentRunId: string
  turnTracker: TurnTracker
  logger: Logger
}

export interface ConsumeMessagesResult {
  exitCode: number | undefined
  lastAgentOutput: string
}

export async function consumeMessages(opts: ConsumeMessagesOpts): Promise<ConsumeMessagesResult>
```

Internal helpers moved verbatim: `processSDKMessage()`, `trackAgentCosts()`, `detectPlaygroundWrite()`, `handleOAuthRefresh()`. Their signatures do not change — only their file location changes.

**`playground-handler.ts`**  
Extracts `detectHtmlWrite()` and `tryEmitPlaygroundEvent()` from `run-agent.ts`. Both functions are already well-tested and have no dependencies on the agent lifecycle — this extraction makes their home unambiguous.

**`partial-diff-capture.ts`**  
Extracts `capturePartialDiff()` and `classifyDiffCaptureError()` from `run-agent.ts`. Named to distinguish from `diff-snapshot.ts` (which captures full review diffs for the Code Review Station). Contains a direct `execFile('git', ...)` call — this is intentional (see layer invariant note above).

**`review-transition.ts`**  
Extracts `transitionToReview()` from `completion.ts`. Handles diff snapshot capture and the `status: 'review'` update as a single atomic operation. Signature unchanged.

### Auto-merge rules — no new file needed

`src/main/services/auto-review.ts` already exists and is already isolated. `completion.ts` already imports it via dynamic `import('../services/auto-review')`. The only cleanup needed: remove the duplicate `type AutoReviewRule` definition at `completion.ts:28` (which shadows the shared type from `src/shared/types/task-types.ts`) and ensure `completion.ts` imports `AutoReviewRule` from the shared types module directly.

### Infrastructure Layer extensions

**`git-operations.ts`** (existing — extended)  
Receives `autoCommitIfDirty()`, `cleanupWorktreeAndBranch()`, and `executeSquashMerge()` from `completion.ts`. These functions contain only git command sequences — no task state reads or writes. Callers in `completion.ts` receive results and decide what task state transitions to make.

`executeSquashMerge()` signature after extraction:
```typescript
export async function executeSquashMerge(opts: {
  branch: string
  worktreePath: string
  repoPath: string
  title: string
  logger: Logger
}): Promise<'merged' | 'dirty-main' | 'failed'>
```
The task state update (`repo.updateTask`) and `onTaskTerminal` call remain in `completion.ts` — infrastructure does not touch task state.

**`sdk-adapter.ts`** (existing — extended)  
Receives `spawnWithTimeout()` from `run-agent.ts`. It is a thin timeout wrapper around `spawnAgent()`, which is already in `sdk-adapter.ts`. The wiring logic in `spawnAndWireAgent()` (stderr capture, `ActiveAgent` construction, `createAgentRecord`, `agent:started` event) stays in `run-agent.ts` — that is orchestration, not infrastructure.

### Orchestration Layer (after both phases complete)

**`run-agent.ts`** (~200 lines)  
Sequences three phases:
1. Build prompt (`prompt-composer.ts`)
2. Spawn: call `spawnWithTimeout()` (`sdk-adapter.ts`), wire stderr + `ActiveAgent`, persist run record
3. Consume: call `consumeMessages()` (`message-consumer.ts`)
4. Finalize: classify exit, call `resolveSuccess`/`resolveFailure` (`completion.ts`)

**`completion.ts`** (~200 lines)  
Sequences post-execution:
1. Auto-commit dirty changes (`autoCommitIfDirty` from `git-operations.ts`)
2. Evaluate auto-merge rules (`auto-review.ts`)
3. If merge: call `executeSquashMerge()` (`git-operations.ts`), update task to `done`
4. Otherwise: call `transitionToReview()` (`review-transition.ts`)

**`index.ts`** (~250 lines)  
Sequences lifecycle:
1. Drain loop: fetch queued tasks, call `mapQueuedTask()` + `checkAndBlockDeps()` (`task-mapper.ts`), claim, setup worktree, spawn
2. Watchdog/orphan/prune timers (unchanged)
3. Shutdown coordination (unchanged)

## Phase Plan

### Phase 1 — Surgical Extraction (~1 day)

Extract independent pieces with no pipeline flow changes. Low regression risk.

| Extract from | New home | What moves |
|---|---|---|
| `run-agent.ts` | `playground-handler.ts` (new) | `detectHtmlWrite`, `tryEmitPlaygroundEvent` |
| `run-agent.ts` | `partial-diff-capture.ts` (new) | `capturePartialDiff`, `classifyDiffCaptureError` |
| `run-agent.ts` | `sdk-adapter.ts` (extend) | `spawnWithTimeout` |
| `completion.ts` | `git-operations.ts` (extend) | `autoCommitIfDirty`, `cleanupWorktreeAndBranch`, `executeSquashMerge` (see signature above) |
| `completion.ts` | _(delete duplicate)_ | `type AutoReviewRule` at line 28 — import from `src/shared/types/task-types.ts` instead |
| `completion.ts` | `review-transition.ts` (new) | `transitionToReview` |
| `index.ts` | `task-mapper.ts` (new) | `_mapQueuedTask` → `mapQueuedTask`, `_checkAndBlockDeps` → `checkAndBlockDeps` (with injected deps) |
| `index.ts` | _(remove)_ | Backward-compat re-exports at lines 49–58 |

**Backward-compat re-export removal:** Grep `src/main/agent-manager/__tests__/` for `from '../index'`. Update each import to point at the source module:
- `SPAWN_CIRCUIT_FAILURE_THRESHOLD`, `SPAWN_CIRCUIT_PAUSE_MS` → `../circuit-breaker`
- `handleWatchdogVerdict`, `WatchdogVerdictResult`, `WatchdogCheck`, `WatchdogAction` → `../watchdog-handler`
- `checkOAuthToken`, `invalidateCheckOAuthTokenCache`, `OAUTH_CHECK_CACHE_TTL_MS`, `OAUTH_CHECK_FAIL_CACHE_TTL_MS` → `../oauth-checker`

**Verification after Phase 1:** `npm run typecheck && npm test && npm run test:main`

### Phase 2 — Orchestrator Thinning (~2–3 days)

With the infrastructure extracted, slim the orchestrators.

| Step | What changes |
|---|---|
| Extract `message-consumer.ts` | Move `consumeMessages`, `processSDKMessage`, `trackAgentCosts`, `handleOAuthRefresh`, `detectPlaygroundWrite` out of `run-agent.ts`. Use the `ConsumeMessagesOpts` / `ConsumeMessagesResult` interface defined above. |
| Slim `run-agent.ts` | Replace inline message loop with `consumeMessages(opts)` call. `spawnAndWireAgent` logic stays in `run-agent.ts` (it is orchestration — wires stderr, builds `ActiveAgent`, persists run record). |
| Slim `completion.ts` | Replace inline `executeSquashMerge`, `autoCommitIfDirty`, `cleanupWorktreeAndBranch` calls with imports from `git-operations.ts`. Replace inline `transitionToReview` with import from `review-transition.ts`. |
| Slim `index.ts` drain loop | Replace `this._mapQueuedTask(raw)` and `this._checkAndBlockDeps(...)` with imported `mapQueuedTask` and `checkAndBlockDeps` from `task-mapper.ts`. Remove the instance methods from `AgentManagerImpl`. |

**Verification after Phase 2:** `npm run typecheck && npm test && npm run test:main`

## Data Flow

### Before (run-agent.ts today)
```
runAgent()
  ├── buildPrompt() [inline]
  ├── spawnWithTimeout() [inline]
  ├── consumeMessages() [inline]
  │     ├── processSDKMessage() [inline]
  │     │     ├── trackAgentCosts() [inline]
  │     │     ├── detectPlaygroundWrite() [inline]
  │     │     └── emitAgentEvent()
  │     └── handleOAuthRefresh() [inline]
  └── finalizeAgentRun() [inline]
        └── resolveSuccess() / resolveFailure()
```

### After (run-agent.ts orchestrator)
```
runAgent()
  ├── buildAgentPrompt()       ← prompt-composer.ts
  ├── spawnWithTimeout()       ← sdk-adapter.ts
  ├── [wire stderr + ActiveAgent + persist record — stays here]
  ├── consumeMessages(opts)    ← message-consumer.ts
  └── [finalize: classify exit]
        ├── resolveSuccess()   ← completion.ts
        └── resolveFailure()   ← completion.ts
```

## Error Handling

No changes to error handling behavior. All existing error paths are preserved — extraction moves functions, not logic. Existing tests validate error paths and will catch regressions.

`executeSquashMerge()` returns a discriminated result (`'merged' | 'dirty-main' | 'failed'`) instead of throwing so the caller in `completion.ts` controls the task state response. This replaces the current pattern where `executeSquashMerge` calls `onTaskTerminal` directly — task state is the orchestrator's job, not the infrastructure's.

## Testing

**Phase 1 adds no new tests** — existing tests continue to cover the extracted functions through their new import paths. Update any `from '../index'` imports in test files as described above.

**Phase 2 unlocks new unit tests** for previously-untestable internals:
- `message-consumer.ts`: test cost tracking, OAuth refresh trigger, rate-limit count increment — without spawning a real agent process
- `task-mapper.ts`: test field validation, type coercion, null returns for missing required fields — in complete isolation

Existing integration tests for `runAgent()`, `resolveSuccess()`, and `AgentManagerImpl` continue to serve as the end-to-end safety net.

## Success Criteria

After **both phases** are complete:

1. `index.ts`, `run-agent.ts`, `completion.ts` each under 250 lines
2. Each new domain module has a single-sentence description that fits on one line
3. `npm run typecheck && npm test && npm run test:main` pass after each phase
4. No new external API surface — all changes are internal to `src/main/agent-manager/`
5. Backward-compat re-exports removed from `index.ts`; all test imports updated
6. `completion.ts` has no duplicate `AutoReviewRule` type definition
