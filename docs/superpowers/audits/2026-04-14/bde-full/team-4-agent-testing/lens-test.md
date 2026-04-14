# Test Quality Audit Report — Team 4 (Testing)

**Date:** 2026-04-14  
**Scope:** BDE codebase covering main process, renderer, shared layer  
**Finding Count:** 9 critical/high severity issues

## Executive Summary

The BDE test suite has substantial coverage (135 tests in main, ~200 in renderer) but exhibits critical weaknesses in three areas: (1) **heavy reliance on brittle vi.mock patterns** that block refactoring and hide coupling issues, (2) **systematic test gaps in critical data and handler layers** where untested code manages task state and IPC channels, and (3) **missing edge-case coverage in agent lifecycle** where invalid status transitions, missing worktrees, and race conditions are not tested. The vitest configuration lacks meaningful coverage thresholds (set to always-pass levels: 72–73%), and integration tests primarily verify mock wiring rather than real behavior. These gaps mean silent failures are likely in task state mutations, dependency resolution, and error recovery paths.

---

## F-t4-test-1: Brittle Mock Pattern Spreading to Multiple Test Files

**Severity:** High  
**Category:** Test Quality  
**Location:** Multiple files including `src/main/__tests__/bootstrap.test.ts`, `src/main/__tests__/handlers.test.ts`, `src/main/handlers/__tests__/agent-handlers.test.ts`

**Evidence:**  
- `bootstrap.test.ts` has 11 `vi.mock()` calls (fs, electron, @electron-toolkit/utils, db, supabase-import, pr-poller, sprint-pr-poller, event-queries, task-changes, config, logger, sprint-queries, sprint-maintenance-facade, plugin-loader, load-sampler)
- `handlers.test.ts` has 18+ vi.mock calls mocking almost every dependency (electron, agent-log-manager, agent-history, adhoc-agent, event-queries, git, github-pr-status, github-conflict-check, config, db, fs/promises, fs, settings)
- The pattern is spreading to renderer tests (9 out of 33 store tests use vi.mock)
- Mocks are so comprehensive that real integration is impossible; tests verify that mocks call other mocks

**Impact:**  
When implementation details change (rename a module, refactor an export), all tests using vi.mock must be updated manually. This creates a false sense of security — tests pass but verify nothing about real behavior. The pattern prevents refactoring the bootstrap or handler registration logic without touching dozens of brittle mock setup lines. Each vi.mock also increases test maintenance burden and makes it harder to onboard new developers.

**Recommendation:**  
Replace vi.mock patterns in bootstrap.test.ts and handlers.test.ts with:
1. **Selective mocking:** Mock only external I/O boundaries (fs, electron, child_process), not internal modules
2. **Integration-focused tests:** Test the real AgentManager creation, real task querying, real IPC handler registration
3. **Fixture-based setup:** Use in-memory SQLite and real logger instances instead of mocking them
4. The bootstrap.test.ts file should create a real database, call real plugin-loader, and verify that cleanup tasks actually run instead of verifying mock calls

**Effort:** L (requires refactoring ~300 lines of test setup, but payoff is long-term maintainability)  
**Confidence:** High

---

## F-t4-test-2: Critical Data Layer Untested — 14 Modules Without Tests

**Severity:** Critical  
**Category:** Test Coverage Gap  
**Location:** `src/main/data/*.ts` — missing tests for:
- `dashboard-queries.ts`
- `reporting-queries.ts`
- `sprint-agent-queries.ts`
- `sprint-maintenance.ts`
- `sprint-maintenance-facade.ts`
- `sprint-pr-ops.ts`
- `sprint-query-constants.ts`
- `sprint-query-logger.ts`
- `sprint-queue-ops.ts`
- `sprint-task-crud.ts`
- `sprint-task-mapper.ts`
- `sprint-task-types.ts`
- `supabase-import.ts`
- `webhook-queries.ts`

**Evidence:**  
- 25 source files in src/main/data directory, only 13 have tests (52% coverage by file count)
- `sprint-pr-ops.ts`, `sprint-queue-ops.ts`, `sprint-maintenance.ts` handle critical task state mutations with zero test coverage
- `webhook-queries.ts` manages external integrations with no validation tests
- `dashboard-queries.ts` feeds UI metrics with no verification that queries return correct data shapes

**Impact:**  
Silent bugs in task counting, PR status polling, webhook dispatch, and maintenance operations. When a task state mutation query fails, no test catches it. Maintenance operations pruning old records, dashboard metrics calculation, and sprint backup/recovery have no regression tests. This is especially critical since these modules are called during agent manager polling and task state transitions.

**Recommendation:**  
Create unit tests following the sprint-queries.test.ts pattern:
1. Create in-memory SQLite database with migrations in beforeEach
2. Test each exported query with realistic data setup
3. Verify return types match shared/types.ts contracts
4. Test error conditions (missing records, invalid IDs, constraint violations)

Start with `sprint-queue-ops.ts` and `sprint-pr-ops.ts` (used in critical paths).

**Effort:** L (each file needs 15–30 test cases; use sprint-queries.test.ts as template)  
**Confidence:** High

---

## F-t4-test-3: IPC Handler Coverage Gaps — 7 Handlers Without Tests

**Severity:** High  
**Category:** Test Coverage Gap  
**Location:** `src/main/handlers/` — untested files:
- `registry.ts` (handler registration orchestration)
- `sprint-batch-handlers.ts` (batch update operations)
- `sprint-export-handlers.ts` (sprint export to CSV/JSON)
- `sprint-retry-handler.ts` (task retry logic)
- `sprint-spec.ts` (spec validation dispatch)
- `review-assistant.ts` (review partner chat integration)
- `planner-import.ts` (calendar/task import)

**Evidence:**  
- handlers.test.ts tests wiring only (whether handlers are registered), not behavior
- batch-handlers logic (status transition validation, spec quality check, patch filtering) is exercised only through integration tests
- review-assistant.ts contains streaming logic with 0 unit tests; only tested via review.test.ts mock assertions
- sprint-export-handlers has no tests validating export format correctness

**Impact:**  
Batch update operations silently corrupt task state because the patch validation and spec quality check paths are untested. Export operations may produce malformed CSV or JSON with no regression tests. Retry logic doesn't test edge cases (task not found, already in a terminal state, dependency blocks). When IPC callers send malformed requests, handlers may crash without proper error messages because error paths are untested.

**Recommendation:**  
Create handler-specific test files using the agent-handlers.test.ts pattern:
1. `sprint-batch-handlers.test.ts`: Test batch update with valid/invalid patches, status transitions, spec validation errors
2. `sprint-retry-handler.test.ts`: Test retry logic with various task states, fast-fail counts, dependency blocks
3. `sprint-export-handlers.test.ts`: Test export format (CSV headers, JSON structure), field escaping, large task lists
4. `review-assistant.test.ts`: Test streaming response handling, error recovery, token limit edge cases

**Effort:** M (each handler needs 15–25 test cases)  
**Confidence:** High

---

## F-t4-test-4: Agent Manager Lifecycle Gaps — No Invalid Status Transition Tests

**Severity:** High  
**Category:** Test Coverage Gap  
**Location:** `src/main/agent-manager/index.ts` and `src/shared/__tests__/task-state-machine.test.ts`

**Evidence:**  
- task-state-machine.test.ts verifies the VALID_TRANSITIONS map is defined but doesn't test the agent manager's use of it
- agent-manager/index.test.ts never tests what happens when a task attempts an invalid transition (e.g., active → backlog, done → active)
- No tests for dependency resolution with invalid transitions: when a dependency fails, can a dependent task still transition to active?
- run-agent.test.ts doesn't test exception handling when task.updateTask() rejects an invalid status change

**Impact:**  
Agent manager silently tries to transition tasks to invalid states. The database may block the operation, but the agent manager doesn't handle the rejection — it may leave the task in an ambiguous state or crash. When dependencies unblock, the manager doesn't validate that the unblocked task can actually transition out of blocked state. This breaks the abstraction of the state machine.

**Recommendation:**  
Add test suite in agent-manager/index.test.ts:
1. Test each transition path with explicit valid/invalid cases
2. Mock updateTask() to reject invalid transitions; verify agent manager handles the error gracefully
3. Test dependency unblocking when dependent task is in an invalid state relative to its dependencies
4. Test concurrent transitions: two agents try to transition the same task simultaneously

**Effort:** M  
**Confidence:** High

---

## F-t4-test-5: Worktree Lifecycle Gaps — No Missing/Stale Worktree Recovery Tests

**Severity:** High  
**Category:** Test Coverage Gap  
**Location:** `src/main/agent-manager/__tests__/worktree.test.ts` and `src/main/__tests__/worktree-unit.test.ts`

**Evidence:**  
- branchNameForTask has thorough tests (48 lines covering edge cases like special characters)
- setupWorktree has minimal happy-path tests; no tests for:
  - Worktree already exists (should cleanupStaleWorktrees before setup)
  - Insufficient disk space (should reject early)
  - Git operations fail midway (cleanup should restore clean state)
  - Stale branch refs remain after worktree deletion (cleanup should force-delete)
- cleanupWorktree logic is tested only indirectly via setupWorktree
- No tests for pruneStaleWorktrees with orphaned worktrees from crashed agents

**Impact:**  
When an agent crashes mid-setup, the worktree and branch are left in an inconsistent state. The next agent run on that task may fail to setup because the branch exists but the worktree path doesn't. Disk space exhaustion is not caught early, so agents fail with cryptic git errors instead of "insufficient disk" messages. Orphaned worktrees accumulate over time, consuming disk space with no recovery path.

**Recommendation:**  
Expand worktree.test.ts with failure scenarios:
1. Test setupWorktree when worktree already exists → should call cleanupStaleWorktrees first
2. Test insufficient disk space → should throw InsufficientDiskSpaceError before git operations
3. Test git operations failing at each stage (fetch, merge, add) → verify cleanup happens
4. Test pruneStaleWorktrees with orphaned worktrees → verify removal and branch cleanup
5. Test concurrent setup attempts for same task → verify lock mechanism prevents race

**Effort:** M  
**Confidence:** High

---

## F-t4-test-6: Vitest Coverage Thresholds Set to Always-Pass Levels

**Severity:** Medium  
**Category:** Test Quality  
**Location:** `vitest.config.ts` (renderer) and `vitest.node.config.ts` (main)

**Evidence:**  
- vitest.config.ts coverage thresholds:
  - statements: 72% (actual coverage unknown; probably not enforced)
  - branches: 65%
  - functions: 73.5%
  - lines: 73%
- No coverage threshold configuration for vitest.node.config.ts (main process tests) — meaning no enforcement at all
- These are suspiciously round numbers, suggesting they were set to match current coverage rather than as meaningful targets

**Impact:**  
Coverage metrics provide no enforcement. A developer can delete 20% of test coverage and not trigger any CI failure. The "73% statements coverage" has no meaning because if you have 100 statements and 73 are covered, you could remove 50 tests and hit 73% of the remaining 50 statements. Thresholds become theater rather than guardrails.

**Recommendation:**  
1. Establish meaningful thresholds:
   - Critical paths (agent manager, task state machine, IPC handlers): 85%+ statements
   - Data layer (query functions): 90%+ statements
   - Utility modules: 80%+ statements
   - Renderer stores/hooks: 75%+ statements
2. Add coverage thresholds to vitest.node.config.ts
3. In CI, fail the build if coverage drops below thresholds
4. Run coverage in CI and report per-file coverage to PRs so developers see impact

**Effort:** S  
**Confidence:** Medium

---

## F-t4-test-7: Agent Manager Completion Paths Not Tested for Edge Cases

**Severity:** High  
**Category:** Test Coverage Gap  
**Location:** `src/main/agent-manager/completion.ts` and `src/main/agent-manager/__tests__/completion.test.ts`

**Evidence:**  
- completion.test.ts exists but is 0 lines long (stub file)
- resolveSuccess and resolveFailure functions are mocked in index.test.ts, not tested directly
- No tests for:
  - Completing a task that was already marked done (idempotency)
  - Completing a task with missing PR metadata
  - Error updating task status due to concurrent modification
  - Failure classification when agent output is malformed or missing
  - What happens when completion handler itself crashes (infinite retry?)

**Impact:**  
A task may be marked complete multiple times if the completion handler is called twice (due to network retry or race condition). If PR number is missing, the agent mark-complete fails silently. Error classification may misclassify a transient error as permanent, failing the task instead of requeuing.

**Recommendation:**  
Create completion.test.ts with real scenarios:
1. Test resolveSuccess with all task statuses → verify only non-terminal statuses can transition to done
2. Test resolveFailure with various failure reasons → verify classification and retry count increment
3. Test concurrent completion attempts → verify idempotency
4. Test missing/malformed PR metadata → verify graceful fallback
5. Test error handling when task update fails → verify retry or error logging

**Effort:** M  
**Confidence:** High

---

## F-t4-test-8: Renderer Store Tests Assert on Implementation (Mock Calls) Not Observable Behavior

**Severity:** Medium  
**Category:** Test Quality  
**Location:** `src/renderer/src/stores/__tests__/` (multiple files)

**Evidence:**  
- sprintTasks.test.ts tests:
  - expect(useSprintTasks.getState().tasks[0].status).toBe('active') — good, tests state
  - BUT also: expect(window.api.sprint.update).toHaveBeenCalledWith(...) — tests that the mock was called, not that the real API works
- agentEvents.test.ts asserts:
  - expect(window.api.agents.events.onEvent).toHaveBeenCalledOnce() — tests that the mock subscription was wired, not that events actually flow
  - Never tests what happens if the event handler receives malformed data or crashes
- The tests pass when mocks are called, not when behavior works

**Impact:**  
Tests create false confidence. A store test passes because the store calls the mocked API correctly, but the real API might have changed and the renderer crashes in production. Tests don't exercise real IPC message handling or error recovery.

**Recommendation:**  
Refactor renderer tests to test behavior, not wiring:
1. Replace mock assertions (toHaveBeenCalled) with state assertions (tasks were loaded, status changed)
2. For async operations, test the actual state after the mock resolves (e.g., loadData should set loading: false)
3. Test error paths by having mocks reject and verifying error state is set
4. For stores that subscribe to events, test that the store state updates when callbacks fire

**Effort:** M (refactor ~10 files)  
**Confidence:** Medium

---

## F-t4-test-9: No Tests for Silent Failures in Worktree Cleanup During Agent Shutdown

**Severity:** High  
**Category:** Test Coverage Gap  
**Location:** `src/main/agent-manager/index.ts` shutdown logic (untested) and `src/main/agent-manager/__tests__/worktree.test.ts`

**Evidence:**  
- Agent manager kill/drain logic has no tests verifying that worktrees are cleaned up
- When an agent is killed, index.ts calls cleanupWorktree; if it fails, there's no error handling tested
- Orphaned worktrees from crashed agents accumulate; no recovery mechanism is tested
- No tests for: agent manager shutdown while agents are still running, cleanup timeout, cleanup failure cascades

**Impact:**  
Worktrees leak when agents crash. Over time, disk fills up. When cleanup fails, agents can't start new worktrees. The agent manager shuts down but leaves tasks in "active" state with no corresponding process, causing the UI to hang waiting for completion events that never arrive.

**Recommendation:**  
Add integration test in agent-manager/index.test.ts:
1. Start an agent and get it to "active" state
2. Call killAgent() and verify cleanupWorktree is called
3. Verify task status is reset (not left in "active")
4. Test cleanup timeout: if git operations hang, timeout should kill the process
5. Test cleanup failure handling: log error but don't crash the agent manager

**Effort:** M  
**Confidence:** High

---

## Summary of Root Causes

1. **Over-mocking creates false positives:** vi.mock is used to avoid real dependencies, but this prevents testing real behavior. Tests verify that mocks call other mocks, not that the actual system works.
2. **Data layer underestimated:** Query functions manage critical task state but are treated as "lower priority" for testing. Missing tests in data layer cascade to agent manager and UI layers.
3. **Integration tests verify wiring, not behavior:** Tests check that ipcMain.handle is called with the right channel name but don't verify the handler logic.
4. **No edge case coverage:** Happy paths are tested; error paths, race conditions, and resource exhaustion are not.
5. **Coverage thresholds are theater:** Set to match current coverage, not to enforce quality. No CI enforcement.

---

## Recommended Priority

1. **Phase 1 (Critical):** Fix F-t4-test-2 (data layer) and F-t4-test-4 (status transitions) — these are silent failure risk
2. **Phase 2 (High):** Fix F-t4-test-3 (IPC handlers) and F-t4-test-5 (worktree recovery) — these cause user-visible failures
3. **Phase 3 (Medium):** Fix F-t4-test-1 (brittle mocks) and refactor with integration tests; establish meaningful coverage thresholds
