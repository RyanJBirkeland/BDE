# Lens: Duplication Radar — BDE Clean Code Audit 2026-04-13

**Persona:** Duplication Radar
**Scope:** Copy-paste code, near-duplicate logic, missing abstractions, structural duplication, shotgun surgery targets

---

## F-t2-duplication-1: `sleep()` and `promisify(execFile)` reimplemented in 25+ files
**Severity:** Medium
**Category:** Copy-Paste
**Location:** `src/main/github-fetch.ts`, `src/main/git-operations.ts`, `src/main/agent-manager/adhoc-agent.ts`, and 22+ other handler/service files
**Evidence:** Both `sleep()` (a simple `new Promise(resolve => setTimeout(resolve, ms))`) and `promisify(execFile)` are independently reimplemented in every file that needs them, rather than being imported from a shared utility.
**Impact:** When a change is needed (e.g., adding logging to all sleep calls for debugging, or switching execFile to execFileAsync), 25+ files require individual edits. Developers discovering the codebase keep writing their own version rather than finding a central one.
**Recommendation:** Extract to `src/main/lib/async-utils.ts` and export `sleep(ms: number)` and `execFileAsync`. Update all import sites.
**Effort:** S
**Confidence:** High

---

## F-t2-duplication-2: Three independent retry/backoff implementations
**Severity:** High
**Category:** Structural Duplication
**Location:**
- `src/main/github-fetch.ts` — exponential + jitter, capped at 30s
- `src/main/git-operations.ts` (or similar) — hard-coded `[3000, 8000]` backoff array
- `src/main/agent-manager/completion.ts` — `30000 * Math.pow(2, retryCount)`, capped at 300s
**Evidence:** Three completely different retry strategies for the same conceptual operation — wait and retry on transient failure. The formulas, caps, and jitter strategies all differ.
**Impact:** Bug fixes in one retry implementation don't propagate to others. Strategy decisions (should we add jitter? what's the cap?) are made independently and drift. No central place to tune retry behavior when debugging production failures.
**Recommendation:** Create `src/main/lib/retry-utils.ts` with a `withRetry(fn, config: RetryConfig)` utility. Config objects: `GITHUB_API_RETRY`, `GIT_OPS_RETRY`, `TASK_COMPLETION_RETRY`. All three callers use the same underlying mechanism with domain-appropriate config.
**Effort:** M
**Confidence:** High

---

## F-t2-duplication-3: `onTaskTerminal` callback signature defined in 7+ locations
**Severity:** High
**Category:** Structural Duplication
**Location:** `src/main/handlers/sprint-local.ts`, `src/main/handlers/sprint-batch-handlers.ts`, `src/main/handlers/review.ts`, `src/main/agent-manager/run-agent.ts`, `src/main/agent-manager/completion.ts`, `src/main/agent-manager/index.ts`, `src/main/sprint-pr-poller.ts`
**Evidence:** The callback type `(taskId: string, status: TaskStatus) => Promise<void>` (or equivalent) is declared independently across 7 modules. Name also varies: `onTaskTerminal` vs `onStatusTerminal`.
**Impact:** Adding a parameter to the callback signature requires editing 7 interfaces. Renaming the callback requires 7 find-and-replace operations with no compiler guard across all variants. The name inconsistency (`onTaskTerminal` vs `onStatusTerminal`) already indicates drift.
**Recommendation:** Create `src/main/lib/task-terminal-types.ts` with `type OnTaskTerminal = (taskId: string, status: TerminalTaskStatus) => Promise<void>` as the canonical type. Export `isTerminalStatus()` helper. All 7 modules import from this single source.
**Effort:** M
**Confidence:** High

---

## F-t2-duplication-4: Field allowlist filtering duplicated between sprint-local and sprint-batch-handlers
**Severity:** Medium
**Category:** Copy-Paste
**Location:** `src/main/handlers/sprint-local.ts:~86-96`, `src/main/handlers/sprint-batch-handlers.ts:~26-59`
**Evidence:** Identical for-loop pattern filtering patch objects through `UPDATE_ALLOWLIST` / `GENERAL_PATCH_FIELDS`. The filtering logic (loop over keys, check inclusion, build new object) appears twice with different constant names but the same structure.
**Impact:** If validation logic changes (e.g., log rejected fields for debugging, add field-level type coercion), two files need updating in sync. The two implementations can drift when one is updated without updating the other.
**Recommendation:** Extract to `src/main/lib/patch-validation.ts` with `validateAndFilterPatch(patch, allowlist, logger?)` utility. Both handlers import and call it.
**Effort:** S
**Confidence:** High

---

## F-t2-duplication-5: Zustand async fetch pattern repeated across 30+ stores
**Severity:** Medium
**Category:** Missing Abstraction
**Location:** All stores in `src/renderer/src/stores/` — `sprintTasks.ts`, `agentHistory.ts`, `costData.ts`, `dashboardData.ts`, `promptTemplates.ts`, and ~25 others
**Evidence:** Every store implements the same try-catch-set boilerplate:
```typescript
fetch: async () => {
  set({ loading: true })
  try {
    const data = await window.api.getData()
    set({ data, loading: false })
  } catch (err) {
    set({ error: String(err), loading: false })
  }
}
```
The pattern is structurally identical across 30 stores with different field names.
**Impact:** 30+ files of near-identical boilerplate. Inconsistent error handling (some stores set `error` as string, others as boolean, others don't set it at all). Bug fixes (e.g., adding retry logic) won't propagate. New stores will continue copying the pattern.
**Recommendation:** Create `src/renderer/src/lib/createAsyncSlice.ts` — a factory function that generates the `{ data, loading, error, fetch }` slice for a given IPC call. All stores call `createAsyncSlice(window.api.getData)` and get consistent behavior.
**Effort:** M
**Confidence:** High

---

## F-t2-duplication-6: Handler registration boilerplate in all 25+ handler files
**Severity:** Medium
**Category:** Missing Abstraction
**Location:** All files in `src/main/handlers/`
**Evidence:** Every handler file starts with identical structure:
```typescript
export function register*Handlers(deps: *Deps): void {
  const effectiveRepo = deps.repo ?? createSprintTaskRepository()
  safeHandle('channel:1', async () => { ... })
  safeHandle('channel:2', async () => { ... })
}
```
The `effectiveRepo` fallback pattern appears in most handler files independently.
**Impact:** The `effectiveRepo` fallback pattern is a sign that dependency injection is not fully applied — each file reinvents the "use injected or create default" logic. If the repository creation logic changes, 25 files need updating.
**Recommendation:** Fully commit to dependency injection — the `deps.repo` should always be provided at registration time (enforced by the type as non-optional). Remove the `?? createSprintTaskRepository()` fallbacks from individual handler files. Centralize default repo creation in `src/main/index.ts`.
**Effort:** M
**Confidence:** Medium

---

## F-t2-duplication-7: Terminal status membership check in three service files
**Severity:** Medium
**Category:** Copy-Paste
**Location:** `src/main/services/task-terminal-service.ts`, `src/main/services/dependency-service.ts` (or `epic-dependency-service.ts`), `src/main/data/sprint-queries.ts`
**Evidence:** Multiple files independently check `if (!TERMINAL_STATUSES.has(status))` or equivalent. The `TERMINAL_STATUSES` set or equivalent array may be defined in more than one place.
**Impact:** When a new terminal status is added (e.g., a new finalization state), multiple files need updating. If one is missed, terminal detection is inconsistent across the app.
**Recommendation:** Ensure `TERMINAL_STATUSES` and `isTerminalStatus()` are defined exactly once in `src/shared/task-transitions.ts` (already exists). All files import from that single source. Remove any local redefinitions.
**Effort:** S
**Confidence:** High

---

## F-t2-duplication-8: Git command execution pattern varies across completion, review, worktree files
**Severity:** Medium
**Category:** Structural Duplication
**Location:** `src/main/agent-manager/completion.ts`, `src/main/agent-manager/worktree.ts`, `src/main/git-operations.ts`, and review handler files
**Evidence:** Different error handling approaches around git commands: some modules throw, others return `{ok: false}`, some log internally, others propagate. `buildAgentEnv()` is called in multiple places to set up environment for git commands.
**Impact:** No consistent behavior when git commands fail. Adding logging to all git commands requires changes in multiple files. Retry logic around git network operations is implemented inconsistently.
**Recommendation:** Centralize git command execution in `src/main/lib/git-executor.ts` with a single `runGit(args, cwd, env, logger)` function that handles logging, error normalization, and optional retry. All git-related files use this instead of direct `execFileAsync` calls.
**Effort:** M
**Confidence:** Medium

---

## F-t2-duplication-9: Elapsed time tracking hook duplicated in TaskRow and TaskPill
**Severity:** Low
**Category:** Missing Abstraction
**Location:** `src/renderer/src/components/sprint/TaskRow.tsx:~18-22`, `src/renderer/src/components/sprint/TaskPill.tsx:~53-73` (or similar component files)
**Evidence:** Both components implement elapsed time tracking using `useBackoffInterval()` at 10,000ms interval. The implementations differ slightly (tick state vs elapsed state) but serve the same purpose.
**Impact:** When the refresh interval needs changing, two components must be updated. The slight implementation differences may cause inconsistent display behavior.
**Recommendation:** Extract `useElapsedTime(startedAt: string | null)` custom hook in `src/renderer/src/hooks/useElapsedTime.ts`. Both components use the same hook.
**Effort:** S
**Confidence:** Medium

---

## Summary

| Finding | Severity | Effort | Category |
|---------|----------|--------|----------|
| F-t2-duplication-1 | Medium | S | Copy-Paste |
| F-t2-duplication-2 | High | M | Structural Duplication |
| F-t2-duplication-3 | High | M | Structural Duplication |
| F-t2-duplication-4 | Medium | S | Copy-Paste |
| F-t2-duplication-5 | Medium | M | Missing Abstraction |
| F-t2-duplication-6 | Medium | M | Missing Abstraction |
| F-t2-duplication-7 | Medium | S | Copy-Paste |
| F-t2-duplication-8 | Medium | M | Structural Duplication |
| F-t2-duplication-9 | Low | S | Missing Abstraction |

**Root cause pattern:** No shared library conventions. Developers discover utilities are needed and implement them locally rather than finding or creating a central location. Quick wins: async-utils, patch-validation, isTerminalStatus, useElapsedTime (all S effort).
