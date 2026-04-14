# Clean Code Comments & Dead Code Audit
## Lens: Comments and Dead Code (Uncle Bob Ch. 4)
**Date:** 2026-04-13  
**Scope:** src/main/agent-manager, src/main/handlers, src/main/data, src/main/services, src/renderer/src/stores  
**Confidence:** High  
**Total Findings:** 7 (Critical: 1, High: 3, Medium: 3)

---

## F-t1-comments-1: Duplicate Comment Blocks
**Severity:** Medium  
**Category:** Comments  
**Location:** `src/main/agent-manager/run-agent.ts:222-231`  
**Evidence:**
```typescript
/**
 * Phase 1: Validates task content and prepares the agent prompt.
 * Throws if task has no content (early validation failure).
 */
/**
 * Validation phase: verifies the task has executable content.
 * On failure, transitions the task to 'error' status, calls onTaskTerminal,
 * and cleans up the worktree before throwing 'Task has no content'.
 * Has side effects — do NOT call this more than once per task run.
 */
export async function validateTaskForRun(
```
**Impact:** Two JSDoc blocks for the same function create redundancy and confusion about which comment is authoritative. The first is terse, the second comprehensive. Readers must parse both to understand intent.  
**Recommendation:** Delete the first comment block. Keep the comprehensive second block (lines 226-231), which adequately documents side effects and error handling.  
**Effort:** S  
**Confidence:** High

---

## F-t1-comments-2: Audit Trail Reference Comments (F-t3-* Prefixes)
**Severity:** High  
**Category:** Comments  
**Location:** Multiple files (agent-manager/index.ts:114-116, data/sprint-pr-ops.ts:33-36, etc.)  
**Evidence:**
```typescript
// F-t1-sysprof-1/-4: Cache a stable fingerprint alongside the deps array so
// subsequent drain ticks can short-circuit the deep compare via hash equality.
// Exposed via _ prefix for testability (private by convention, not keyword).
_lastTaskDeps = new Map<string, { deps: TaskDependency[] | null; hash: string }>()

// F-t3-audit-trail-5: consolidated error summary so the full set of
// failures is visible in one log entry rather than scattered per-task.
```
**Impact:** Comments contain cryptic identifiers (F-t1-sysprof-1, F-t3-audit-trail-5) that lack context. Without access to external audit documentation, developers cannot understand why this code pattern exists or what optimization it represents. This creates maintenance friction—future refactorings risk breaking unknown constraints.  
**Recommendation:** Convert reference comments into explanation-based comments. Replace `// F-t1-sysprof-1/-4: ...` with descriptive comments explaining the concrete tradeoff. Example: `// Optimization: cache fingerprint hash to short-circuit unchanged-deps comparison on drain ticks. Improves throughput when task dependency sets are stable.`  
**Effort:** M  
**Confidence:** High

---

## F-t1-comments-3: Vague Maintenance Comment
**Severity:** Medium  
**Category:** Comments  
**Location:** `src/main/agent-manager/completion.ts:424-426`  
**Evidence:**
```typescript
  // NOTE: If not auto-merged, do NOT call onTaskTerminal — review is not a terminal status.
  // Do NOT clean up worktree — it stays alive for review.
}
```
**Impact:** Comment warns against behaviors (calling onTaskTerminal, cleanup) that seem intuitive for task completion. Without explanation of *why* review is special, maintainers may accidentally add these calls thinking it's a bug. The comment is procedural ("do not do X") rather than explanatory ("do X because Y").  
**Recommendation:** Add the business logic: `// Review status is not terminal: the task may be revised and re-queued. Preserve the worktree and do not trigger terminal callbacks so downstream systems can re-enqueue the task.`  
**Effort:** S  
**Confidence:** High

---

## F-t1-comments-4: Stale TODO Comment Without Owner
**Severity:** High  
**Category:** TODO / Dead Code  
**Location:** `src/main/services/task-terminal-service.ts:24-26`  
**Evidence:**
```typescript
export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  getGroup: (id: string) => TaskGroup | null
  getGroupsWithDependencies: () => Array<{ id: string; depends_on: EpicDependency[] | null }>
  listGroupTasks: (groupId: string) => SprintTask[]
  getSetting?: (key: string) => string | null
  // TODO F-t1-datalay-4: pass a db.transaction wrapper here to enable cascade atomicity.
  // When provided, the entire cascade cancellation loop is wrapped in a single SQLite transaction.
  runInTransaction?: (fn: () => void) => void
```
**Impact:** TODO references an unresolvable ticket (F-t1-datalay-4). The feature (cascade atomicity via transaction wrapper) is partially implemented (`runInTransaction?` exists but is optional). The comment doesn't clarify status: is this planned, blocked, or intentionally deferred? Developers cannot act on this without deciphering the F-t ticket system.  
**Recommendation:** Either (1) implement the feature and remove the TODO, or (2) document the deferral reason explicitly: `// Optional cascade atomicity: runInTransaction allows wrapping cancellation loops in a single SQLite transaction. Deferred until transaction support is needed at higher scale.` Include acceptance criteria if truly still TODO.  
**Effort:** M  
**Confidence:** High

---

## F-t1-comments-5: Dead Code Pattern — Reference Comments Without Intrinsic Meaning
**Severity:** Critical  
**Category:** Dead Code / Comments  
**Location:** Scattered across codebase (16+ occurrences in agent-manager, data, services modules)  
**Evidence:**
```typescript
// F-t1-sysprof-1/-4: ...
// F-t3-audit-trail-5: ...
// F-t4-lifecycle-5: ...
// F-t3-datalyr-7: ...
// F-t3-model-1: ...
```
**Impact:** Reference comments create a "dead comment layer" — the code contains internal cross-references that are meaningless without external audit documentation. This is a form of implicit coupling: the code depends on external knowledge that is not versioned with it. When that external documentation is lost, updated, or reorganized, these comments become obfuscating noise. Over time, developers learn to ignore them, defeating their purpose.  
**Recommendation:** Establish a policy: all comments must be self-contained. Reference comments (F-t-*) should be replaced with explanatory comments that stand alone. For ongoing audit tracking, use a separate AUDIT.md file in the repo root instead of scattering references in code.  
**Effort:** L  
**Confidence:** High

---

## F-t1-comments-6: Comment Contradicts Code Logic
**Severity:** Medium  
**Category:** Misleading Comments  
**Location:** `src/main/agent-manager/index.ts:483-488`  
**Evidence:**
```typescript
      this.killActiveAgent(agent)

      // Get verdict decision, then apply side effects
      const now = nowIso()
      const maxRuntimeMs = agent.maxRuntimeMs ?? this.config.maxRuntimeMs
      const result = handleWatchdogVerdict(verdict, this._concurrency, now, maxRuntimeMs)
```
**Impact:** Comment says "Get verdict decision" but verdict was already determined in `checkAgent(agent, ...)` at line 469, before the code block. The comment describes a past action as if it's about to happen. Misleading comments like this create cognitive load—readers expect code to match the comment's description.  
**Recommendation:** Update comment to reflect actual sequence: `// Apply side effects of the verdict (update concurrency state, schedule task updates, trigger terminal callback).`  
**Effort:** S  
**Confidence:** Medium

---

## F-t1-comments-7: Journaling Comments (Audit Trail in Code)
**Severity:** Medium  
**Category:** Comments  
**Location:** `src/main/config.ts:7-9, src/main/sprint-pr-poller.ts:12-14`  
**Evidence:**
```typescript
// F-t1-sre-1 / F-t3-model-2: Lowered default from 30 → 14 days. The audit
// found agent_events at 31K rows (~63 events per agent run). The Dashboard
// has O(n) rendering, so truncating the retention window improves UX.

// F-t1-concur-5: Stagger start by half the interval so the sprint PR poller
// doesn't fire in lockstep with the GitHub PR poller (also 60s) and the drain
```
**Impact:** Changelog-style comments embedded in code create two maintenance burdens: (1) keeping both code and comment synchronized, (2) searching comments to find when/why constants changed. This is the opposite of clean code—history belongs in git commits, not comments.  
**Recommendation:** Remove audit trail comments from code. Store rationale in commit messages (`git log`) and optionally a CHANGELOG.md. For constants like `AGENT_EVENTS_RETENTION_DAYS`, add a brief inline comment explaining the business constraint: `const AGENT_EVENTS_RETENTION_DAYS = 14 // Balance: retention vs. O(n) dashboard rendering performance`.  
**Effort:** M  
**Confidence:** Medium

---

## Summary

| Category | Count | Severity Breakdown |
|----------|-------|-------------------|
| Reference Comments (F-t-*) | 5 | 1 Critical, 2 High |
| Duplicate/Vague Comments | 2 | 1 Medium |
| Misleading Comments | 1 | 1 Medium |
| Journaling Comments | 1 | 1 Medium |

**Root Cause:** The codebase uses an external audit framework (F-t-*) for tracking design decisions, but these references are embedded in code instead of segregated. This creates coupling between code and external documentation.

**Recommended Immediate Actions:**
1. Remove the first JSDoc block in run-agent.ts (F-t1-comments-1)
2. Convert F-t-* reference comments to self-contained explanations (F-t1-comments-2, F-t1-comments-5)
3. Clarify the TODO in task-terminal-service.ts with acceptance criteria or deferral rationale (F-t1-comments-4)

**Long-Term Strategy:**
- Establish a code comment policy: no external references without explanation
- Move all audit trail commentary to docs/AUDIT.md or git commit messages
- Use inline comments only for business logic constraints or non-obvious design choices

