# Concurrency-4 Risk Assessment

**Date**: 2026-04-12
**Task**: Investigation before increasing `agentManager.maxConcurrent` from 3 to 4
**Verdict**: **BLOCKED** — SQLite main-thread blocking risk is unmitigated

---

## Executive Summary

Increasing to 4 concurrent agents is **NOT SAFE** without prerequisite work. The async SQLite retry mechanism (`withRetryAsync`) exists but is **not actually used** — all queries still use the blocking `withRetry()` variant with `Atomics.wait()` on the main thread. At 4 concurrent writers, the risk of multi-second main-thread freeze is unacceptable.

---

## Risk 1: SQLite Contention ⚠️ **BLOCKER**

### Current State

- **Async variant exists**: `withRetryAsync` is implemented in `src/main/data/sqlite-retry.ts` (lines 64-83)
- **But unused**: `src/main/data/sprint-queries.ts:12` imports only `withRetry` (the blocking variant)
- **Blocking behavior**: `withRetry` uses `Atomics.wait()` — a synchronous sleep on the calling thread
- **Worst case**: 5 retries with exponential backoff → up to ~5 seconds of main-thread freeze under contention

### Impact at Concurrency=4

- 4 agents writing to `sprint_tasks`, `agent_runs`, `agent_events`, `task_changes` simultaneously
- SQLITE_BUSY errors become more frequent in WAL mode
- Main thread freezes during retry backoff → UI hangs, IPC stalls, watchdog misses ticks
- User perceives the app as "frozen" during high pipeline load

### Mitigation Required

**Prerequisite ticket**: Migrate all `sprint-queries.ts` calls from `withRetry()` to `withRetryAsync()`

- Replace synchronous query wrappers with async equivalents
- Update all call sites to `await` the async queries
- Add tests to verify main-thread responsiveness under contention

**Estimated effort**: 2-3 hours (mechanical refactor, mostly safe)

---

## Risk 2: Git Rebase Collisions ✅ **ACCEPTABLE**

### Current State

- File locks guard worktree setup operations (`src/main/agent-manager/file-lock.ts`)
- Lock acquisition is **fail-fast**: throws immediately if another process holds the lock (line 55)
- No retry loop, no timeout — just instant failure

### Impact at Concurrency=4

- If 4 agents start simultaneously on the same repo, only 1 acquires the lock
- The other 3 fail immediately with "Worktree lock held by PID X"
- Agent manager treats this as a spawn failure → task marked `error` after retries

### Why This Is Acceptable

- **Fail-fast is safe**: No agent waits indefinitely or consumes watchdog budget on lock contention
- **Retry mechanism exists**: Tasks marked `error` can be manually re-queued or auto-retried
- **Low probability**: Most tasks run on different repos or are staggered by the drain loop
- **No data corruption**: The lock prevents concurrent mutation of git refs

### Recommendation

No change needed before increasing concurrency. If lock contention becomes a user-visible issue (frequent `error` status on spawn), add a retry-with-backoff layer around `acquireLock()` — but that's a later optimization, not a prerequisite.

---

## Risk 3: Pre-Push Hook Serialization ⚠️ **MODERATE**

### Current State

- Pre-push hook runs: `typecheck && test && test:main` (~60s on a typical machine)
- No timeout configured in `.husky/pre-push` — the hook runs to completion or hangs indefinitely
- Git's `push` operation waits for the hook to complete before proceeding

### Impact at Concurrency=4

- 4 agents complete work within a narrow window (e.g., all finish within 2 minutes)
- Each agent's `git push` blocks on the pre-push hook
- Hooks serialize behind a shared lock (git's design) → worst case: agent 1 pushes in 60s, agent 2 waits 60s then pushes in 60s, etc.
- **Total wall time**: Up to 4 × 60s = 4 minutes for all 4 agents to push

### Risk of Watchdog False Positives

- Agent 4 might sit "idle" (no output) for 3 minutes waiting for agents 1-3 to finish their hooks
- Default idle timeout: 15 minutes — **3 minutes is well within the safety margin**
- **Verdict**: Annoying but not a blocker at concurrency=4

### Long-Term Mitigation (Future Work)

1. **Add push timeout**: Configure `git push` timeout at ~5 minutes (enough for 1 hook + safety margin)
   - If timeout expires, agent marks task as `error` with diagnostic note
   - User can investigate (stuck hook? network issue?) and re-queue
2. **Optimize the hook**: Parallelize `typecheck` and `test:main`, or cache successful runs per commit SHA
3. **Skip hook for pipeline agents**: Add `--no-verify` flag to agent pushes IF all verification already passed in the worktree before committing (would require spec change)

**Recommendation**: Monitor for false positives after increasing to 4. If we see agents timing out during push, add the timeout config and diagnostic logging.

---

## Risk 4: Watchdog False Positives ⚠️ **MODERATE**

### Current State

- Watchdog checks every 10 seconds (`WATCHDOG_INTERVAL_MS`)
- Idle timeout: 15 minutes (900,000ms)
- Max runtime: 60 minutes (3,600,000ms, overridable per-task via `max_runtime_ms`)
- **Critical gap**: Watchdog does NOT distinguish "blocked on SQLite/git lock" from "genuinely idle"

### Impact at Concurrency=4

- More agents → more lock contention → more time spent blocked
- An agent blocked on `withRetry()` (SQLite) or waiting for a git hook shows zero output
- If blocked time exceeds 15 minutes (unlikely but possible), watchdog kills it as "idle"

### Why This Matters Less Than It Sounds

- **SQLite retry is fast**: Max 5s even under worst-case contention
- **Git lock is fail-fast**: No waiting — immediate error if locked
- **Pre-push hook**: Agents ARE making progress (running tests) — they just don't emit agent events during the hook. The hook itself logs to stderr, which updates `lastOutputAt`

### Edge Case: Hook Hangs

If a pre-push hook HANGS (e.g., `vitest` deadlock, network timeout in `npm install` for test deps), the agent appears idle. Current watchdog would kill it after 15 minutes. This is arguably correct behavior — a hung hook is effectively a hung agent.

### Recommendation

**No change needed before increasing to 4.** The idle timeout (15 min) is already generous enough to cover realistic hook serialization delays (4 agents × 60s = 4 min).

If we observe false positives in production:

1. Add heartbeat logging during git operations ("Waiting for pre-push hook..." every 30s)
2. Increase idle timeout to 20 minutes for pipeline agents (but keep 15 min for adhoc to catch genuinely stuck sessions)

---

## Prerequisites Before Increasing to 4

1. **BLOCKER**: Migrate `sprint-queries.ts` to `withRetryAsync`
   - File: `src/main/data/sprint-queries.ts`
   - Change: `import { withRetry }` → `import { withRetryAsync }`
   - Update all query wrappers to `async` and `await` the retry wrapper
   - Test under contention (4 agents writing simultaneously) to verify no main-thread freezes

2. **Recommended**: Add push timeout config
   - File: `src/main/agent-manager/completion.ts` (or wherever `git push` happens)
   - Add `timeout: 5 * 60 * 1000` to `execFileAsync('git', ['push', ...], { timeout: ... })`
   - Catch timeout errors and mark task as `error` with diagnostic note

3. **Monitor**: Watch for false positives in the first week after increasing to 4
   - Check `~/.bde/bde.log` for watchdog kills where the agent was actually blocked on a lock
   - If seen, add heartbeat logging or increase idle timeout

---

## Config Changes (After Prerequisites)

```typescript
// src/main/agent-manager/types.ts
export const DEFAULT_CONFIG: AgentManagerConfig = {
  maxConcurrent: 4 // CHANGE FROM 2
  // ... rest unchanged
}
```

No other config changes needed. The existing watchdog limits are adequate for 4 agents.

---

## Estimated Total Effort

- **SQLite async migration**: 2-3 hours (includes testing)
- **Push timeout config**: 30 minutes
- **Monitoring/validation**: 1 hour over first week

**Total**: ~4 hours of focused work before the increase is safe.
