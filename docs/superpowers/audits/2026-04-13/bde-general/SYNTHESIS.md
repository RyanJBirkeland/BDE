# BDE Architecture Audit — Synthesis Report
**Date:** 2026-04-13  
**Teams:** Architecture (T1), Security (T2), Reliability (T3), Uncle Bob (T4)  
**Lenses:** 12 of 12

---

## 1. Executive Summary

BDE's codebase is architecturally coherent at the process-boundary level: Electron's main/preload/renderer isolation is well-maintained, the IPC surface uses typed `safeHandle` wrappers consistently, and the SQLite data layer defends against SQL injection via prepared statements and column allowlists. The codebase has meaningful defenses in depth — path traversal protection in IDE and playground handlers, strict shell sanitization, and a well-designed backoff polling hook. However, **four structural health concerns** dominate across all teams: (1) a critical reliability gap where the dependency resolution system can leave tasks permanently stuck due to a stale index race condition and an unreachable epic cycle detector; (2) a security gap in the code review IPC surface where renderer-supplied `base` refs and `filePath` parameters flow unsanitized into git subprocess calls; (3) systematic IPC type gaps (13 channels missing from type definitions) that erode compile-time safety in the most frequently-changed part of the codebase; and (4) several god-class/god-function violations in `AgentManagerImpl`, `run-agent.ts`, and `completion.ts` that make the agent orchestration pipeline difficult to test and extend. The data layer is mostly solid but has two specific atomicity gaps — non-atomic dependent cascades and non-atomic group operations — that could leave the database in inconsistent states under concurrent load. Quick wins exist in injectable logging for data modules and a missing DB index that will become a table-scan bottleneck as task counts grow.

---

## 2. Top 10 Ranked Actions

| Rank | Finding ID | Title | Score | Severity | Effort | Source Lens |
|------|------------|-------|-------|----------|--------|-------------|
| 1 | F-t2-cmdinj-3 | Unvalidated base ref from renderer in review handlers | 6.0 | Critical | M | lens-cmdinj |
| 2 | F-t3-depres-5 | Epic cycle detection exists but is never called | 6.0 | High | S | lens-depres |
| 3 | F-t3-depres-3 | Stale dependency index in agent-manager causes stuck blocked tasks | 6.0 | High | S | lens-depres |
| 4 | F-t2-pathval-1+2 | Unvalidated worktreePath and filePath in review handlers | 4.5 | High | M | lens-pathval |
| 5 | F-t1-ipcsurf-1 | Eight tearoff broadcast channels missing from type definitions | 4.5 | High | S | lens-ipcsurf |
| 6 | F-t1-ipcsurf-2 | agent:event dual-registered as both invoke and broadcast | 4.5 | High | S | lens-ipcsurf |
| 7 | F-t1-datalay-4 | Non-atomic cascade cancellation in resolve-dependents | 4.5 | High | M | lens-datalay |
| 8 | F-t1-datalay-6 | Missing index on sprint_tasks(group_id) — full table scan | 6.0 | Medium | S | lens-datalay |
| 9 | F-t3-depres-1 | Soft dependency semantics undocumented — test names mislead | 6.0 | Critical | S | lens-depres |
| 10 | F-t3-tasktrans-1 | Cascade cancellation bypasses TaskTerminalService | 12.0 | Critical | S | lens-tasktrans |
| 11 | F-t3-tasktrans-3 | No runtime enforcement of isValidTransition at updateTask | 4.5 | High | M | lens-tasktrans |
| 12 | F-t2-ipcval-3 | Webhook URL host not validated — SSRF-adjacent risk | 3.0 | Medium | M | lens-ipcval |

---

### Rank 1 — F-t2-cmdinj-3: Unvalidated base ref from renderer in review handlers

**Score: (4×3)/2 = 6.0**

The `base` parameter sent by the renderer to `review:getDiff`, `review:getCommits`, and `review:getFileDiff` is interpolated directly into git revision range arguments (`${base}...HEAD`) without any validation. While `execFile` prevents classic shell injection, git's own rich revision syntax allows git-level injection: a crafted `base` like `--format=%(body)` can alter git output, `HEAD^{/keyword}` can search commit history, and pathological refs can cause resource exhaustion. This is the highest-severity finding because the attack surface is the renderer (untrusted in Electron's threat model), the code path is in the review workflow that every user exercises, and confidence in the impact is high. Fix: use `git rev-parse <base>` to canonicalize the ref to a SHA before passing it to any subsequent git command, or validate against `/^[a-zA-Z0-9/_.-]{1,100}$/`.

---

### Rank 2 — F-t3-depres-5: Epic cycle detection unreachable from handlers

**Score: (3×3)/1 = 9.0** *(recalculated — see note below)*

`detectEpicCycle()` exists in `epic-dependency-service.ts` but is never imported or called from any handler or service that creates/updates epic dependencies. Task-level cycle detection is correctly wired; epic-level is dead code. This means circular epic dependencies can be silently created, causing `areEpicDepsSatisfied()` to potentially infinite-loop or return stale results on every drain cycle. The fix is a single import and one validation call in the group handler — the function already exists and is tested. This is S-effort with high confidence, making it the highest pure score in the table.

**Note on score tie-breaking:** F-t3-depres-5 scores (3×3)/1 = 9.0 but was ranked 2nd because F-t2-cmdinj-3 is Critical severity (4) and directly exploitable from the renderer.

---

### Rank 3 — F-t3-depres-3: Stale dependency index in agent-manager causes permanently stuck tasks

**Score: (3×3)/1 = 9.0**

Two code paths exist for calling `resolveDependents`: `task-terminal-service` (rebuilds index before resolving) and `agent-manager/index.ts::onTaskTerminal` (does NOT rebuild index first). When two pipeline agents complete simultaneously, the second call to `resolveDependents` uses the index that was stale at the first call's start, potentially missing newly-completed upstream tasks. The result is dependent tasks stuck in `blocked` status indefinitely with no user-facing indication. Fix is one line: call `this._depIndex.rebuild(...)` immediately before `resolveDependents` in the agent-manager path.

---

### Rank 4 — F-t2-pathval-1+2: Unvalidated worktreePath and filePath in review handlers (merged)

**Score: (3×3)/2 = 4.5**

Two overlapping findings from lens-pathval: `worktreePath` in `review:getDiff` and `review:getCommits` is accepted from IPC without validating it is a legitimate agent worktree directory, and `filePath` in `review:getFileDiff` is accepted without checking for path traversal sequences. An attacker who can inject a modified `worktree_path` into the database (e.g., via a compromised task record) can cause git commands to execute in arbitrary directories. The `filePath` gap allows reading git metadata outside the worktree. Both findings share the same handlers and the same fix strategy: validate `worktreePath` against the list of known active worktrees from AgentManager, and reject any `filePath` containing `..` or starting with `/`.

---

### Rank 5 — F-t1-ipcsurf-1: Eight tearoff broadcast channels missing from type definitions

**Score: (3×3)/1 = 9.0** *(ties resolved by severity then effort — see note)*

Eight channels sent via `webContents.send()` from `tearoff-manager.ts` (`tearoff:confirmClose`, `tearoff:dragCancel`, `tearoff:dragDone`, `tearoff:dragIn`, `tearoff:dragMove`, `tearoff:tabRemoved`, `tearoff:tabReturned`, `tearoff:crossWindowDrop`) have no entries in `BroadcastChannels`. Preload listeners for these channels operate without type safety, meaning payload shape changes during refactoring won't be caught at compile time. The tearoff drag-and-drop system is the most complex cross-window interaction in BDE and is actively developed. Add all eight to `broadcast-channels.ts` with exact payload shapes — the shapes are already documented in the lens file.

---

### Rank 6 — F-t1-ipcsurf-2: agent:event dual-registered as invoke and broadcast

**Score: (3×3)/1 = 9.0** *(S effort, High severity, ranked below ipcsurf-1 by impact scope)*

`agent:event` appears in both `AgentEventChannels` (typed as an invoke channel with args/result) and `BroadcastChannels` (typed as a broadcast). The actual code path is broadcast-only — `agent-manager/run-agent.ts` calls `broadcast('agent:event', {...})`, never `safeHandle`. The erroneous invoke definition in `AgentEventChannels` creates type confusion that misleads developers into thinking a handler is registered. Remove `agent:event` from `AgentEventChannels` entirely. One-line fix with zero runtime risk.

---

### Rank 7 — F-t1-datalay-4: Non-atomic cascade cancellation in resolve-dependents

**Score: (3×3)/2 = 4.5**

When a hard dependency fails and triggers cascade cancellation across N dependents, each `updateTask()` call is an independent database write inside a loop. If the 5th dependent's update throws, dependents 6–N remain `blocked` while 0–4 are `cancelled`, leaving the dependency graph in an inconsistent state with no rollback and no recovery path. The `catch` silently logs and continues, hiding the partial failure. Fix: wrap the entire cascade loop in a single SQLite transaction, collecting all updates before committing, or at minimum throw on partial failure to surface the inconsistency.

---

### Rank 8 — F-t1-datalay-6: Missing index on sprint_tasks(group_id)

**Score: (2×3)/1 = 6.0**

Every call to `getGroupTasks()`, `queueAllGroupTasks()`, and `deleteGroup()` performs a full table scan of `sprint_tasks` because there is no index on `group_id`. This is a correctness issue today (silently slow) and a reliability issue as task counts grow into the thousands. Migration v027 added `group_id` to the schema but no index. Fix: add migration v049 with `CREATE INDEX idx_sprint_tasks_group_id ON sprint_tasks(group_id)`. Consider a composite `(group_id, sort_order)` since `getGroupTasks` always ORDER BY sort_order.

---

### Rank 9 — F-t3-depres-1: Soft dependency semantics undocumented — misleading test names

**Score: (4×3)/1 = 12.0** *(Critical severity, S effort — highest raw score)*

The lens flags that soft dependency semantics ("unblock on any terminal outcome") are correct in code but the test names and comments describe the behavior ambiguously. Calling it "Critical" is justified because if a developer misreads the contract and introduces a condition-based soft dep assuming it follows the type semantics, tasks silently stall. F-t3-depres-2 (backward-compat semantic ambiguity with conditions + type) is the deeper fix. The immediate action is a one-line comment addition in `dependency-service.ts` and renaming test cases in `resolve-dependents.test.ts` — S effort.

---

### Rank 10 — F-t2-ipcval-3: Webhook URL host not validated — SSRF-adjacent risk

**Score: (2×3)/2 = 3.0**

Webhook creation only validates that the URL scheme is `http://` or `https://`. A user can register a webhook pointing to `http://localhost:5432`, `http://192.168.x.x/`, or `http://169.254.169.254/` (AWS metadata). When the webhook fires, the main process issues a real HTTP request to that address. While this is a desktop app (not a multi-tenant server), it still allows an attacker with renderer access to initiate requests to any local network address. Fix: add a host-validation check using the regex pattern from the lens report before storing the URL.

---

## 3. Cross-Cutting Themes

### Theme A: IPC Type Safety Erosion
The IPC surface has systematic gaps where channels are used in production but not declared in type definitions. This affects both the broadcast direction (8 tearoff channels, `fs:watchError`) and the handler direction (5 tearoff handler channels using raw `ipcMain.on` instead of `safeOn`). The `agent:event` dual-registration is a direct consequence of this erosion — someone added a broadcast definition without removing the erroneous invoke definition. When type definitions are incomplete, refactoring payload shapes carries no compile-time protection.

Grouped findings: F-t1-ipcsurf-1, F-t1-ipcsurf-2, F-t1-ipcsurf-3, F-t1-ipcsurf-4, F-t1-ipcsurf-5

---

### Theme B: Review Handler Input Trust Gap
The code review workflow (`src/main/handlers/review.ts`) accepts multiple renderer-supplied parameters — `worktreePath`, `filePath`, `base` — and passes them directly to git subprocess calls without validation. Both the security team (lens-cmdinj, lens-pathval) and the architecture team (lens-ipcval) flagged variants of this problem independently. The root cause is that the review handlers were written assuming renderer input is trusted, which conflicts with Electron's security model. A single input-validation pass at the top of each review handler would close all three findings.

Grouped findings: F-t2-cmdinj-3, F-t2-pathval-1, F-t2-pathval-2, F-t2-pathval-3

---

### Theme C: Dependency Resolution Reliability Gaps
The dependency system has three independent bugs that can leave tasks permanently stuck in `blocked` status: a stale index in the agent-manager path (F-t3-depres-3), manual cancellations not triggering re-evaluation (F-t3-depres-4), and a time-window race in the `_terminalCalled` idempotency guard (F-t3-depres-8). Additionally, the epic cycle detector is dead code (F-t3-depres-5) and cascade cancellations are non-atomic (F-t1-datalay-4). All five are independent bugs in the same dependency resolution system. Together they represent a pattern of the dependency system being correct at the core algorithm level but having gaps at the integration boundaries (agent-manager vs. terminal service, manual vs. automated cancellation, task vs. epic level).

Grouped findings: F-t3-depres-3, F-t3-depres-4, F-t3-depres-5, F-t3-depres-8, F-t1-datalay-4

---

### Theme D: God Functions in Agent Orchestration
The agent orchestration pipeline (`run-agent.ts`, `completion.ts`, `AgentManagerImpl`, `_drainLoop`) concentrates too many responsibilities in single functions and classes. Uncle Bob lens found 3 Critical/High violations here (F-t4-cleanfn-1, F-t4-cleanfn-2, F-t4-cleanfn-4), and SOLID lens found the same files violating SRP (F-t4-cleansolid-1, F-t4-cleansolid-3, F-t4-cleansolid-4). These are not duplicates — the cleanfn lens focuses on function-level violations while cleansolid focuses on module/class-level violations — but they share the same root cause: orchestration logic accumulated incrementally in the same files without extraction checkpoints.

Grouped findings: F-t4-cleanfn-1, F-t4-cleanfn-2, F-t4-cleanfn-4, F-t4-cleansolid-1, F-t4-cleansolid-3, F-t4-cleansolid-4

---

### Theme E: Console Logging in Data Layer
Three data modules (`task-group-queries`, `settings-queries`, `reporting-queries`) use raw `console.error`/`console.warn` instead of the injectable logger pattern established in `sprint-queries`. These are not severe individually but create noise in stdout that can't be filtered, make tests emit console spam, and represent a systematic pattern of the injectable logger pattern not being extended to new modules.

Grouped findings: F-t1-datalay-1, F-t1-datalay-2, F-t1-datalay-9

---

### Theme F: React Polling Reliability
The `useBackoffInterval` hook has a dependency array bug that causes timer recreation on every parent re-render when options are passed as inline objects, defeating the backoff mechanism. Additionally, jitter is implicit (10% default) and too small for high-contention APIs. These two findings interact: if backoff is reset on every re-render, jitter never accumulates either.

Grouped findings: F-t3-polling-1, F-t3-polling-2, F-t3-polling-4

---

## 4. Quick Wins

Findings with Score >= 6.0 AND Effort = S — sprint these immediately:

- [ ] **F-t3-depres-5** — Wire `detectEpicCycle` into group handlers (Score: 9.0) — prevents circular epic deps from silently corrupting pipeline state
- [ ] **F-t3-depres-3** — Rebuild dep index before `resolveDependents` in agent-manager (Score: 9.0) — fixes permanently stuck blocked tasks in concurrent completion scenarios
- [ ] **F-t1-ipcsurf-1** — Add 8 tearoff broadcast channels to `BroadcastChannels` (Score: 9.0) — closes compile-time safety gap in tearoff refactors
- [ ] **F-t1-ipcsurf-2** — Remove `agent:event` from `AgentEventChannels` (Score: 9.0) — eliminates dual-registration type confusion with one line
- [ ] **F-t3-depres-1** — Document soft dep semantics + rename misleading tests (Score: 12.0) — prevents future misimplementation of condition-based deps
- [ ] **F-t1-datalay-6** — Add migration for `idx_sprint_tasks_group_id` (Score: 6.0) — prevents table-scan as task count grows
- [ ] **F-t1-datalay-1** — Add `setTaskGroupQueriesLogger()` injectable logger (Score: 6.0) — aligns with sprint-queries pattern, reduces test console noise
- [ ] **F-t1-datalay-2** — Add `setSettingsQueriesLogger()` injectable logger (Score: 6.0) — settings parse failures are config-critical, should route to structured log
- [ ] **F-t2-ipcval-2** — Validate profile names against alphanumeric pattern (Score: 6.0) — prevents special-char profile keys in settings table
- [ ] **F-t2-ipcval-4** — Validate `repo` field in `sprint:batchImport` (Score: 6.0) — brings batch import in line with `sprint:create` validation
- [ ] **F-t4-cleanfn-5** — Split `validateAndPreparePrompt()` into pure validation + pure assembly (Score: 6.0) — hidden task-state mutation inside "prepare" function is a maintainability trap
- [ ] **F-t4-cleansolid-5** — Segregate `RunAgentDeps` into focused dep bags (Score: 6.0) — reduces test mock burden for agent spawn/consume/finalize
- [ ] **F-t3-tasktrans-1** — Pass `onTaskTerminal` through `resolveDependents` + call after cascade cancel (Score: 12.0) — cascade-cancelled tasks leave dependents permanently blocked
- [ ] **F-t3-tasktrans-7** — Add non-terminal status guard at top of `resolveDependents()` (Score: 9.0) — prevents future regression if someone accidentally passes `'review'` to the resolver
- [ ] **F-t3-tasktrans-5** — Move `onStatusTerminal` call before final `updateTask` in `createPr()` (Score: 6.0) — closes ordering race between status broadcast and dependency resolution

---

## 5. Deferred / Out of Scope

| Finding ID | One-line reason for deferral |
|------------|------------------------------|
| F-t1-modbound-3 | Thin data-layer direct call in one handler; low blast radius, acceptable as documented exception |
| F-t1-modbound-4 | Git command closures in bootstrap are isolated to index.ts; cleaner after git-command-service exists, but no active duplicates |
| F-t1-ipcsurf-6 | Broadcast channel registry is a discoverability improvement, not a defect; L effort for low gain |
| F-t1-ipcsurf-7 | Inconsistent safeOn/ipcMain.on asymmetry is cosmetic until tearoff refactor happens |
| F-t1-datalay-5 | Audit trail for sort_order changes: useful but no compliance requirement; add alongside larger audit work |
| F-t1-datalay-7 | COLUMN_MAP two-level validation in updateGroup: current Set filter is sufficient for its small allowlist |
| F-t1-datalay-10 | agent_runs index gaps: query patterns need profiling before adding speculative indexes |
| F-t3-depres-6 | Deleted-dep auto-unblock logging: low severity, add as part of audit trail improvements |
| F-t3-depres-7 | type/condition precedence documentation: informational, no behavior change needed |
| F-t3-polling-3 | Duplicate sprint + PR polling is intentional design; consolidation needs product discussion |
| F-t3-polling-6 | Bootstrap interval constants/logging: cleanup, not a defect |
| F-t3-polling-8 | POLL_LOG_INTERVAL (1s) unused constant: remove if confirmed dead code |
| F-t3-polling-9 | Health check 10-min interval: product decision, not a bug |
| F-t4-cleanfn-3 | SprintPipeline 485-line component: L effort, valid but requires full layout extraction sprint |
| F-t4-cleanfn-6 | BuildAgentPrompt discriminated union: medium effort, type improvement not a defect |
| F-t4-cleanfn-8 | _processQueuedTask checklist refactor: M effort, readability improvement deferred to orchestration refactor |
| F-t4-cleanname-1 | Abbreviations in test/utility code: M effort, cosmetic, address in naming convention pass |
| F-t4-cleanname-2 | Inconsistent boolean naming: M effort for codebase-wide rename, document convention first |
| F-t4-cleanname-8 | DB field naming convention (pr_mergeable_state): requires migration, low value |
| F-t4-cleansolid-2 | sprint-queries audit trail extraction: M effort, valid SRP concern, but audit trail is not actively harmful; defer to planned data-layer refactor |
| F-t4-cleansolid-4 | completion.ts strategy pattern: M effort architectural refactor; valid OCP concern but not blocking any current work |
| F-t4-cleansolid-6 | sprint-local.ts handler array pattern: S effort OCP improvement; current sequential pattern is functional |
| F-t4-cleansolid-7 | sprint-queries submodule reorganization: M effort refactor; no behavior change, address when SRP violations compound |
| F-t4-cleansolid-8 | App.tsx initialization hook extraction: S effort, minor concern in stable file |

---

## 6. Open Questions

**Q1: How severe is the git-ref injection risk in review.ts (F-t2-cmdinj-3)?**
The cmd injection lens rates it Critical; the path validation lens rates the same `base` parameter as Medium (F-t2-pathval-3). The disagreement is confidence in exploitability. Both agree the fix is the same (validate `base`). The synthesis ranks it Critical because it is renderer-supplied and the review workflow is a primary user-facing surface. No lens was able to confirm whether a real git injection payload has been tested against the current version.

**Q2: Is F-t3-depres-4 (manual cancellation doesn't re-evaluate dependents) a real bug or accepted behavior?**
The lens has Medium confidence because it requires tracing the exact callback pathway to confirm that `updateTask` via IPC does not call `onStatusTerminal`. CLAUDE.md documents that "All terminal status paths converge at `TaskTerminalService`" but also notes "Direct SQLite writes bypass this." If the IPC `sprint:update` handler calls `updateTask` directly (which it does, per sprint-local.ts), and `updateTask` doesn't invoke the terminal service, then manual cancellations genuinely miss dependency re-evaluation. This needs a targeted code trace before fixing.

**Q3: F-t3-tasktrans-3 (no runtime transition validation at updateTask) — where should enforcement live?**
`isValidTransition()` exists in `src/shared/task-transitions.ts` but is never called from `updateTask()`. Adding enforcement at the data layer is the cleanest fix (catches all callers), but it would throw on any currently-tolerated "soft" invalid transitions. A targeted audit of all `updateTask()` call sites to identify any that intentionally bypass the state machine is recommended before adding the runtime guard, to avoid surprise exceptions in production.

**Q4: F-t3-depres-2 backward-compat semantic ambiguity — should `condition` be required?**
Making `condition` a required field on all new task dependencies would be a clean fix but breaks existing data in the database. The lens recommends a deprecation warning on deps without explicit conditions. There's no agreement on whether this should be a migration (updating existing rows) or a validation-only change (warn on new inserts). Migration would be clean but touches every row with depends_on data.

**Q5: F-t3-polling-1 (useBackoffInterval dependency array bug) — how widespread is the impact?**
The lens identifies one confirmed bad caller (`ConsoleHeader` with inline `{ maxMs: 10_000 }`). A grep for all `useBackoffInterval` call sites with inline options objects is needed to assess actual blast radius before prioritizing the fix.

**Q6: F-t4-cleansolid-1 (AgentManagerImpl god class) vs. incremental refactoring.**
The SOLID lens recommends extracting `ConcurrencyOrchestrator`, `DependencyOrchestrator`, and `EventLoopCoordinator` as delegated sub-objects. However, the class already has a constructor injection pattern and the agent orchestration code is the highest-churn area of the codebase. A full decomposition risks introducing regressions in complex async lifecycle management. The open question is whether to do the full extraction in one sprint or incrementally extract `DependencyOrchestrator` first (the lowest-risk slice), since dependency index management is already somewhat isolated via `_depIndex` and `_lastTaskDeps`.
