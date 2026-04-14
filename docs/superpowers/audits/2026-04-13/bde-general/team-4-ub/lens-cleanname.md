# Clean Code Naming Quality Audit — Team 4 (Uncle Bob)

## Summary

The BDE codebase demonstrates **inconsistent naming discipline** across several domains. While infrastructure code (agent-manager, data-access) generally uses intention-revealing names, systematic naming issues emerge around abbreviations in tests and handlers, magic numbers without documented constants, and vague type names like `result` and `val` in utility functions. The most impactful issue is scattered single-letter and two-letter variable abbreviations in test setup (`m`, `cb`, `p`, `s`, `n`, `b`) that reduce readability despite domain-specific contexts where single letters might be acceptable (loops, mathematical formulas). Database configuration field names (`p_url`, `pr_url` inconsistency) and inconsistent naming across `rebaseNote`/`rebaseBaseSha` vs `rebaseSucceeded` boolean naming further complicate maintenance.

---

## F-t4-cleanname-1: Abbreviations in Test and Type-Casting Code

**Severity:** Medium  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/turn-tracker.ts:19, 42`; `src/main/agent-manager/sdk-adapter.ts:51`; `src/shared/review-service.ts:75, 94`; and dozens of test files  
**Evidence:**  
```typescript
// turn-tracker.ts:19
const m = msg as Record<string, unknown>

// turn-tracker.ts:42
const b = block as Record<string, unknown>

// sdk-adapter.ts:51
const val = sdkMsg[field]

// review-service.ts:75, 94
const v = value as Record<string, unknown>
const f = entry as Record<string, unknown>
```

**Impact:** Single-letter and two-letter variable names (`m`, `b`, `val`, `v`, `f`, `c`, `p`, `s`, `n`, `cb`, `err`, `msg`) obscure intent. Readers must trace backwards to understand "what is `m`?" or "what does `b` represent?". In production code (non-loop, non-test contexts), these violate Uncle Bob's intention-revealing names principle.

**Recommendation:** Rename to **intention-revealing names**:
- `m` → `messageObj` or `msgData`
- `b` → `contentBlock`
- `val` → `fieldValue`
- `v` → `parsedValue`
- `f` → `fileEntry`
- `c` → use full context name (e.g., `charCode`, `char`)
- `p` → use full name (e.g., `promise`, `payload`)
- `s` → use full name (e.g., `state`, `string`)
- `n` → use full name (e.g., `maxSlots`, `count`)

**Effort:** M  
**Confidence:** High

---

## F-t4-cleanname-2: Inconsistent Boolean Field Naming Patterns

**Severity:** Medium  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/completion.ts:58-87`; `src/renderer/src/stores/sprintUI.ts:70-72`  
**Evidence:**  
```typescript
// completion.ts — inconsistent pattern for state booleans
interface TransitionToReviewOpts {
  rebaseSucceeded: boolean    // ✓ is* prefix
  rebaseNote: string | undefined  // ✗ No prefix — misleading, might be bool
}

// sprintUI.ts — all drawers named consistently, but pattern is "verb" not "is*"
drawerOpen: boolean         // ✓ adjective
specPanelOpen: boolean      // ✓ adjective
doneViewOpen: boolean       // ✓ adjective
healthCheckDrawerOpen: boolean  // ✓ adjective
```

**Impact:** Mixing boolean naming conventions (`rebaseSucceeded` vs `drawerOpen` vs `atFloor`) forces readers to check type definitions to understand field semantics. Fields named with verbs (Open/Succeeded) work, but **fields named as nouns with unclear intent are dangerous**. Example: in `concurrency.ts:9`, `atFloor` is unclear — does it mean "at minimum value" or "floor exists"?

**Recommendation:**
1. **Standardize boolean prefix** across the codebase: `is*`, `has*`, `should*`, or `can*` (or use adjectives like `Open`, `Succeeded`)
2. Rename unclear booleans:
   - `atFloor` → `isAtMinimumSlots` or `isAtConcurrencyCeiling`
   - `drawerOpen` (OK) → Consistent with `panelOpen`, `viewOpen` pattern
3. Document the chosen convention in `CLAUDE.md`

**Effort:** M  
**Confidence:** Medium (codebase is currently functional, but maintenance cost is high)

---

## F-t4-cleanname-3: Magic Numbers Without Named Constants in Configuration

**Severity:** High  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/types.ts:31-34` and scattered across services  
**Evidence:**  
```typescript
// types.ts — good: constants are named
export const DEFAULT_CONFIG: AgentManagerConfig = {
  maxConcurrent: 2,
  maxRuntimeMs: 60 * 60 * 1000,      // OK: calc is obvious
  idleTimeoutMs: 15 * 60 * 1000,     // OK: calc is obvious
  pollIntervalMs: 30_000,             // ✓ named constant
}

// But elsewhere — bad magic numbers without constants
// handlers/review.ts:62
maxBuffer: 10 * 1024 * 1024  // What is 10MB? Document as constant

// run-agent.ts:59-60
const MAX_PLAYGROUND_SIZE = 5 * 1024 * 1024  // ✓ Good
const MAX_PARTIAL_DIFF_SIZE = 50 * 1024      // ✓ Good

// prompt-composer.ts:248
const MAX_DIFF_CHARS = 2000  // ✓ Good
// BUT also:
const MAX_TASK_CONTENT_CHARS = 8000   // ✓ Good
const MAX_HISTORY_TURNS = 10          // ✓ Good
// And yet:
const MIN_PROMPT_LENGTH = 200         // ✓ Good
```

**Impact:** Hardcoded `10 * 1024 * 1024` in `review.ts:62` is inconsistent with the pattern of explicit `MAX_*` constants. Readers must infer "this is the diff buffer size"; if it needs to change, they must search for all `10 * 1024 * 1024` occurrences.

**Recommendation:**
1. Extract all inline buffer/size calculations to named constants in `types.ts` or module-level:
   ```typescript
   // In handlers/review.ts (module scope)
   const DIFF_BUFFER_SIZE_BYTES = 10 * 1024 * 1024
   ```
2. Consolidate all "max length" / "max size" constants to a single `constants.ts` or module config object
3. Document what each constant represents (e.g., "10MB buffer to accommodate large diffs")

**Effort:** M  
**Confidence:** High

---

## F-t4-cleanname-4: Vague Variable Names in Database Query Results

**Severity:** Medium  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/data/sprint-queries.ts:66-90`; `src/main/agent-manager/turn-tracker.ts:17-28`  
**Evidence:**  
```typescript
// sprint-queries.ts:66 — good: context is clear
export function mapRowToTask(row: Record<string, unknown>): SprintTask {
  let revisionFeedback: unknown = row.revision_feedback  // ✓ clear intent
  // ...
  return {
    ...row,
    depends_on: sanitizeDependsOn(row.depends_on),
    tags: sanitizeTags(row.tags),
  }
}

// BUT: utility function using generic 'row'
export function withErrorLogging<T>(operation: () => T, fallback: T, operationName: string): T {
  try {
    return operation()  // ✓ OK
  } catch (err) {
    const msg = getErrorMessage(err)  // ✓ clear
    logger.warn(`[sprint-queries] ${operationName} failed: ${msg}`)
    return fallback
  }
}

// turn-tracker.ts — moderate intent
processMessage(msg: unknown): void {
  if (typeof msg !== 'object' || msg === null) return
  const m = msg as Record<string, unknown>  // ✗ abbreviates to 'm'
  // ...
  const message = m.message as Record<string, unknown> | undefined
  const usage = (message?.usage ?? m.usage) as Record<string, unknown> | null | undefined
  // ✗ 'usage' and 'message' are nested properties but 'm' obscures this
```

**Impact:** `m` (from `msg`) is a three-letter abbreviation that duplicates nearby `message` and `usage` variables. Maintaining nested object structures becomes harder when the root is abbreviated.

**Recommendation:** Rename:
- `m` → `messageData` or `msgPayload` (to distinguish from `message` which is a nested field)
- Consider renaming for clarity:
  ```typescript
  const messagePayload = msg as Record<string, unknown>
  const messageContent = messagePayload.message as Record<string, unknown> | undefined
  const messageUsage = (messageContent?.usage ?? messagePayload.usage) as Record<string, unknown>
  ```

**Effort:** S  
**Confidence:** High

---

## F-t4-cleanname-5: Inconsistent Naming of Dependency Checking Callbacks

**Severity:** Low  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/index.ts:670-740` and `src/main/agent-manager/orphan-recovery.ts`  
**Evidence:**  
```typescript
// index.ts:670 — callback named with shorthand
await recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger)

// index.ts:738 — same pattern but slightly different context
(id: string) => this._activeAgents.has(id),

// orphan-recovery.ts — function signature unclear about callback intent
export function recoverOrphans(
  isActiveAgent: (id: string) => boolean,  // ✓ Intent-revealing
  repo: ISprintTaskRepository,
  logger: Logger
): Promise<void>
```

**Impact:** Inline lambda callbacks are reasonably clear, but the pattern of passing predicate functions could be documented more explicitly. The function name `isActiveAgent` is excellent, but callers sometimes pass different predicates (checking if agent is review task, etc.) making the interface less obvious.

**Recommendation:**
1. Rename callback parameter to be more explicit:
   ```typescript
   // Current: implicit that we're checking active agents
   recoverOrphans((id: string) => this._activeAgents.has(id), ...)
   
   // Better: extract to named function with clear intent
   const isAgentActive = (id: string) => this._activeAgents.has(id)
   await recoverOrphans(isAgentActive, this.repo, this.logger)
   ```
2. Add JSDoc clarifying callback contract

**Effort:** S  
**Confidence:** Low (this is more of a "nice-to-have" improvement)

---

## F-t4-cleanname-6: Prefix/Suffix Inconsistency in Query/Handler Naming

**Severity:** Low  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/handlers/review.ts:48-100`; `src/main/data/` directory  
**Evidence:**  
```typescript
// handlers/review.ts — handlers use verb pattern
safeHandle('review:getDiff', async (_e, payload) => { ... })      // getDiff ✓
safeHandle('review:getCommits', async (_e, payload) => { ... })   // getCommits ✓
safeHandle('review:mergeLocally', async (_e, payload) => { ... }) // mergeLocally ✗ no "get"

// handlers/sprint-batch-handlers.ts — similarly inconsistent
safeHandle('sprint:batchUpdate', async (_e, operations) => { ... })   // batchUpdate
safeHandle('sprint:batchDelete', async (_e, operations) => { ... })   // batchDelete (inferred)

// data/ directory — query functions are clear
export function getTaskRuntimeStats(taskId: string): TaskRuntimeStats
export function getDoneTodayCount(): number
export function getFailureReasonBreakdown(): FailureReasonBreakdown
```

**Impact:** Inconsistency is minor here because verb patterns (`getDiff`, `mergeLocally`) are still clear. However, handlers don't follow a uniform pattern (some start with `get`, some don't). Query functions in data/ are consistent.

**Recommendation:** Document the naming convention:
- **Data queries**: Always start with `get*` (e.g., `getTask`, `getFailureReasonBreakdown`)
- **Data mutations**: Start with `update*`, `delete*`, `create*`, `merge*` (no `get`)
- **IPC handlers**: Same pattern, name reflects the operation not the HTTP verb

**Effort:** S  
**Confidence:** Low (minor inconsistency)

---

## F-t4-cleanname-7: Noise Words in Type and Utility Names

**Severity:** Medium  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/agent-manager/types.ts:55-92`; `src/main/services/`  
**Evidence:**  
```typescript
// types.ts — noise word examples
export interface SteerResult {
  delivered: boolean
  error?: string
}

export interface ActiveAgent {
  taskId: string
  agentRunId: string
  handle: AgentHandle
  // ... 10+ fields
}

// AgentManager interface — multiple "Manager" suffix
export interface AgentManager {
  start(): void
  stop(timeoutMs?: number): Promise<void>
  // ...
}

// Services with broad "Service" suffix
// review-service.ts → ReviewService
// sprint-service.ts → SprintService
// review-orchestration-service.ts → ReviewOrchestrationService
```

**Impact:** Interface names like `ActiveAgent` and `AgentManager` are **not** noise — they clearly distinguish the concept. However, `SteerResult` should be `SteerOutcome` or `SteerResponse` to be more intention-revealing. The broad "Service" suffix on service classes is standard in this codebase and doesn't violate naming principles.

**Recommendation:**
1. Rename `SteerResult` → `SteerOutcome` (or `SteerResponse`) to clarify it's the outcome of steering, not a generic "result"
2. Document why "Manager" and "Service" suffixes are used (they provide cohesion, which is valid per Uncle Bob)

**Effort:** S  
**Confidence:** Medium (stylistic improvement, low risk)

---

## F-t4-cleanname-8: Inconsistent Field Name Conventions Across Database Schema

**Severity:** Low  
**Category:** Naming Quality (Uncle Bob)  
**Location:** `src/main/data/sprint-queries.ts:95-133`; `src/shared/types/task-types.ts`  
**Evidence:**  
```typescript
// sprint-queries.ts — UPDATE_ALLOWLIST shows schema inconsistencies
export const UPDATE_ALLOWLIST = new Set([
  'title',          // ✓ lowercase
  'pr_url',         // ✓ snake_case
  'pr_number',      // ✓ snake_case
  'pr_status',      // ✓ snake_case
  'pr_mergeable_state',  // ✓ snake_case, but long
  'agent_run_id',   // ✓ snake_case
  'playground_enabled',  // ✓ snake_case + adjective
  'needs_review',   // ✓ snake_case + verb (intentional)
  'max_runtime_ms', // ✓ snake_case + unit suffix
  'spec_type',      // ✓ snake_case
  'max_cost_usd',   // ✓ snake_case + unit suffix
  'session_id',     // ✓ snake_case
  'review_diff_snapshot'  // ✓ snake_case
])
```

**Impact:** Field naming is **consistent** (all snake_case), but lacks semantic consistency:
- Why `pr_mergeable_state` (verbose) vs `pr_status` (concise)?
- `playground_enabled` and `needs_review` mix boolean prefixes awkwardly

**Recommendation:**
1. Establish a schema naming guide:
   - Adjectives: `*_enabled`, `*_required` (e.g., `playground_enabled`)
   - Booleans: `needs_*` or `is_*` (e.g., `needs_review`, `is_active`)
   - Foreign keys: `{resource}_id` (e.g., `agent_run_id`)
   - States: `*_state` or `*_status` (pick one)
2. Rename for consistency: `pr_mergeable_state` → `pr_merge_status` to match `pr_status`

**Effort:** M (requires database migration)  
**Confidence:** Low (this is mostly documentation, current names are functional)

---

## Summary Table

| Finding | Severity | Category | Effort |
|---------|----------|----------|--------|
| F-t4-cleanname-1: Abbreviations in tests/utilities | Medium | Abbreviations | M |
| F-t4-cleanname-2: Inconsistent boolean naming | Medium | Boolean Naming | M |
| F-t4-cleanname-3: Magic numbers without constants | High | Magic Numbers | M |
| F-t4-cleanname-4: Vague query result variables | Medium | Intention-Revealing | S |
| F-t4-cleanname-5: Dependency callback naming | Low | Naming Patterns | S |
| F-t4-cleanname-6: Handler/query prefix inconsistency | Low | Consistency | S |
| F-t4-cleanname-7: Noise words in types | Medium | Noise Words | S |
| F-t4-cleanname-8: Database field naming conventions | Low | Consistency | M |

## Next Steps

1. **Immediate (High Impact):** Fix F-t4-cleanname-3 (magic numbers) and F-t4-cleanname-1 (abbreviations in production code)
2. **Short-term:** Standardize boolean naming (F-t4-cleanname-2) and document conventions in CLAUDE.md
3. **Long-term:** Consider F-t4-cleanname-8 (database schema cleanup) as part of a larger refactor cycle

