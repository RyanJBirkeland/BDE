# Type System Audit: Team 3 Shared Module
**Date:** 2026-04-13  
**Scope:** `/src/shared/types/`, `/src/shared/ipc-channels/`, shared validation and runtime logic  
**Total Findings:** 6

---

## F-t3-type-1: SprintTask God Interface — 46 Fields Across 6 Semantic Concerns
**Severity:** High  
**Category:** God Interface, Interface Segregation Violation  
**Location:** `src/shared/types/task-types.ts:55-111`

**Evidence:**
SprintTask interface has 46 fields (including optional fields) spanning multiple concerns:
- **Task Core** (11 fields): id, title, repo, prompt, notes, spec, status, priority, timestamps, retry counters
- **Agent Execution** (6 fields): agent_run_id, started_at, completed_at, duration_ms, max_runtime_ms, status
- **PR/Review** (7 fields): pr_number, pr_status, pr_url, pr_mergeable_state, needs_review, claimed_by, status
- **Template/Spec** (3 fields): template_name, spec_type, spec
- **Dependency/Planning** (3 fields): depends_on, group_id, sprint_id, next_eligible_at
- **Debugging/Metadata** (7 fields): worktree_path, session_id, branch, rebase_base_sha, rebased_at, cross_repo_contract, max_cost_usd
- **Audit/History** (3 fields): revision_feedback, review_diff_snapshot, failure_reason

The `status` field itself bridges 3 semantic groups. Optional fields vary by lifecycle stage, forcing all consumers to handle irrelevant states.

**Impact:**
- **Coupling Cost:** Any new lifecycle feature (e.g., release gates, notifications) adds fields to an already-bloated interface, expanding the blast radius.
- **Cognitive Load:** Developers must understand all 6 concerns even when working on 1 task (e.g., PR authors don't need depends_on; dependency resolvers don't need pr_url).
- **Testing:** Fixtures and mocks must account for 46 fields; even backlog tasks must define pr_* fields as null.
- **Change Risk:** Modifying one concern (e.g., adding `pr_preview_url`) risks breaking unrelated code paths that access SprintTask but ignore PR state.
- **DB Coupling:** All fields roundtrip through the database, forcing schema migrations even for renderer-only UI metadata.

**Recommendation:**
Segregate SprintTask into lifecycle-specific views:
1. **Core Task** (immutable across lifecycle): id, title, repo, created_at, updated_at
2. **TaskStatus View** (status + context): status, next_eligible_at, claimed_by, retry_count, fast_fail_count
3. **TaskExecution View** (agent lifecycle): agent_run_id, started_at, completed_at, duration_ms, exitCode, costUsd, tokensIn/Out
4. **TaskReview View** (PR + review): pr_number, pr_status, pr_url, pr_mergeable_state, needs_review, review_diff_snapshot, revision_feedback
5. **TaskMetadata View** (dev context): spec, spec_type, template_name, tags, notes, prompt, depends_on, group_id, sprint_id
6. **TaskDebug View** (worktree/branch): worktree_path, session_id, branch, rebase_base_sha, rebased_at, cross_repo_contract, max_cost_usd, failure_reason

Re-export a union type `SprintTask = Core & (StatusView | ExecutionView | ReviewView | ...)` from types/index.ts for backward compatibility in IPC channels.

**Effort:** M (breaking change; requires handler adapter layer to assemble views from DB rows)

**Confidence:** High

---

## F-t3-type-2: AgentMeta Conflates Process State with Cost Accounting
**Severity:** Medium  
**Category:** Interface Segregation Violation  
**Location:** `src/shared/types/agent-types.ts:7-40`

**Evidence:**
AgentMeta (24 fields) mixes three semantic groups:
- **Process Identity & Runtime** (8 fields): id, pid, bin, status, logPath, startedAt, finishedAt, exitCode
- **Task Context** (3 fields): repo, repoPath, task, sprintTaskId
- **Cost & Telemetry** (9 fields): model, costUsd, tokensIn, tokensOut, cacheRead, cacheCreate + derived model field
- **Worktree Context** (optional, 2 fields): worktreePath, branch

When a handler needs only "is agent still running?" it must import all cost fields. Dashboard queries that aggregate costUsd must parse full pid/logPath data.

**Impact:**
- **IPC Chatty:** dashboard:completionPerHour broadcasts AgentMeta[] when only {agentId, costUsd, status} is needed.
- **Coupling:** Renderer agents view (cost analytics) hard-depends on process lifecycle fields it never touches.
- **Memory:** Historical agent lists (CLI history) carry stale pid/logPath in every query result.

**Recommendation:**
Split into:
- **AgentProcessMeta**: id, pid, bin, status, logPath, startedAt, finishedAt, exitCode, worktreePath, branch (runtime identity)
- **AgentCostMeta**: id, model, costUsd, tokensIn, tokensOut, cacheRead, cacheCreate (cost accounting, separate query result)
- **AgentTaskBinding**: agentId, sprintTaskId, repo, repoPath, task (linkage, sourced from sprint_task_agents FK)

Export a union type for backward compatibility in IPC: `AgentMeta = AgentProcessMeta & { cost?: AgentCostMeta }`

**Effort:** M

**Confidence:** High

---

## F-t3-type-3: Inconsistent Type Import Patterns in IPC Channels
**Severity:** Medium  
**Category:** Runtime Logic in Type File, Type/Runtime Coupling  
**Location:** `src/shared/ipc-channels/agent-channels.ts:108,112,116`

**Evidence:**
```typescript
export interface CostChannels {
  'cost:summary': {
    args: []
    result: import('../types').CostSummary  // ← inline import()
  }
  'cost:agentRuns': {
    args: [args: { limit?: number }]
    result: import('../types').AgentRunCostRow[]  // ← inline import()
  }
  'cost:getAgentHistory': {
    args: [args?: { limit?: number; offset?: number }]
    result: import('../types').AgentCostRecord[]  // ← inline import()
  }
}
```

All other imports in agent-channels.ts (lines 5-12) use static top-level imports. These three use inline `import()` calls, creating:
- **Inconsistency:** Code reviewer must check if this pattern is intentional (lazy loading? circular dependency workaround?)
- **Obfuscation:** IDE autocomplete and grep workflows are hindered.
- **Maintainability:** Future refactors may miss these types when reorganizing imports.

**Impact:**
- Creates false sense of type safety (TypeScript resolves it fine, but humans reading code see smell).
- Suggests possible circular dependency that was papered over instead of fixed at source.
- Inconsistent style makes diff reviews harder ("why this one and not the others?").

**Recommendation:**
Move inline imports to top-level:
```typescript
import type {
  SpawnLocalAgentArgs,
  SpawnLocalAgentResult,
  AgentMeta,
  AgentEvent,
  AgentManagerStatus,
  MetricsSnapshot,
  CostSummary,          // ← add here
  AgentRunCostRow,      // ← add here
  AgentCostRecord       // ← add here
} from '../types'
```

Then remove inline calls from interface properties. If this causes a circular dependency error, investigate root cause (likely: CostChannels is being imported before it's defined, or types/index.ts is re-exporting something that pulls in agent-channels).

**Effort:** S

**Confidence:** High

---

## F-t3-type-4: Runtime Constant Exported from Type File
**Severity:** Low  
**Category:** Runtime Logic in Type File  
**Location:** `src/shared/types/task-types.ts:187-199`

**Evidence:**
```typescript
// Field allowlist for general task updates
export const GENERAL_PATCH_FIELDS = new Set([
  'title', 'prompt', 'repo', 'spec', 'notes', 'priority',
  'templateName', 'playgroundEnabled', 'maxRuntimeMs', 'model', 'maxCostUsd'
])
```

This is a runtime constant (a JavaScript Set), not a type. It's exported from a module whose name and location suggest it contains only type definitions.

**Impact:**
- **Misleading Location:** Developers looking for "where is the patch field policy defined?" must search in types/ instead of policies/ or handlers/.
- **Bundling:** This constant is bundled with all type imports, even in tree-shaken builds.
- **Confusion:** New contributors assume `task-types.ts` is types-only and miss this policy entirely.

**Recommendation:**
Move to a dedicated constants file or validation module:
- Option A: Create `src/shared/task-patch-policy.ts` with GENERAL_PATCH_FIELDS and any related validators
- Option B: Move to `src/shared/constants.ts` under a `TASK_PATCH` namespace if that file exists
- Then re-export from `types/index.ts` for backward compatibility: `export { GENERAL_PATCH_FIELDS } from './task-patch-policy'`

Keep the comment explaining the field allowlist semantics at the new location.

**Effort:** S

**Confidence:** High

---

## F-t3-type-5: Task State Machine Has Separate Source of Truth from TaskStatus Type
**Severity:** Medium  
**Category:** Type/Runtime Coupling, Architectural Ambiguity  
**Location:** `src/shared/task-state-machine.ts` vs. `src/shared/types/task-types.ts`

**Evidence:**
`task-state-machine.ts` line 18-27 defines TaskStatus as a union:
```typescript
export type TaskStatus =
  | 'backlog' | 'queued' | 'blocked' | 'active' | 'review' 
  | 'done' | 'cancelled' | 'failed' | 'error'
```

Then `task-types.ts` imports and re-exports it:
```typescript
import type { TaskStatus } from '../task-state-machine'
export type { TaskStatus }
```

`task-state-machine.ts` also exports runtime predicates (isTerminal, isFailure, isValidTransition) and state machine rules (VALID_TRANSITIONS as Record<string, Set<string>>). This mixes:
- **Canonical type definition** (TaskStatus union)
- **Business rules** (VALID_TRANSITIONS graph, terminal/failure sets)
- **Validation functions** (isValidTransition, validateTransition)

All three are critical to task lifecycle correctness, but the coupling is indirect:
- IPC channels depend on TaskStatus (via task-types.ts import)
- Handlers depend on validation functions (direct import from task-state-machine)
- State transitions are computed at runtime, not type-checked

**Impact:**
- **Distributed State Machine:** Adding a new status requires changes in 3 places (TaskStatus union, VALID_TRANSITIONS record, isTerminal/isFailure sets), creating skew risk.
- **Unclear Authority:** Is task-state-machine.ts the SSoT for task semantics or just TaskStatus literal values? The comment says "single source of truth for task lifecycle" but imports come from a type file.
- **Inconsistent Assurance:** TypeScript can't check that VALID_TRANSITIONS covers all states in TaskStatus union — must rely on manual review.

**Recommendation:**
Clarify and strengthen coupling:
1. **Define TaskStatus in task-state-machine.ts** (already done)
2. **Export TaskStatus ONLY from task-state-machine.ts** as the SSoT
3. **Re-export from types/index.ts** for IPC (current pattern OK: `export type { TaskStatus } from '../task-state-machine'`)
4. **Add a compile-time check:** Use const assertions to ensure VALID_TRANSITIONS keys and isTerminal sets cover all TaskStatus values:
   ```typescript
   // Assert coverage at module load
   const _checkStatuses: Record<TaskStatus, true> = {
     backlog: VALID_TRANSITIONS['backlog'] !== undefined,
     queued: VALID_TRANSITIONS['queued'] !== undefined,
     // ... all 9 statuses
   }
   ```
5. **Document in task-state-machine.ts** that it is the single source of truth and must be consulted before modifying task lifecycle.

**Effort:** S

**Confidence:** Medium (low risk, high clarity gain)

---

## F-t3-type-6: IPC Channel Map Uses Inline import() for Type Composition
**Severity:** Low  
**Category:** Code Quality, Type Composition Pattern  
**Location:** `src/shared/ipc-channels/index.ts:141-167`

**Evidence:**
The composite IpcChannelMap type is built from 18 inline `import()` calls:
```typescript
export type IpcChannelMap = import('./settings-channels').SettingsChannels &
  import('./git-channels').GitChannels &
  import('./git-channels').PrChannels &
  // ... 15 more imports
```

While this works and avoids circular imports, it's harder to read and maintain than a single intersection type literal.

**Impact:**
- **Readability:** Developers unfamiliar with inline imports may assume this is runtime code.
- **Refactoring:** Reorganizing channel files is risky because the imports are scattered as inline calls, not in a clear import statement.
- **Linting:** Some tools treat inline imports as dynamic and may issue warnings or skip optimization passes.

**Recommendation:**
Extract a type alias at the top of the file:
```typescript
type AllChannels =
  import('./settings-channels').SettingsChannels &
  import('./git-channels').GitChannels &
  // ... rest as-is

export type IpcChannelMap = AllChannels
```

Or, if the module becomes too large, split the composition into logical domain groups and document the organizational principle. This is lower priority than F-t3-type-3 because it's consistent throughout the file and the intent is clear.

**Effort:** S (cosmetic)

**Confidence:** Low (nice-to-have, not a correctness issue)

---

## Summary

### Critical (Fix First)
1. **F-t3-type-1** — SprintTask: 46-field god interface with 6 semantic concerns. Drives interface segregation violations in handlers and renderers.

### High Priority (Fix Soon)
2. **F-t3-type-2** — AgentMeta: Conflates process state with cost accounting. Causes unnecessary coupling in dashboard and history queries.
3. **F-t3-type-3** — Inconsistent import patterns in agent-channels. Suggests hidden circular dependency.

### Medium Priority (Fix When Refactoring)
4. **F-t3-type-5** — Task state machine authority. Clarify SSoT and add compile-time coverage checks.

### Low Priority (Cosmetic)
5. **F-t3-type-4** — Runtime constant in type file. Move to dedicated module for clarity.
6. **F-t3-type-6** — IPC channel map composition style. Extract to named type alias for readability.

---

## Patterns to Watch for in Future Audits
- **Type/DB Coupling:** Fields that are never rendered (e.g., worktree_path in PR view) should not roundtrip through the database.
- **Semantic Bundling:** When a type has 4+ optional fields that vary by lifecycle stage, consider views/discriminated unions.
- **Cost of Coverage:** Each new field in a widely-used type doubles testing burden across all modules that import it.

