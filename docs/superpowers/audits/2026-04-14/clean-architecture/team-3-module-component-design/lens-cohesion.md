# Module Cohesion Audit — 2026-04-14

## Executive Summary

The BDE codebase demonstrates **strong structural cohesion** overall. The agent-manager subsystem is well-decomposed into focused modules (drain-loop, watchdog, completion, worktree, etc.), and the data layer maintains clear separation between query builders and domain logic. However, **five significant cohesion issues** warrant attention: (1) completion.ts mixes independent concerns (git rebase, PR creation, auto-merge evaluation) across 472 lines, (2) github-fetch.ts bundles rate-limiting state with pagination helpers, (3) the shared type barrel re-exports import bloat by re-exporting ~40 unrelated type definitions from a 168-line index file, (4) the main entry point (index.ts) orchestrates 15+ subsystems directly rather than delegating to a startup coordinator, and (5) worktree.ts couples worktree creation/cleanup with disk-space and file-lock state management. These are addressable through focused refactoring without architectural overhaul.

---

## F-t3-cohesion-1: Completion lifecycle mixes success, failure, and auto-merge concerns

**Severity:** High
**Category:** Module Cohesion
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:1-472`
**Evidence:** 472 LOC spanning 5 independent workflows: (1) agent exit resolution (lines 98–168), (2) commit verification (lines 135–168), (3) rebase orchestration (lines 324–345), (4) PR creation for review transition (lines 234–243), and (5) auto-merge policy evaluation (lines 170–228). Each flows through its own error handling and retry logic.
**Impact:** **High**. Any change to the auto-merge policy or PR creation process requires understanding success/failure resolution paths. The file becomes a "god module" for task completion, hiding the fact that rebase and auto-merge are optional post-processing steps separate from the core "transition to review" workflow. Tests must cover all permutations of these semi-independent flows.
**Recommendation:** Split into three focused modules: (a) `resolve-completion.ts` (success/failure status transitions and retry logic), (b) `auto-merge-coordinator.ts` (auto-merge evaluation and invocation), (c) `review-transition-orchestrator.ts` (rebase + PR creation → review state). Keep completion.ts as a thin dispatcher that sequences these in order.
**Effort:** M
**Confidence:** High

---

## F-t3-cohesion-2: GitHub API client mixes rate-limiting, pagination, and error classification

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `/Users/ryan/projects/BDE/src/main/github-fetch.ts:1-453`
**Evidence:** 452 LOC spanning three semi-independent subsystems: (1) **Rate-limit state management** (lines 38–90) — module-level singleton tracking remaining/limit/resetEpoch, (2) **Retry logic and backoff** (lines 122–214) — exponential backoff with jitter for 403/5xx, and (3) **Pagination helpers** (lines 245–290) — Link header parsing and page iteration. The file also bundles error classification (lines 301–387) and broadcast notification logic (lines 376–387).
**Impact:** **Medium**. Rate-limit state is a cross-cutting concern shared across all github API calls, but pagination is only used by `fetchAllGitHubPages()`. Error classification mixes HTTP error handling with structured error typing. Changes to broadcast semantics or notification thresholds affect the whole module even though pagination callers don't care about rate-limit broadcasts.
**Recommendation:** Split into: (a) `github-rate-limit.ts` (state, header parsing, threshold checks, broadcasts), (b) `github-pagination.ts` (link header parsing, page iteration), (c) keep main `githubFetch()` and error classification in current file but rename to `github-fetch-core.ts`. Have `github-fetch.ts` re-export the composed API.
**Effort:** M
**Confidence:** Medium

---

## F-t3-cohesion-3: Shared type barrel index re-exports 40+ unrelated types without domain separation

**Severity:** Medium
**Category:** Barrel Export Abuse
**Location:** `/Users/ryan/projects/BDE/src/shared/types/index.ts:1-83`
**Evidence:** 83 LOC re-exporting types from 6 domain files (agent-types, task-types, git-types, review-types) with no intermediate interfaces or grouping. Any new domain type gets added here. Consumers import `import type { SprintTask, AgentMeta, OpenPr, ReviewResult } from '../../shared/types'` — mixing 4 unrelated domains in a single import statement.
**Impact:** **Medium**. Scalability issue: the barrel grows linearly with the codebase. More importantly, **implicit coupling**: a consumer that only uses `SprintTask` imports agent, git, and review types into its namespace, violating single responsibility. Future static analysis tools (e.g., dependency cruiser) will struggle to detect over-broad imports because the types are all re-exported from the same barrel.
**Recommendation:** Create domain-scoped barrels: keep current file as a **compatibility layer** for existing code, but add `src/shared/types/agent.ts`, `src/shared/types/task.ts`, `src/shared/types/git.ts`, `src/shared/types/review.ts` that re-export their respective domains. New code should import from domain-specific barrels; existing code can stay on the main index for now. Document the migration path.
**Effort:** M
**Confidence:** Medium

---

## F-t3-cohesion-4: Worktree module couples creation, cleanup, disk-space, and lock semantics

**Severity:** Medium
**Category:** Module Cohesion
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/worktree.ts:1-351`
**Evidence:** 351 LOC spanning: (1) **Worktree lifecycle** (setup, cleanup, stale detection; lines 38–200), (2) **Disk space reservation** (lines 18–35, re-exported from disk-space.ts), (3) **File locking** (lines 26, re-exported from file-lock.ts), and (4) **Git operations delegation** (lines 8–16). The public API exports disk-space and lock functions directly via `export { reserveDisk, releaseDisk, ... }`, making it unclear whether these are auxiliary helpers or core responsibilities.
**Impact:** **Medium**. Callers can't distinguish between core worktree logic and orthogonal concerns (disk space, locking). A function that needs to reserve disk space must import from worktree.ts, coupling it to worktree lifecycle logic even if it has nothing to do with worktrees. Testing worktree creation in isolation requires mocking disk-space and file-lock modules.
**Recommendation:** Keep disk-space and file-lock as standalone modules. Worktree.ts should import and use them internally, but NOT re-export. Callers needing disk-space should import directly from `disk-space.ts`. Add a comment in worktree.ts explaining which concerns are co-located for dependency ordering (disk-space checked before git operations) but logically independent.
**Effort:** S
**Confidence:** High

---

## F-t3-cohesion-5: Main entry point (index.ts) orchestrates 15+ subsystems with scattered initialization

**Severity:** Medium
**Category:** God Module
**Location:** `/Users/ryan/projects/BDE/src/main/index.ts:1-268`
**Evidence:** 268 LOC initiating: database (line 110), logger configuration (lines 27–28), agent manager (lines 142–180), review service (lines 186–242), terminal service (lines 122–140), status server (lines 173–177), tearoff window restoration (line 257), and handler registration (line 252). Logic is procedural rather than delegated. Bootstrap operations are scattered (`startDbWatcher` line 112, `startBackgroundServices` line 115, `initializeDatabase` line 110) with no orchestration layer distinguishing bootstrap phases (DB, services, handlers, UI).
**Impact:** **Medium**. Onboarding new team members requires understanding the initialization order scattered across 150 LOC. Changes to bootstrap phases (e.g., adding OAuth token validation before agent manager) require edits across multiple functions in the same file. The file doesn't read as a composition of concerns; it reads as a procedural script.
**Recommendation:** Extract `createBootstrap()` function that returns an object with methods: `.initDatabase()`, `.startServices()`, `.registerHandlers()`, `.showUI()`. Let index.ts call these in sequence and handle only error logging and process lifecycle (before-quit, will-quit). This separates "what gets initialized" from "when and how," making the startup sequence clearer.
**Effort:** M
**Confidence:** Medium

---

## Additional Observations

### Strong Cohesion Patterns (No Action Needed)

1. **Agent-manager subsystem** (agent-manager/index.ts, drain-loop.ts, watchdog-loop.ts, run-agent.ts) — Each module owns a single concern (drain scheduling, watchdog monitoring, agent spawning). Dependencies are explicit and unidirectional. This is a model for the rest of the codebase.

2. **Data layer separation** (sprint-task-crud.ts, agent-queries.ts, task-group-queries.ts) — Query builders are isolated from domain logic. Mappers (sprint-task-mapper.ts) cleanly separate row↔domain transformations.

3. **Prompt builder decomposition** (prompt-composer.ts, prompt-pipeline.ts, prompt-assistant.ts, etc.) — A registry pattern dispatches to type-specific builders. Adding a new agent type is straightforward and doesn't touch existing builders.

4. **IPC channel modularity** (ipc-channels/*) — Channels are grouped by domain (sprint, agent, git, settings). The index file re-exports them in a typed map. This is intentional barrel design; a type-safe IPC surface is appropriate here.

### Low-Impact Observations

1. **env-utils.ts (356 LOC)** — Mixes OAuth token refresh, CLI path resolution, and process.env augmentation. Acceptable if this is genuinely a "startup utilities" module; consider adding a comment clarifying scope.

2. **agent-history.ts (405 LOC)** — Mixes SQLite queries (delegated to agent-queries.ts) with filesystem I/O (file logs). Each concern is small enough that cohesion is acceptable; this is a reasonable "agent metadata facade."

---

## Conclusion

The codebase is in **good structural health**. The five findings above are refactoring opportunities, not blockers. Prioritize F-t3-cohesion-1 (completion.ts) and F-t3-cohesion-5 (index.ts) first—they directly impact test coverage and onboarding. F-t3-cohesion-4 (worktree.ts re-exports) is a quick win. The others can be deferred until the next cycle.
