# Main Process Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for the 5 highest-risk untested main process modules: dependency-index, resolve-dependents, prompt-composer, pr-poller, and worktree (pure functions only).

**Architecture:** TDD — write failing tests first, verify they fail, then confirm the existing production code passes them. These modules already exist and work; we're adding coverage to catch regressions. Focus on pure/injectable functions; skip tests that would require mocking Electron IPC or the full filesystem.

**Tech Stack:** vitest, main process test config (`src/main/vitest.main.config.ts`).

---

## File Structure

### New files

- `src/main/__tests__/dependency-index.test.ts` — Pure function tests for cycle detection and dependency satisfaction
- `src/main/__tests__/resolve-dependents.test.ts` — Dependency resolution logic tests
- `src/main/__tests__/prompt-composer.test.ts` — Agent prompt assembly tests
- `src/main/__tests__/pr-poller.test.ts` — PR polling logic tests (mocked network)
- `src/main/__tests__/worktree-unit.test.ts` — Pure function tests for `branchNameForTask`

### Not modified (production code is already written — we're adding coverage)

---

## Task 1: Test dependency-index.ts

**Files:**

- Create: `src/main/__tests__/dependency-index.test.ts`
- Reference: `src/main/agent-manager/dependency-index.ts`

This module exports `createDependencyIndex()` (factory) and `detectCycle()`. Both are pure — no I/O, no mocks needed.

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { createDependencyIndex, detectCycle } from '../agent-manager/dependency-index'

describe('createDependencyIndex', () => {
  it('returns empty dependents for unknown task', () => {
    const index = createDependencyIndex()
    index.rebuild([])
    expect(index.getDependents('nonexistent').size).toBe(0)
  })

  it('builds reverse map from task dependencies', () => {
    const index = createDependencyIndex()
    index.rebuild([{ id: 'child', depends_on: [{ id: 'parent', type: 'hard' }] }] as any)
    const deps = index.getDependents('parent')
    expect(deps.has('child')).toBe(true)
  })

  it('tracks multiple dependents for same parent', () => {
    const index = createDependencyIndex()
    index.rebuild([
      { id: 'a', depends_on: [{ id: 'parent', type: 'hard' }] },
      { id: 'b', depends_on: [{ id: 'parent', type: 'soft' }] }
    ] as any)
    expect(index.getDependents('parent').size).toBe(2)
  })

  it('areDependenciesSatisfied returns true when all hard deps are done', () => {
    const index = createDependencyIndex()
    const deps = [{ id: 'dep1', type: 'hard' as const }]
    const getStatus = (id: string) => 'done'
    expect(index.areDependenciesSatisfied('task1', deps, getStatus)).toBe(true)
  })

  it('areDependenciesSatisfied returns false when hard dep is not done', () => {
    const index = createDependencyIndex()
    const deps = [{ id: 'dep1', type: 'hard' as const }]
    const getStatus = (id: string) => 'active'
    expect(index.areDependenciesSatisfied('task1', deps, getStatus)).toBe(false)
  })

  it('areDependenciesSatisfied treats soft deps as satisfied when terminal', () => {
    const index = createDependencyIndex()
    const deps = [{ id: 'dep1', type: 'soft' as const }]
    const getStatus = (id: string) => 'failed'
    expect(index.areDependenciesSatisfied('task1', deps, getStatus)).toBe(true)
  })

  it('areDependenciesSatisfied returns false for soft dep still active', () => {
    const index = createDependencyIndex()
    const deps = [{ id: 'dep1', type: 'soft' as const }]
    const getStatus = (id: string) => 'active'
    expect(index.areDependenciesSatisfied('task1', deps, getStatus)).toBe(false)
  })
})

describe('detectCycle', () => {
  it('returns false for no dependencies', () => {
    expect(detectCycle('a', [], () => [])).toBe(false)
  })

  it('returns false for a simple valid chain', () => {
    // a -> b -> c (no cycle)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'c', type: 'hard' as const }]
      return []
    }
    expect(detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)).toBe(false)
  })

  it('detects direct cycle', () => {
    // a -> b -> a (cycle!)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'a', type: 'hard' as const }]
      return []
    }
    expect(detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)).toBe(true)
  })

  it('detects indirect cycle', () => {
    // a -> b -> c -> a (cycle!)
    const getDeps = (id: string) => {
      if (id === 'b') return [{ id: 'c', type: 'hard' as const }]
      if (id === 'c') return [{ id: 'a', type: 'hard' as const }]
      return []
    }
    expect(detectCycle('a', [{ id: 'b', type: 'hard' }], getDeps)).toBe(true)
  })

  it('handles self-dependency', () => {
    expect(detectCycle('a', [{ id: 'a', type: 'hard' }], () => [])).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/dependency-index.test.ts`
Expected: PASS (testing existing production code)

Note: If `areDependenciesSatisfied` or `detectCycle` have different signatures than shown, read the actual source file and adjust the test calls to match the real API.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/dependency-index.test.ts
git commit -m "test: add unit tests for dependency-index (cycle detection, satisfaction checks)"
```

---

## Task 2: Test resolve-dependents.ts

**Files:**

- Create: `src/main/__tests__/resolve-dependents.test.ts`
- Reference: `src/main/agent-manager/resolve-dependents.ts`

This function takes injected callbacks — fully testable with mocks.

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { resolveDependents } from '../agent-manager/resolve-dependents'
import type { DependencyIndex } from '../agent-manager/dependency-index'
import type { SprintTask } from '../../shared/types'

function mockIndex(overrides: Partial<DependencyIndex> = {}): DependencyIndex {
  return {
    rebuild: vi.fn(),
    getDependents: vi.fn().mockReturnValue(new Set<string>()),
    areDependenciesSatisfied: vi.fn().mockReturnValue(true),
    ...overrides
  }
}

function mockTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test',
    status: 'blocked',
    depends_on: [{ id: 'dep-1', type: 'hard' }],
    repo: 'test',
    ...overrides
  } as SprintTask
}

describe('resolveDependents', () => {
  it('does nothing when no dependents exist', async () => {
    const index = mockIndex({ getDependents: vi.fn().mockReturnValue(new Set()) })
    const getTask = vi.fn()
    const updateTask = vi.fn()

    await resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(getTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('unblocks a blocked dependent when dependencies are satisfied', async () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi.fn().mockReturnValue(true)
    })
    const task = mockTask({ id: 'task-1', status: 'blocked' })
    const getTask = vi.fn().mockResolvedValue(task)
    const updateTask = vi.fn().mockResolvedValue(undefined)

    await resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'queued' }))
  })

  it('does not unblock a dependent whose deps are not satisfied', async () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi.fn().mockReturnValue(false)
    })
    const task = mockTask({ id: 'task-1', status: 'blocked' })
    const getTask = vi.fn().mockResolvedValue(task)
    const updateTask = vi.fn()

    await resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // Should not transition to queued
    const statusCalls = updateTask.mock.calls.filter(([, patch]) => patch.status === 'queued')
    expect(statusCalls.length).toBe(0)
  })

  it('skips dependents that are not in blocked status', async () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const task = mockTask({ id: 'task-1', status: 'active' })
    const getTask = vi.fn().mockResolvedValue(task)
    const updateTask = vi.fn()

    await resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('handles multiple dependents independently', async () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1', 'task-2'])),
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValueOnce(true) // task-1: satisfied
        .mockReturnValueOnce(false) // task-2: not satisfied
    })
    const getTask = vi
      .fn()
      .mockResolvedValueOnce(mockTask({ id: 'task-1', status: 'blocked' }))
      .mockResolvedValueOnce(mockTask({ id: 'task-2', status: 'blocked' }))
    const updateTask = vi.fn().mockResolvedValue(undefined)

    await resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // Only task-1 should be unblocked
    const queuedCalls = updateTask.mock.calls.filter(([, p]) => p.status === 'queued')
    expect(queuedCalls.length).toBe(1)
    expect(queuedCalls[0][0]).toBe('task-1')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/resolve-dependents.test.ts`
Expected: PASS

Note: The actual function signature may differ. Read `src/main/agent-manager/resolve-dependents.ts` and adjust. The function might use `getTask(id)` returning a promise, or it might use a repository interface. Match the real API.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/resolve-dependents.test.ts
git commit -m "test: add unit tests for resolve-dependents (dependency unblocking logic)"
```

---

## Task 3: Test prompt-composer.ts

**Files:**

- Create: `src/main/__tests__/prompt-composer.test.ts`
- Reference: `src/main/agent-manager/prompt-composer.ts`

Pure function — no mocks needed. Test that different agent types produce correct prompt structures.

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'

describe('buildAgentPrompt', () => {
  const baseInput = {
    agentType: 'pipeline' as const,
    taskContent: '## Overview\nBuild feature X\n## Plan\nStep 1...',
    repoName: 'BDE',
    branchName: 'agent/build-feature-x-abc12345'
  }

  it('includes task content in pipeline prompt', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('Build feature X')
    expect(prompt).toContain('Step 1')
  })

  it('includes branch name in pipeline prompt', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('agent/build-feature-x-abc12345')
  })

  it('includes "do not push to main" warning', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt.toLowerCase()).toContain('main')
  })

  it('includes npm install setup reminder', () => {
    const prompt = buildAgentPrompt(baseInput)
    expect(prompt).toContain('npm install')
  })

  it('produces different output for assistant vs pipeline', () => {
    const pipeline = buildAgentPrompt({ ...baseInput, agentType: 'pipeline' })
    const assistant = buildAgentPrompt({ ...baseInput, agentType: 'assistant' })
    expect(pipeline).not.toBe(assistant)
  })

  it('produces different output for adhoc type', () => {
    const adhoc = buildAgentPrompt({ ...baseInput, agentType: 'adhoc' })
    expect(adhoc).toContain(baseInput.taskContent)
  })

  it('handles copilot type with form context', () => {
    const prompt = buildAgentPrompt({
      agentType: 'copilot',
      taskContent: 'Help me write a spec',
      repoName: 'BDE',
      formContext: 'Title: Feature X\nRepo: BDE',
      messageHistory: [{ role: 'user', content: 'What should the spec cover?' }]
    } as any)
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('handles synthesizer type with codebase context', () => {
    const prompt = buildAgentPrompt({
      agentType: 'synthesizer',
      taskContent: 'Generate spec',
      repoName: 'BDE',
      codebaseContext: 'file tree here...'
    } as any)
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/prompt-composer.test.ts`
Expected: PASS

Note: The `BuildPromptInput` interface may have different field names. Read the actual source and adjust. Use `expect.stringContaining()` for flexible matching per the CLAUDE.md gotcha about prompt augmentation.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/prompt-composer.test.ts
git commit -m "test: add unit tests for prompt-composer (agent prompt assembly)"
```

---

## Task 4: Test pr-poller.ts

**Files:**

- Create: `src/main/__tests__/pr-poller.test.ts`
- Reference: `src/main/pr-poller.ts`

Module-level state requires careful mocking. Mock the network calls, test the polling orchestration.

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before importing
vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('../settings', () => ({
  getGitHubToken: vi.fn().mockReturnValue('test-token'),
  getConfiguredRepos: vi
    .fn()
    .mockReturnValue([{ name: 'BDE', githubOwner: 'TestOwner', githubRepo: 'BDE' }])
}))
vi.mock('../handlers/github-fetch', () => ({
  githubFetch: vi.fn().mockResolvedValue({ check_runs: [] }),
  fetchAllGitHubPages: vi.fn().mockResolvedValue([])
}))

import { startPrPoller, stopPrPoller, getLatestPrList, refreshPrList } from '../pr-poller'
import { broadcast } from '../broadcast'
import { fetchAllGitHubPages, githubFetch } from '../handlers/github-fetch'

describe('pr-poller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stopPrPoller() // Reset state
  })

  afterEach(() => {
    stopPrPoller()
    vi.useRealTimers()
  })

  it('getLatestPrList returns null before first poll', () => {
    expect(getLatestPrList()).toBeNull()
  })

  it('refreshPrList fetches PRs and broadcasts result', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([
      {
        number: 1,
        title: 'Test PR',
        html_url: 'https://github.com/test/1',
        state: 'open',
        draft: false,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        head: { ref: 'feat/test', sha: 'abc' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        repo: 'BDE'
      }
    ])

    const result = await refreshPrList()

    expect(fetchAllGitHubPages).toHaveBeenCalled()
    expect(broadcast).toHaveBeenCalledWith('pr:listUpdated', expect.any(Object))
    expect(result).toBeTruthy()
    expect(result!.prs.length).toBe(1)
  })

  it('getLatestPrList returns cached data after refresh', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([])
    await refreshPrList()
    const cached = getLatestPrList()
    expect(cached).not.toBeNull()
    expect(cached!.prs).toEqual([])
  })

  it('startPrPoller begins interval polling', async () => {
    vi.mocked(fetchAllGitHubPages).mockResolvedValue([])
    startPrPoller()

    // Advance past first poll interval (60s)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchAllGitHubPages).toHaveBeenCalled()
  })

  it('stopPrPoller stops the interval', () => {
    startPrPoller()
    stopPrPoller()
    vi.clearAllMocks()

    vi.advanceTimersByTime(120_000)
    expect(fetchAllGitHubPages).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/pr-poller.test.ts`
Expected: PASS

Note: Mock paths and function names must match the real imports in `pr-poller.ts`. Read the source file first and adjust mock paths. The module may import from different locations than shown.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/pr-poller.test.ts
git commit -m "test: add unit tests for pr-poller (PR fetching, broadcast, caching)"
```

---

## Task 5: Test worktree.ts pure functions

**Files:**

- Create: `src/main/__tests__/worktree-unit.test.ts`
- Reference: `src/main/agent-manager/worktree.ts`

Only test `branchNameForTask()` — the pure slug generator. Skip `setupWorktree`/`cleanupWorktree` since they require git + filesystem.

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { branchNameForTask } from '../agent-manager/worktree'

describe('branchNameForTask', () => {
  it('generates agent/ prefixed branch name', () => {
    const name = branchNameForTask('Build the login page', 'abc12345')
    expect(name.startsWith('agent/')).toBe(true)
  })

  it('slugifies the title', () => {
    const name = branchNameForTask('Fix: the BROKEN thing!', 'abc12345')
    expect(name).toMatch(/^agent\/[a-z0-9-]+$/)
    expect(name).not.toContain(' ')
    expect(name).not.toContain('!')
    expect(name).not.toContain(':')
  })

  it('includes task ID prefix', () => {
    const name = branchNameForTask('My task', 'deadbeef12345678')
    expect(name).toContain('deadbeef')
  })

  it('truncates long titles', () => {
    const longTitle = 'A'.repeat(200)
    const name = branchNameForTask(longTitle, 'abc12345')
    // BRANCH_SLUG_MAX_LENGTH is the limit — branch name should not exceed it
    expect(name.length).toBeLessThanOrEqual(80) // reasonable max
  })

  it('handles special characters', () => {
    const name = branchNameForTask('feat(scope): add [brackets] & stuff', 'abc12345')
    expect(name).toMatch(/^agent\/[a-z0-9-]+$/)
  })

  it('handles empty title', () => {
    const name = branchNameForTask('', 'abc12345')
    expect(name.startsWith('agent/')).toBe(true)
    expect(name.length).toBeGreaterThan('agent/'.length)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts src/main/__tests__/worktree-unit.test.ts`
Expected: PASS

Note: Check the actual `branchNameForTask` signature — it might take `(title, taskId?)` or `(title)`. Adjust accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/worktree-unit.test.ts
git commit -m "test: add unit tests for worktree branchNameForTask slug generation"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full main process test suite**

Run: `cd ~/projects/BDE && npm run test:main`
Expected: ALL PASS (including new tests)

- [ ] **Step 2: Run renderer tests (no regressions)**

Run: `cd ~/projects/BDE && npm test`
Expected: ALL PASS

- [ ] **Step 3: Count new tests added**

Run: `cd ~/projects/BDE && npx vitest run --config src/main/vitest.main.config.ts --reporter=verbose 2>&1 | grep -c "✓"`
Report the number of new tests added.
