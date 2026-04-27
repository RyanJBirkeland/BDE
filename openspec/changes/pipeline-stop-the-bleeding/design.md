## Context

The 2026-04-25 audit produced 73 findings. Phase A is the subset that, if not fixed first, makes every later refactor land on top of broken correctness. Several of the constituent fixes already have prior change proposals (`ep1`–`ep16`). Rather than restate those proposals, this design defines (1) the milestone-level invariants Phase A must satisfy, (2) how the constituent changes coordinate, and (3) the pattern for the net-new audit tasks not yet covered.

Two BDE-specific constraints shape the design:

1. **Single-threaded main process.** SQLite (better-sqlite3) is synchronous, IPC handlers run on the same thread as the drain loop and watchdog. Any new fix must avoid introducing blocking work on hot paths.
2. **TaskStateService is the named chokepoint.** CLAUDE.md and `ep1-unified-task-state-machine` both name `TaskStateService.transition()` as the single chokepoint for terminal status writes. Phase A's correctness invariants are stated in terms of this chokepoint; if `ep1` slips, Phase A slips with it.

## Goals / Non-Goals

**Goals:**
- Every terminal status write (`failed` | `error` | `done` | `cancelled` | `review`) flows through `TaskStateService.transition()`.
- Every retry/queue structure on a critical path has a defined upper bound and a structured exhaustion event.
- Watchdog kill → worktree cleanup → next-claim is strictly ordered (no race window where a new agent's `git worktree add` collides with the previous agent's cleanup).
- Per-task crash-loop cap exists (no infinite re-queue under repeated BDE crashes).
- The five named state-mutating functions (`updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`, `resolveNodeExecutable`, plus the assistant/copilot/synthesizer prompt builders) have direct unit tests with ≥90% line and branch coverage.
- The reliability-focused IPC handler `forceReleaseClaim` aborts the live agent before re-queuing.

**Non-Goals:**
- No architectural refactors of `AgentManagerImpl`, `run-agent.ts`, or `completion.ts` for size — those belong to Phase B (EP-3 from the audit).
- No performance work — no statement caching, no SQL projection narrowing, no renderer virtualization.
- No new product surfaces — the `case 'review'` action set, `max_runtime_ms` UI, etc., are Phase B.
- No new IPC channels (other than what already-merged `ep*` proposals introduce).
- No DB schema changes beyond what `ep3` (orphan-recovery cap column) already specifies.

## Decisions

### D1 — Phase A is a coordination change, not a feature change

**Decision:** Treat this proposal as an umbrella that ratifies a set of correctness invariants and gates merge of the constituent `ep*` changes on satisfying those invariants. The implementation lives in the constituent changes plus a small set of net-new tasks; this proposal owns the contract, not the code.

**Alternatives considered:**
- *Re-author every fix inline.* Rejected — duplicates `ep1`/`ep3`/`ep4`/`ep5`/`ep8`/`ep16`, fragments review, loses the benefit of those proposals' design work.
- *Skip openspec entirely and just open a tracking issue.* Rejected — the user explicitly asked for an openspec proposal, and a coordination spec gives Phase B and Phase C something to build on.

### D2 — Define the milestone via testable invariants, not by listing tasks

**Decision:** The new capability `pipeline-correctness-baseline` defines invariants like "no `repo.updateTask({ status })` call exists outside `TaskStateService` after Phase A merges" — verifiable by grep — rather than "T-1, T-3, T-14 are done." Tasks come and go; invariants are stable.

**Rationale:** A task-based gate goes stale when tasks get renumbered or split. An invariant gate is checkable forever and survives constituent-change refactors.

### D3 — Net-new audit tasks land in the existing modules they fix, not in new files

**Decision:** Each net-new task in this proposal modifies code already touched by a constituent `ep*` change (or in adjacent modules). No task introduces a new module or a new architectural seam. Phase B owns those.

**Rationale:** Phase A is correctness-only. Adding seams now risks the seam being wrong; Phase B's decomposition will draw the right lines.

### D4 — `forceReleaseClaim` aborts via existing `agentManager.cancelAgent` (or equivalent), not via SIGKILL

**Decision:** T-10's abort sequence calls into `agentManager` to perform a graceful cancel — the same code path the watchdog uses for `cost-budget-exceeded`. If the agent does not exit within a short grace window (default 10s), the watchdog's existing forceKill escalation takes over.

**Rationale:** Reuses tested escalation logic. Avoids spawning a second kill path that could double-fire with the watchdog.

### D5 — Bounded retry queue (T-25) caps by **distinct task count**, not total attempts

**Decision:** `pendingTerminalRetries` gets a `MAX_PENDING_TASKS` cap (default 256). When the cap is reached and a new task needs to enter, the oldest is evicted with a `terminal-retry.evicted` structured event. Per-task attempt cap (existing `MAX_TERMINAL_RETRY_ATTEMPTS=5`) stays.

**Alternatives considered:**
- *Cap by total queued attempts.* Rejected — fragile to attempt-count drift and harder to reason about as "how many distinct tasks am I tracking."
- *No cap; rely on per-id cap to bound growth.* Rejected — the per-id cap drops after 5 attempts but that's still 5× the distinct-task count; under systemic GitHub failure the map can grow into the thousands.

### D6 — Test coverage floor is 90% line **and** branch on the named functions only

**Decision:** Coverage gates apply to `updateTaskFromUi`, `transitionToReview`, `handleWatchdogVerdict`, `resolveNodeExecutable`, and the per-agent prompt builders. Project-wide coverage thresholds stay where they are.

**Rationale:** Raising project-wide thresholds in Phase A would block on unrelated low-coverage modules. Targeted gates are honest about what Phase A actually proves.

### D7 — `git rev-list` and auto-commit failure (T-12, T-13) become hard failures, not assumed-success

**Decision:** Both currently fall through to `return true` / `continue` on error. Phase A converts them to `transition(taskId, 'failed', { failure_reason: 'git-precondition-failed' | 'auto-commit-failed' })`. Operators get a real signal; dependents don't unblock on phantom success.

**Trade-off:** A flaky git environment surface produces more visible failures. Acceptable: a visible failure is a feature, an invisible promotion-to-review with no commits is a bug.

### D8 — `transitionToReview` (T-8) gets a fallback transition to `failed`, not a swallow

**Decision:** If `taskStateService.transition(taskId, 'review', ...)` throws (e.g. invalid-transition because something else moved the task), call `transition(taskId, 'failed', { failure_reason: 'review-transition-failed' })` and emit a `review-transition.fallback` structured event.

**Trade-off:** Loses the diff-snapshot for those tasks. Acceptable: if `review` can't be reached, the snapshot has nowhere to live anyway.

### D9 — Worktree cleanup ordering (T-16) uses an in-memory per-task lock, not a filesystem lock

**Decision:** The watchdog and the drain loop coordinate via an in-process `Map<taskId, Promise<void>>`. The next claim awaits any in-flight cleanup promise. No new filesystem lock — the existing `worktree.ts` lock stays as-is for cross-process safety; this is intra-process ordering only.

**Rationale:** Filesystem locks add a syscall on every claim; an in-memory map is O(1) and only consulted when there's an actual race candidate.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Phase A bundles 25 tasks across 6+ existing change proposals — review surface is wide | Each constituent `ep*` change ships independently; this proposal only ratifies the milestone. Reviewers approve the *invariants*, not every task. |
| Converting `rev-list` and auto-commit failures to hard failures may surface latent flakiness in the agent's commit pipeline | Treat the surfaced flakiness as the win — it was always a bug, just silent. Track new `failure_reason` distribution for the first week post-merge. |
| In-memory per-task cleanup lock (D9) does not survive process restart | Acceptable: orphan recovery already handles cross-restart races. The lock targets the within-process drain↔watchdog window. |
| Test coverage floor on five named functions could drift with future edits | Add a CI rule: any PR that drops coverage on a listed function below 90% fails. (Vitest config gains a per-file threshold block.) |
| Existing `ep*` proposals may have minor scope drift from what Phase A claims they cover | Each constituent change's `tasks.md` gets a one-line back-reference to the `pipeline-correctness-baseline` invariant it satisfies. Drift becomes visible at archive time. |
| Coordination change archives nothing tangible itself — risk of becoming a stale doc | Archive only when every constituent `ep*` change is archived AND `npm run audit:phase-a` (a thin script grepping for the invariants) passes. |

## Migration Plan

1. **Land constituent `ep*` changes first** in dependency order: `ep4` (atomic lock) → `ep1` (state service) → `ep3` (orphan cap) → `ep5` (watchdog/circuit) → `ep8` (PR poller) → `ep2` (drain deadline) → `ep16` (claim-race tests). Each lands on its own; this proposal does not block them.
2. **Land net-new tasks** as small focused PRs grouped by file (one PR per `tasks.md` group). No mega-PR.
3. **Add the audit script** `scripts/audit-phase-a.ts` that mechanically checks each invariant (grep for forbidden patterns, runtime assertions in a smoke test). CI runs it on `main`.
4. **Archive** this proposal once `npm run audit:phase-a` is green and every constituent `ep*` is archived.

**Rollback:** every constituent change has its own rollback per its design. This proposal has nothing to roll back — it owns no code.

## Open Questions

- Should `pipeline-correctness-baseline` invariants live in a checked-in document the audit script reads, or be hard-coded in the script? (Leaning toward checked-in JSON so the spec drives the test.)
- Does T-55 (OAuth refresh coordination) fit better here or in `ep6-spawn-sdk-hardening`? (Tentatively here — it's a correctness fix, not a hardening.)
- For T-21 (drain dep-index rebuild failure), do we want a metric or just a structured warn event? (Tentatively just the event; metric belongs to Phase C / EP-8 from the audit.)
