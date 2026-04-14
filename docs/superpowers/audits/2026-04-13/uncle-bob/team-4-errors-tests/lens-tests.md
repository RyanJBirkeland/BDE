# Clean Code Test Quality Audit - Team 4 Error Tests

**Date:** 2026-04-13
**Lens:** Uncle Bob's F.I.R.S.T Principles & Chapter 9 Standards
**Auditor:** Claude Code Quality Agent

---

## F-t4-tests-1: Redundant Handler Registration Tests

**Severity:** High
**Category:** Redundant Coverage
**Location:** `src/main/handlers/__tests__/review.test.ts:202-272`
**Evidence:**
```typescript
it('review:getCommits handler is registered', () => {
  const handlers = captureHandlers()
  expect(handlers['review:getCommits']).toBeDefined()
})

it('review:getDiff handler is registered', () => {
  const handlers = captureHandlers()
  expect(handlers['review:getDiff']).toBeDefined()
})

it('review:getFileDiff handler is registered', () => {
  const handlers = captureHandlers()
  expect(handlers['review:getFileDiff']).toBeDefined()
})
// ... repeated 7 more times for remaining handlers
```

**Impact:** These 8 near-identical tests (lines 202-272) test the same behavior: "handler is registered." They add no additional value beyond the first registration test. This bloats the test suite, makes changes brittle (must update 8 identical tests), and obscures the actual functional tests below. The parent test "registers all 12 review channels" at line 162 already validates this with 12 explicit safeHandle calls.

**Recommendation:** Remove individual registration tests. Keep only the comprehensive "registers all 12 review channels" test, which validates all handlers in one test. Move the functional behavior tests (like "review:discard reads branch name before removing worktree") to a separate describe block focused on handler behavior, not registration.

**Effort:** S
**Confidence:** High

---

## F-t4-tests-2: Multiple Independent Behaviors per Test — Drain Loop Tests

**Severity:** High
**Category:** AAA (Arrange-Act-Assert)
**Location:** `src/main/agent-manager/__tests__/index.test.ts:319-346`
**Evidence:**
```typescript
it('claims task, spawns agent, registers in active map', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  const task = makeTask()
  vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
  vi.mocked(claimTask).mockReturnValueOnce(task)
  const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)

  const mgr = createAgentManager(baseConfig, mockRepo, logger)
  mgr.start()
  // Timer advances...
  
  expect(vi.mocked(spawnAgent)).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: expect.stringContaining('Do the thing'),
      cwd: '/tmp/wt/myrepo/task-1',
      model: 'claude-sonnet-4-5'
    })
  )
  expect(vi.mocked(claimTask)).toHaveBeenCalledWith('task-1', 'bde-embedded')
})
```

**Impact:** This single test verifies three distinct behaviors: (1) task claiming, (2) agent spawning with correct parameters, (3) registration in active map (implied). When this test fails, it's unclear which behavior failed. The test name only promises "claims, spawns, registers" but doesn't distinguish responsibilities. This violates the Single Responsibility Principle for tests.

**Recommendation:** Split into three focused tests:
- "claims task from queue"
- "spawns agent with correct prompt and model"
- "registers spawned agent in active map"

Each would have a single assertion target, making failures diagnostic and self-documenting.

**Effort:** M
**Confidence:** High

---

## F-t4-tests-3: Duplicate Setup Between Sequential Tests — Agent Manager Tests

**Severity:** Medium
**Category:** F.I.R.S.T (Independence & Test Isolation)
**Location:** `src/main/agent-manager/__tests__/index.test.ts:319-403`
**Evidence:**
```typescript
// Test 1: lines 319-346
it('claims task, spawns agent, registers in active map', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  const task = makeTask()
  vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
  vi.mocked(claimTask).mockReturnValueOnce(task)
  const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
  // ... test body

// Test 2: lines 348-371
it('persists agent_run_id to sprint task after successful spawn', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  const task = makeTask()
  vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
  vi.mocked(claimTask).mockReturnValueOnce(task)
  const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
  // ... test body

// Test 3: lines 373-403
it('calls createAgentRecord when spawning an agent', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  const task = makeTask()
  vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
  vi.mocked(claimTask).mockReturnValueOnce(task)
  const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
  // ... test body
```

**Impact:** Eight lines of identical setup code repeated verbatim across three consecutive tests. This violates DRY and creates brittleness: changing mock requirements in one place forces changes in three places. If setup changes (e.g., makeTask needs a parameter), all three tests must be edited, increasing maintenance burden and risk of inconsistency.

**Recommendation:** Extract setup into a helper factory or use a beforeEach hook that populates standard mocks:
```typescript
beforeEach(() => {
  setupDefaultMocks()
})

function setupSpawnTest() {
  const task = makeTask()
  vi.mocked(getQueuedTasks).mockReturnValueOnce([task])
  vi.mocked(claimTask).mockReturnValueOnce(task)
  const { handle } = makeMockHandle([{ type: 'text', content: 'hello' }])
  vi.mocked(spawnAgent).mockResolvedValueOnce(handle)
  return { task, handle }
}
```

**Effort:** M
**Confidence:** High

---

## F-t4-tests-4: Overly Complex Timer Management Obscures Intent

**Severity:** Medium
**Category:** F.I.R.S.T (Readability / Timely Feedback)
**Location:** `src/main/agent-manager/__tests__/index.test.ts:300-315, 750-795`
**Evidence:**
```typescript
it('runs initial drain after defer period', async () => {
  vi.useFakeTimers()
  const logger = makeLogger()
  setupDefaultMocks()
  const mgr = createAgentManager(baseConfig, mockRepo, logger)

  mgr.start()
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
  await vi.advanceTimersByTimeAsync(6_000)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

  expect(vi.mocked(getQueuedTasks)).toHaveBeenCalled()

  mgr.stop(0).catch(() => {})
  vi.useRealTimers()
})

it('aborts agent and marks task error when maxRuntimeMs exceeded', async () => {
  // ...
  await vi.advanceTimersByTimeAsync(6_000)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
  // ...
  await vi.advanceTimersByTimeAsync(70_100)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
```

**Impact:** The pattern `for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)` appears throughout (lines 307-309, 331-333, 770-772, etc.). This is cryptic—why advance 10 times by 1ms? It's unclear whether this is flushing microtasks, handling async generators, or something else. Tests should be self-documenting. The test name "runs initial drain after defer period" doesn't explain the timer manipulation pattern.

**Recommendation:** Extract a clearly-named helper:
```typescript
async function flushAsyncMicrotasks() {
  // Flush microtasks after advancing timers (needed for async generator resolution)
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)
}

// Or add a comment explaining why:
// NOTE: Fake timers with async generators need microtask flushes
await flushAsyncMicrotasks()
```

**Effort:** S
**Confidence:** High

---

## F-t4-tests-5: Test Names Don't Match Actual Assertions — Code Review Tests

**Severity:** Medium
**Category:** Test Naming
**Location:** `src/main/handlers/__tests__/review.test.ts:255-262`
**Evidence:**
```typescript
it('review:createPr handler is registered and transitions to done', () => {
  // Verifies handler registration. Expected behavior per fix:
  // - Calls updateTask with status: 'done', completed_at, worktree_path: null
  // - Calls _onStatusTerminal(taskId, 'done') for dependency resolution
  // - Follows the same pattern as review:mergeLocally
  const handlers = captureHandlers()
  expect(handlers['review:createPr']).toBeDefined()  // <- only tests registration!
})
```

**Impact:** The test name promises verification of "transitions to done" behavior, but the actual assertion only verifies the handler exists (toBeDefined). The comment documents expected behavior that is never tested. This violates the principle that test names are executable documentation. Readers expect the test to verify state transitions, but it only checks registration. This creates false confidence.

**Recommendation:** Either:
1. Rename to "review:createPr handler is registered" and remove the misleading comment, OR
2. Actually test the transition behavior by calling the handler and verifying updateTask and onStatusTerminal calls (move to functional test section)

**Effort:** S
**Confidence:** High

---

## F-t4-tests-6: Multiple Assertions Without Clear Relationship — Prompt Composer Tests

**Severity:** Medium
**Category:** AAA
**Location:** `src/main/agent-manager/__tests__/prompt-composer.test.ts:22-35, 38-52`
**Evidence:**
```typescript
it('includes coding agent preamble for pipeline/assistant/adhoc', () => {
  const types: AgentType[] = ['pipeline', 'assistant', 'adhoc']

  for (const agentType of types) {
    const prompt = buildAgentPrompt({ agentType })

    expect(prompt).toContain('## Who You Are')
    expect(prompt).toContain('## Hard Rules')
    expect(prompt).toContain('NEVER push to, checkout, or merge into `main`')
    expect(prompt).toContain('## MANDATORY Pre-Commit Verification')
    expect(prompt).toContain('`npm run typecheck`')
    expect(prompt).toContain('`npm run test:coverage`')
    expect(prompt).toContain('`npm run lint`')
  }
})
```

**Impact:** This single test verifies 21 separate assertions (7 per type × 3 types) across three agent types. If the test fails, it's unclear which type or which assertion failed—the test is too coarse-grained. The test name "includes coding agent preamble" doesn't specify which sections or rules. This violates the "one concept per test" principle.

**Recommendation:** Split into more granular tests:
```typescript
it('pipeline agent includes preamble sections', () => {
  const prompt = buildAgentPrompt({ agentType: 'pipeline' })
  expect(prompt).toContain('## Who You Are')
  expect(prompt).toContain('## Hard Rules')
})

it('pipeline agent includes mandatory verification checks', () => {
  const prompt = buildAgentPrompt({ agentType: 'pipeline' })
  expect(prompt).toContain('`npm run typecheck`')
  expect(prompt).toContain('`npm run test:coverage`')
  expect(prompt).toContain('`npm run lint`')
})

// Repeat for assistant and adhoc types
```

**Effort:** M
**Confidence:** High

---

## F-t4-tests-7: Mocking Everything Including Unit Under Test Behavior

**Severity:** High
**Category:** Test Coupling
**Location:** `src/main/agent-manager/__tests__/index.test.ts:1-250`
**Evidence:**
The entire test file mocks nearly all dependencies at the module level:
```typescript
vi.mock('../../data/sprint-queries', () => ({
  getQueuedTasks: vi.fn(),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  // ... 7 more mocked functions
}))

vi.mock('../../services/dependency-service', () => ({
  createDependencyIndex: vi.fn(() => ({
    rebuild: vi.fn(),
    getDependents: vi.fn(() => new Set()),
    areDependenciesSatisfied: vi.fn(() => ({ satisfied: true, blockedBy: [] }))
  }))
}))

vi.mock('../resolve-dependents', () => ({
  resolveDependents: vi.fn().mockReturnValue(undefined)
}))
// ... 15+ more vi.mock() calls
```

Combined with the test structure (lines 263-276):
```typescript
it('sets running = true and runs orphan recovery + prune', async () => {
  const logger = makeLogger()
  const mgr = createAgentManager(baseConfig, mockRepo, logger)
  mgr.start()
  expect(mgr.getStatus().running).toBe(true)
  expect(mgr.getStatus().shuttingDown).toBe(false)
  expect(vi.mocked(recoverOrphans)).toHaveBeenCalled()
  expect(vi.mocked(pruneStaleWorktrees)).toHaveBeenCalled()
})
```

**Impact:** Tests verify mock interactions (vi.mocked(recoverOrphans).toHaveBeenCalled()) rather than observable behavior. This creates tests that pass even if the integration is broken. If recoverOrphans is called but doesn't actually recover orphans, the test won't catch it. Tests are tightly coupled to implementation details (which functions are called) rather than behavior (what actually happens to tasks). This violates F.I.R.S.T's "Self-Validating" principle—tests validate mocks, not real outcomes.

**Recommendation:** For critical integration points, replace some mock assertions with behavior assertions:
```typescript
// Instead of:
expect(vi.mocked(recoverOrphans)).toHaveBeenCalled()

// Test the actual effect:
// - Orphaned tasks should be moved to active state
// - Stale worktrees should be cleaned up
// - Agent manager status should reflect recovered agents
```

Consider using a test database or partial mocking to verify real behavior of key functions while still mocking external I/O.

**Effort:** L
**Confidence:** High

---

## F-t4-tests-8: Incomplete Test Coverage with No Error Path Verification

**Severity:** Medium
**Category:** F.I.R.S.T (Completeness)
**Location:** `src/main/data/__tests__/sprint-queries.test.ts:89-100`
**Evidence:**
```typescript
describe('UPDATE_ALLOWLIST', () => {
  it('contains expected fields', () => {
    expect(UPDATE_ALLOWLIST.has('title')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('status')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('pr_url')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('agent_run_id')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('depends_on')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('playground_enabled')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('needs_review')).toBe(true)
    expect(UPDATE_ALLOWLIST.has('max_runtime_ms')).toBe(true)
  })
})
```

**Impact:** This test only verifies that expected fields ARE in the allowlist. It doesn't verify that unwanted fields (like 'id', 'created_at', 'password' if it existed) are NOT in the allowlist. This is a critical security/data-integrity control. An attacker could add dangerous fields to UPDATE_ALLOWLIST and the test would still pass. The test is one-sided.

**Recommendation:** Add a negative test:
```typescript
it('does NOT contain sensitive fields', () => {
  expect(UPDATE_ALLOWLIST.has('id')).toBe(false)
  expect(UPDATE_ALLOWLIST.has('created_at')).toBe(false)
  expect(UPDATE_ALLOWLIST.has('updated_at')).toBe(false)
  // ... other sensitive fields
})
```

**Effort:** S
**Confidence:** High

---

## F-t4-tests-9: Implicit State Dependency Between Tests via Shared beforeEach

**Severity:** Medium
**Category:** Test Isolation / F.I.R.S.T (Independence)
**Location:** `src/main/handlers/__tests__/review.test.ts:153-160`
**Evidence:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  gitCommandCalls.length = 0 // Clear command tracking
  // vi.clearAllMocks does NOT reset implementations — re-apply the default
  // git impl so tests that override via mockImplementation don't leak into
  // the next test.
  mockExecFileAsync.mockImplementation(defaultGitImpl)
})
```

Combined with tests that mutate shared state:
```typescript
// Multiple tests mutate gitCommandCalls array, expecting it to be reset
// if one test fails to reset it fully, subsequent tests see stale data

it('review:discard reads branch name before removing worktree', async () => {
  // ...
  expect(gitCommandCalls).toEqual(['rev-parse', 'worktree-remove', 'branch-delete'])
})
```

**Impact:** Tests depend on beforeEach teardown to clear gitCommandCalls. If a test exits early (via throw or early return) without running its assertions, gitCommandCalls won't be cleared, and the next test will see stale data. This violates Independence—test order matters. The comment itself reveals the brittleness: "vi.clearAllMocks does NOT reset implementations."

**Recommendation:** Use afterEach instead, or ensure cleanup happens even on failure:
```typescript
afterEach(() => {
  gitCommandCalls.length = 0
})
```

Better yet, make gitCommandCalls a test-local variable instead of a module-level array that persists across tests.

**Effort:** M
**Confidence:** Medium

---

## F-t4-tests-10: Too Many Mock Assertions Obscure the Real Test Purpose

**Severity:** Medium
**Category:** AAA
**Location:** `src/main/agent-manager/__tests__/index.test.ts:1073-1092`
**Evidence:**
```typescript
it('resolves dependents via resolveDependents', async () => {
  const { resolveDependents } = await import('../resolve-dependents')
  const logger = makeLogger()
  const mgr = createAgentManager(baseConfig, mockRepo, logger)
  await mgr.onTaskTerminal('task-1', 'done')
  expect(vi.mocked(resolveDependents)).toHaveBeenCalledWith(
    'task-1',
    'done',
    expect.anything(), // depIndex
    expect.anything(), // getTask
    expect.anything(), // updateTask
    logger,
    expect.anything(), // getSetting
    expect.anything(), // epicIndex
    expect.anything(), // getGroup
    expect.anything(), // listGroupTasks
    undefined,         // runInTransaction
    expect.anything()  // onTaskTerminal
  )
})
```

**Impact:** The test verifies 12 parameters to resolveDependents. Most are `expect.anything()`, which matches anything. This test is really just checking that resolveDependents was called; the parameters are noise. The test name says "resolves dependents" but the assertion only verifies a function was invoked. It doesn't verify that dependents were actually resolved (task status changed, etc.).

**Recommendation:** Either:
1. Rename to "calls resolveDependents on task terminal" and slim the assertion, OR
2. Actually test the behavior: verify dependent tasks are resolved by checking their status/state after onTaskTerminal completes

**Effort:** M
**Confidence:** Medium

---

## Summary

These 10 findings represent critical test quality issues that reduce confidence in the test suite's ability to catch regressions. The most severe categories are:

- **Redundant Coverage** (Finding 1): 8 identical registration tests add no value
- **Multiple Behaviors per Test** (Findings 2, 6): Tests verify 3+ behaviors at once, making failures ambiguous
- **Mock-Centric Testing** (Finding 7): Tests verify mock interactions rather than actual behavior
- **Brittle Setup** (Finding 3): Duplicate code across tests creates maintenance burden
- **Test Isolation Issues** (Findings 9): Shared mutable state and order-dependent setup

Addressing these findings will improve test clarity, reduce false positives, and make the suite more maintainable.

