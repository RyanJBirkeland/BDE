# Complexity Lens Audit — BDE (2026-04-14)

The BDE codebase demonstrates **good structural discipline** across the inspected files. The majority of functions are well-decomposed, rarely exceeding 50 lines, and nesting depth is generally controlled at 2–3 levels maximum. The architecture explicitly delegates complex logic to focused modules (e.g., `completion.ts` delegates to sub-functions rather than implementing everything inline). However, 5–7 targeted improvements exist in three categories: (1) initialization complexity in the AgentManager startup sequence, (2) oversized context/data objects passed as function parameters, and (3) strategic opportunities to extract comment-driven steps into named functions.

---

## F-t2-complexity-1: AgentManager.start() Mixes Initialization Concerns at Multiple Levels
**Severity:** High
**Category:** Stepdown Rule / Initialization Complexity
**Location:** `src/main/agent-manager/index.ts:418–516`
**Evidence:** The `start()` method spans ~99 lines and performs five distinct initialization phases: (1) state reset, (2) stale claimed_by sweep, (3) orphan recovery setup, (4) dependency index initialization, (5) timer registration, each with its own try-catch. Lines 447–461 initialize `_lastTaskDeps` with a 15-line loop that builds a Map of dependency fingerprints; lines 479–496 register four periodic intervals; lines 499–513 defer the initial drain with orphan recovery. The function mixes high-level orchestration (setting up timers) with mid-level setup (rebuilding indexes) and low-level detail (computing dependency hashes in a loop).
**Impact:** Future maintainers struggle to understand the startup sequence. Changes to orphan recovery timing or index initialization require surgery in the middle of a 99-line function. Tests of individual startup phases require mocking or partial execution. If a regression occurs during startup, the 99-line function makes it harder to isolate which phase broke.
**Recommendation:** Extract five helper methods: `_initializeState()`, `_clearStaleClaimedBy()`, `_initializeDependencyIndex()`, `_registerPeriodicLoops()`, `_scheduleInitialDrain()`. Then `start()` becomes a 5-line orchestration method.
**Effort:** M
**Confidence:** High

---

## F-t2-complexity-2: resolveSuccess() Parameter Overload via Context Objects
**Severity:** Medium
**Category:** Function Signature Complexity
**Location:** `src/main/agent-manager/completion.ts:401–420`
**Evidence:** `resolveSuccess()` accepts a `ResolveSuccessContext` object with 7 fields, then immediately destructures and passes those fields individually to 5 helper functions. Each helper (`detectAgentBranch`, `verifyWorktreeExists`, etc.) receives overlapping subsets of the same data — e.g., `verifyWorktreeExists()` receives taskId, worktreePath, repo, logger, onTaskTerminal (5 params), while `detectAgentBranch()` receives the same 5.
**Impact:** Adding a new field to the context requires updating the interface, the destructuring line, and every helper that now needs that field. The overlapping parameter lists make it unclear which helpers share data dependencies.
**Recommendation:** Pass the context object directly to helpers rather than destructuring and re-fragmenting. Each helper declares the fields it needs as a narrower `Pick<ResolveSuccessContext, ...>`.
**Effort:** M
**Confidence:** Medium

---

## F-t2-complexity-3: hasCommitsAheadOfMain() Mixes Validation, Logic, and Side Effects
**Severity:** Medium
**Category:** Stepdown Rule
**Location:** `src/main/agent-manager/completion.ts:135–168`
**Evidence:** The function spans 34 lines and performs three distinct tasks: (1) run git rev-list to check commit count, (2) if count is 0, call `resolveFailure()` and conditionally call `onTaskTerminal()`, (3) log warnings at two different log levels based on outcome. The function name suggests "check if commits exist" but the implementation also "handles failure" and "triggers terminal callback."
**Impact:** Reusing this logic elsewhere requires executing the side effects. Testing requires stubbing both the git operation AND the terminal handler.
**Recommendation:** Split into `async checkCommitsExist(): Promise<boolean>` (pure git check) and `async handleNoCommits()` (failure resolution + logging). Callers choose whether to trigger side effects.
**Effort:** M
**Confidence:** High

---

## F-t2-complexity-4: AgentManager.start() Defers Initial Drain with Nested Async Chain
**Severity:** Medium
**Category:** Nesting Depth
**Location:** `src/main/agent-manager/index.ts:499–513`
**Evidence:** Lines 499–513 use a `setTimeout` with an IIFE that wraps an async function: `setTimeout(() => { this._drainInFlight = (async () => { try { await recoverOrphans(...) } catch (err) { ... } await this._drainLoop() })().catch(...).finally(...) }, INITIAL_DRAIN_DEFER_MS)`. This creates 3 levels of nesting (setTimeout → async IIFE → try-catch) and makes the deferred orphan recovery + drain sequence hard to read.
**Impact:** Future changes to orphan recovery timing or drain sequencing require unwinding the nested structure.
**Recommendation:** Extract `async _scheduleInitialDrain()` as a named method. `start()` calls it in one line.
**Effort:** S
**Confidence:** High

---

## F-t2-complexity-5: cleanupStaleWorktrees() Deep Error Handling Nesting
**Severity:** Medium
**Category:** Nesting Depth
**Location:** `src/main/agent-manager/worktree.ts:73–150`
**Evidence:** The function spans 78 lines and contains 3 sequential try-catch blocks at the same indentation level, with nested try-catch inside each for fallback strategies. The pattern (try removeWorktreeForce → catch → try rmSync → catch) repeats three times for different cleanup steps.
**Impact:** Adding a new cleanup step or changing fallback logic requires updating multiple error paths. The function is hard to unit-test because each cleanup step is intertwined with error recovery.
**Recommendation:** Extract each step into a named function: `removeWorktreeWithFallback()`, `deleteBranchWithFallback()`. Then `cleanupStaleWorktrees()` becomes a sequence of 3–4 self-contained calls.
**Effort:** M
**Confidence:** High

---

## F-t2-complexity-6: sprint-local.ts Inlines Path-Traversal Regex Without Naming
**Severity:** Low
**Category:** Magic Strings / Validation Clarity
**Location:** `src/main/handlers/sprint-local.ts:157–162`
**Evidence:** The `sprint:readLog` handler validates agentId with an inlined regex: `!/^[a-zA-Z0-9_-]+$/.test(agentId)`. The pattern is not named; its purpose (prevent path traversal) is explained only in a comment.
**Impact:** If validation rules evolve, the regex must be located and updated in each handler. New handlers that need the same validation copy the regex.
**Recommendation:** Extract to `src/main/lib/validation.ts`: `const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/; export function isValidAgentId(id: unknown): boolean`. Import in handlers.
**Effort:** S
**Confidence:** Medium

---

## F-t2-complexity-7: github-fetch.ts Module-Level Singleton State
**Severity:** Low
**Category:** State Mutation / Testability
**Location:** `src/main/github-fetch.ts:45–90`
**Evidence:** Rate-limit state is managed via a module-level singleton object `state: RateLimitState`. Functions mutate it directly. Tests that verify rate-limit behavior must manage global state.
**Impact:** Low impact on current functionality but makes tests brittle and the module harder to parallelize or extend independently.
**Recommendation:** Deferred — wrap state in a factory function for future refactoring when independent rate-limit tracking is needed.
**Effort:** L
**Confidence:** Low
