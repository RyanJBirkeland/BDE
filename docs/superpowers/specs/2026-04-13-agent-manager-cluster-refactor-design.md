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
│  ORCHESTRATION LAYER  (~100–150 lines each)         │
│  index.ts · run-agent.ts · completion.ts            │
│  "Wire the pieces together, make the calls"         │
└──────────────────────┬──────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────┐
│  DOMAIN LAYER  (decisions, rules, policies)         │
│  task-mapper.ts         map + validate queue tasks  │
│  message-consumer.ts    consume SDK message stream  │
│  playground-handler.ts  detect + emit playground    │
│  partial-diff-capture.ts capture failed-agent diff  │
│  auto-merge-rules.ts    load + evaluate merge rules │
│  review-transition.ts   transition task → review    │
└──────────────────────┬──────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────┐
│  INFRASTRUCTURE LAYER  (I/O, no business logic)     │
│  git-operations.ts  (already exists — extended)     │
│  sdk-adapter.ts     (already exists — extended)     │
│  worktree.ts        (already exists — unchanged)    │
└─────────────────────────────────────────────────────┘
```

**Layer invariants:**
- Infrastructure modules have no knowledge of tasks, rules, or state transitions
- Domain modules contain decisions and policies but make no raw git/SDK calls
- Orchestrators sequence calls but contain minimal logic of their own (~100–150 lines each after refactor)

## Architecture

### New files (Domain Layer)

**`task-mapper.ts`**  
Owns `_mapQueuedTask()` and `_checkAndBlockDeps()`, extracted from `index.ts`. Pure functions: take raw record, return typed task or null. No side effects.

**`message-consumer.ts`**  
Owns `consumeMessages()`, `processSDKMessage()`, `trackAgentCosts()`, `handleOAuthRefresh()`. Extracted from `run-agent.ts`. Accepts an `ActiveAgent`, `TurnTracker`, and callbacks; returns `ConsumeMessagesResult`. Independently testable without spawning a real agent.

**`playground-handler.ts`**  
Owns `detectHtmlWrite()`, `tryEmitPlaygroundEvent()`. Extracted from `run-agent.ts`. Both functions are already well-tested — this extraction makes their home obvious.

**`partial-diff-capture.ts`**  
Owns `capturePartialDiff()`, `classifyDiffCaptureError()`. Extracted from `run-agent.ts`. Named to distinguish from `diff-snapshot.ts` (which captures full review diffs).

**`auto-merge-rules.ts`**  
Owns `AutoReviewRule` type, rule loading from settings, and rule evaluation logic. Extracted from `completion.ts`. Isolated rule evaluation is independently testable — no git operations needed to assert whether a diff passes a rule.

**`review-transition.ts`**  
Owns `transitionToReview()`. Extracted from `completion.ts`. Handles the diff snapshot capture and `status: 'review'` update as a single atomic operation.

### Infrastructure Layer extensions

**`git-operations.ts`** (existing — extended)  
Receives `autoCommitIfDirty()`, `cleanupWorktreeAndBranch()`, `executeSquashMerge()` from `completion.ts`. These are pure git command sequences with no task state knowledge — they return results and let callers decide what to do.

**`sdk-adapter.ts`** (existing — extended)  
Receives `spawnWithTimeout()` from `run-agent.ts`. It is a thin timeout wrapper around `spawnAgent()`, which is already in `sdk-adapter.ts`.

### Orchestration Layer (after refactor)

**`run-agent.ts`** (~120 lines)  
Sequences three phases:
1. Build prompt (`prompt-composer.ts`)
2. Spawn + wire agent (`sdk-adapter.ts` + `message-consumer.ts`)
3. Finalize: classify exit, call `resolveSuccess`/`resolveFailure` (`completion.ts`)

**`completion.ts`** (~150 lines)  
Sequences post-execution:
1. Auto-commit dirty changes (`git-operations.ts`)
2. Attempt auto-merge if rules pass (`auto-merge-rules.ts` + `git-operations.ts`)
3. Otherwise transition to review (`review-transition.ts`)

**`index.ts`** (~200 lines)  
Sequences lifecycle:
1. Drain loop: fetch queued tasks, map them (`task-mapper.ts`), claim, setup worktree, spawn
2. Watchdog/orphan/prune timers
3. Shutdown coordination
4. Remove backward-compat re-exports — consumers import directly from source modules

## Phase Plan

### Phase 1 — Surgical Extraction (~1 day)

Extract independent pieces with no pipeline flow changes. Low regression risk.

| Extract from | New home | Functions |
|---|---|---|
| `run-agent.ts` | `playground-handler.ts` | `detectHtmlWrite`, `tryEmitPlaygroundEvent` |
| `run-agent.ts` | `partial-diff-capture.ts` | `capturePartialDiff`, `classifyDiffCaptureError` |
| `run-agent.ts` | `sdk-adapter.ts` | `spawnWithTimeout` |
| `completion.ts` | `git-operations.ts` | `autoCommitIfDirty`, `cleanupWorktreeAndBranch`, `executeSquashMerge` |
| `completion.ts` | `auto-merge-rules.ts` | `AutoReviewRule` type, rule loading, rule evaluation |
| `index.ts` | `task-mapper.ts` | `_mapQueuedTask`, `_checkAndBlockDeps` |
| `index.ts` | _(deleted)_ | Backward-compat re-exports (lines 49–58); update test imports |

**Verification after Phase 1:** `npm run typecheck && npm test && npm run test:main`

### Phase 2 — Orchestrator Thinning (~2–3 days)

With the domain pieces extracted, slim the orchestrators.

1. **Extract `message-consumer.ts`** from `run-agent.ts` — the message loop becomes independently testable
2. **Slim `run-agent.ts`** to a 3-phase orchestrator calling domain + infra modules
3. **Slim `completion.ts`** to call extracted `auto-merge-rules.ts`, `review-transition.ts`, `git-operations.ts`
4. **Slim `index.ts`** drain loop to call `task-mapper.ts` functions instead of inline methods

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
  ├── buildAgentPrompt()          ← prompt-composer.ts
  ├── spawnWithTimeout()          ← sdk-adapter.ts
  ├── consumeMessages()           ← message-consumer.ts
  └── finalizeAgentRun()
        ├── resolveSuccess()      ← completion.ts
        └── resolveFailure()      ← completion.ts
```

## Error Handling

No changes to error handling behavior. All existing error paths are preserved — extraction moves functions, not logic. Existing tests validate error paths and will catch regressions.

The one policy change: backward-compat re-exports in `index.ts` are removed. Affected test files update their imports to point at source modules. This is a purely mechanical change with no runtime effect.

## Testing

**Phase 1 adds no new tests** — existing tests continue to cover the extracted functions through their new import paths.

**Phase 2 unlocks new unit tests** for previously-untestable internals:
- `message-consumer.ts`: test cost tracking, OAuth refresh, rate-limit handling without spawning an agent
- `auto-merge-rules.ts`: test rule evaluation with synthetic diff stats, no git required
- `task-mapper.ts`: test field validation and coercion in isolation

Existing integration tests for `runAgent()`, `resolveSuccess()`, and `AgentManagerImpl` continue to serve as the end-to-end safety net.

## Success Criteria

1. `index.ts`, `run-agent.ts`, `completion.ts` each under 200 lines
2. Each new domain module has a single-sentence description that fits on one line
3. `npm run typecheck && npm test && npm run test:main` pass after each phase
4. No new external API surface — all changes are internal to `src/main/agent-manager/`
5. Re-exports removed from `index.ts`; test imports updated to point at source modules
