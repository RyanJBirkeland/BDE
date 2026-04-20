# Drain-Loop Error Classification — Implementation Plan (RC3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the drain loop from scorching an entire batch of tasks when the failure is environmental (dirty main, missing auth, network). Pause the drain instead, populate `failure_reason`, and emit a UI banner. Also relax the main-repo-guard to ignore pure docs changes.

**Architecture:** Extend the existing `failure-classifier.ts` with an `Environmental` category, plumb classification into the drain loop's setupWorktree failure path, and introduce a `drainPaused` broadcast event. Pause duration is bounded so the drain auto-resumes when the environment clears.

**Tech Stack:** vitest, existing `broadcast.ts` for IPC channel, existing `preload/index.ts` for renderer bridge.

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 3.

---

### Task 1: Add `Environmental` to the failure classifier

**Files:**
- Modify: `src/main/agent-manager/failure-classifier.ts`
- Modify: `src/main/agent-manager/failure-classifier.test.ts` (or create if missing)

- [ ] **Step 1: Read the current classifier structure**

Run: `grep -n "FailureCategory\|FAILURE_PATTERNS\|classify" src/main/agent-manager/failure-classifier.ts | head -20`

Identify the existing categories (`Auth`, `Timeout`, etc.) and the pattern-list array. New code follows the same shape.

- [ ] **Step 2: Write the failing test**

```typescript
// src/main/agent-manager/failure-classifier.test.ts (append)
import { classifyFailureReason } from './failure-classifier'

describe('Environmental failures', () => {
  it('classifies "Main repo has uncommitted changes" as environmental', () => {
    expect(
      classifyFailureReason('setupWorktree failed: Main repo has uncommitted changes (pre-ffMergeMain) — refusing to proceed. Dirty paths: ?? docs/')
    ).toBe('environmental')
  })

  it('classifies "No repo path" as environmental', () => {
    expect(
      classifyFailureReason('Repo "bde" is not configured in BDE settings')
    ).toBe('environmental')
  })

  it('classifies credential errors as environmental', () => {
    expect(
      classifyFailureReason('Claude credential unavailable (needs-login)')
    ).toBe('environmental')
  })

  it('classifies git-fetch network errors as environmental', () => {
    expect(
      classifyFailureReason('fatal: unable to access https://github.com/: Could not resolve host')
    ).toBe('environmental')
  })

  it('leaves spec-level failures alone', () => {
    expect(classifyFailureReason('TypeError: cannot read property x of undefined')).not.toBe('environmental')
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm run test:main -- failure-classifier`
Expected: the 4 environmental cases FAIL (classifier returns something else or `unknown`).

- [ ] **Step 4: Extend `FAILURE_PATTERNS` (or its equivalent) with environmental entries**

Add an `environmental` category to the existing enum/type if absent, then add pattern entries. Exact code depends on the current structure — match it. Example shape:

```typescript
const ENVIRONMENTAL_PATTERNS: RegExp[] = [
  /Main repo has uncommitted changes/i,
  /refusing to proceed/i,
  /is not configured in BDE settings/i,
  /credential unavailable/i,
  /No Claude subscription token/i,
  /unable to access https?:\/\/[^ ]+/i,
  /Could not resolve host/i,
  /getaddrinfo ENOTFOUND/i
]

// In the classifier, check environmental BEFORE the existing categories —
// an auth error, e.g., would otherwise match an auth-category pattern.
if (ENVIRONMENTAL_PATTERNS.some((re) => re.test(message))) return 'environmental'
```

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- failure-classifier`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/failure-classifier.ts src/main/agent-manager/failure-classifier.test.ts
git commit -m "feat(failure-classifier): add environmental category for drain-pause detection"
```

---

### Task 2: Relax main-repo-guard to ignore pure docs/**/*.md

**Files:**
- Modify: `src/main/agent-manager/main-repo-guard.ts` (or wherever `assertRepoCleanOrAbort` lives — grep to confirm)
- Modify: the corresponding test file

- [ ] **Step 1: Locate the guard**

Run: `grep -rn "assertRepoCleanOrAbort\|main-repo-guard\|Main repo has uncommitted" src/main/agent-manager/ --include="*.ts" | head -10`

- [ ] **Step 2: Write the failing test**

Append (or create) in the guard's test file:

```typescript
import { isRepoDirtyForGuard } from './main-repo-guard'

describe('main-repo-guard: docs-only escape', () => {
  it('returns false when every dirty path is under docs/ and is a .md file', () => {
    expect(
      isRepoDirtyForGuard(
        ` M docs/superpowers/audits/2026-04-20/pipeline-notes.md\n?? docs/new-note.md\n`
      )
    ).toBe(false)
  })

  it('returns true when any non-docs file is dirty', () => {
    expect(
      isRepoDirtyForGuard(` M src/main/index.ts\n M docs/x.md\n`)
    ).toBe(true)
  })

  it('returns true when a docs file is non-markdown (images, html, etc.)', () => {
    expect(isRepoDirtyForGuard(`?? docs/screenshots/new.png\n`)).toBe(true)
  })

  it('returns true when docs/* is not docs/**/*.md (e.g. a binary)', () => {
    expect(isRepoDirtyForGuard(`?? docs/tmp.bin\n`)).toBe(true)
  })

  it('returns false for empty porcelain output (clean repo)', () => {
    expect(isRepoDirtyForGuard('')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm run test:main -- main-repo-guard` (or the guard's actual test file)
Expected: the docs-only-escape test FAILS.

- [ ] **Step 4: Extract (if needed) and implement `isRepoDirtyForGuard`**

If the current guard inlines its porcelain parsing, factor it into a testable pure function:

```typescript
/**
 * Parse `git status --porcelain=v1` output and decide whether the worktree
 * should be considered dirty for the main-repo-guard check. Returns false
 * (not-dirty) only when every dirty path is a markdown file under docs/ —
 * audit/doc commits in-progress should not scorch pipeline tasks.
 */
export function isRepoDirtyForGuard(porcelainOutput: string): boolean {
  const lines = porcelainOutput.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return false
  for (const line of lines) {
    // Porcelain format: 2 status chars, space, path (untracked is '?? path')
    const path = line.slice(3)
    const isDocsMarkdown = /^docs\/.*\.md$/.test(path)
    if (!isDocsMarkdown) return true
  }
  return false
}
```

Update the guard's callsite to use this helper. The error message when the guard rejects should list the offending paths (unchanged behavior — just preserve it).

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- main-repo-guard`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/main-repo-guard.ts src/main/agent-manager/main-repo-guard.test.ts
git commit -m "fix(main-repo-guard): ignore pure docs/**/*.md when checking dirty state"
```

---

### Task 3: Add a `drainPaused` broadcast event

**Files:**
- Modify: `src/shared/ipc-channels/` (find the right sub-file — likely `agent-manager.ts`)
- Modify: `src/main/broadcast.ts` (if it has a typed shape; else add the channel name)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts` or wherever `window.api` types live

- [ ] **Step 1: Find the existing agent-manager broadcast channels**

Run: `grep -rn "agentManager:\|agent-manager:" src/shared/ipc-channels/ src/preload/ src/renderer/src/global.d.ts | head -20`

Note the naming convention (`agentManager:foo` or `agent-manager:foo`) and match it.

- [ ] **Step 2: Define the channel + payload shape**

Add to the agent-manager ipc-channels file:

```typescript
export interface AgentManagerDrainPausedEvent {
  /** Human-readable reason ('Main repo dirty', 'Auth missing', etc.). */
  reason: string
  /** Unix ms when the drain will auto-resume. */
  pausedUntil: number
  /** Number of tasks currently in queued state that were not claimed because of this pause. */
  affectedTaskCount: number
}

// Append to the channel-names enum/const
agentManagerDrainPaused: 'agentManager:drainPaused',
```

- [ ] **Step 3: Wire the bridge in preload**

In `src/preload/index.ts`, add a subscriber using the existing `onBroadcast<T>` factory (per CLAUDE.md):

```typescript
agentManager: {
  // ... existing entries ...
  onDrainPaused: onBroadcast<AgentManagerDrainPausedEvent>('agentManager:drainPaused')
}
```

Match the existing structure — if the preload uses a different factory pattern, use whatever's in place for other `agentManager:` channels.

- [ ] **Step 4: Expose on the renderer's api types**

Add the corresponding method to whatever interface declares `window.api.agentManager` in `src/renderer/src/global.d.ts` (or the shared types file). Signature:

```typescript
onDrainPaused(cb: (event: AgentManagerDrainPausedEvent) => void): () => void
```

- [ ] **Step 5: Compile and verify**

Run: `npm run typecheck`
Expected: PASS. No runtime test yet — we add consumers in Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels/ src/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat(ipc): add agentManager:drainPaused broadcast channel"
```

---

### Task 4: Pause the drain loop on environmental failures

**Files:**
- Modify: `src/main/agent-manager/drain-loop.ts`
- Modify: `src/main/agent-manager/drain-loop.test.ts` (create if missing)
- Modify: `src/main/agent-manager/types.ts` (add a pause-duration constant)

- [ ] **Step 1: Add the pause-duration constant**

In `src/main/agent-manager/types.ts`:

```typescript
/** How long the drain loop pauses after an environmental failure. */
export const DRAIN_PAUSE_ON_ENV_ERROR_MS = 30_000
```

- [ ] **Step 2: Write the failing test**

In `drain-loop.test.ts`, add a test that:
1. Spies on `deps.repo.updateTask` to verify the task is NOT moved to `error` on an environmental failure.
2. Spies on a new `deps.emitDrainPaused` callback to verify it's invoked.
3. Triggers the drain's setupWorktree path with a stub that throws an environmental error.

Shape:

```typescript
describe('drain-loop: environmental failure pauses drain', () => {
  it('does not transition the task to error', async () => {
    const updateTask = vi.fn()
    const emitDrainPaused = vi.fn()
    // ... construct DrainLoopDeps with:
    //   setupWorktree rejects with new Error('Main repo has uncommitted changes ...')
    //   processQueuedTask is the existing function that calls setupWorktree
    //   drainFailureCounts = new Map()
    //   etc.
    // await runDrain(deps)
    expect(updateTask).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'error' })
    )
    expect(emitDrainPaused).toHaveBeenCalledTimes(1)
    expect(emitDrainPaused.mock.calls[0][0].reason).toMatch(/main repo/i)
  })

  it('populates failure_reason on the task row but keeps it queued', async () => {
    // ... set up similarly ...
    expect(updateTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'queued', failure_reason: expect.any(String) })
    )
  })

  it('still errors the task on spec-level (non-environmental) failures', async () => {
    // setupWorktree rejects with new Error('TypeError: foo')
    // expect updateTask called with { status: 'error' } as before
  })
})
```

Follow the existing drain-loop test patterns — if there are no tests yet for this path, create a minimal harness that constructs `DrainLoopDeps` with mock functions for every required field.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm run test:main -- drain-loop`
Expected: the environmental-pause tests FAIL.

- [ ] **Step 4: Extend the drain loop**

In `drain-loop.ts`:

1. Add `emitDrainPaused` to `DrainLoopDeps`:

```typescript
export interface DrainLoopDeps {
  // ... existing fields ...
  /** Called when drain pauses because of an environmental failure. */
  emitDrainPaused: (event: {
    reason: string
    pausedUntil: number
    affectedTaskCount: number
  }) => void
}
```

2. In the loop body, when `processQueuedTask` throws, classify the error:

```typescript
import { classifyFailureReason } from './failure-classifier'
import { DRAIN_PAUSE_ON_ENV_ERROR_MS } from './types'

// When a task raises an error during processing:
const category = classifyFailureReason(String(err))
if (category === 'environmental') {
  const reason = String(err).split('\n')[0].slice(0, 200)
  try {
    deps.repo.updateTask(taskId, {
      status: 'queued',
      failure_reason: reason,
      claimed_by: null
    })
  } catch {
    // non-fatal; the row stays as-is
  }
  const pausedUntil = Date.now() + DRAIN_PAUSE_ON_ENV_ERROR_MS
  deps.emitDrainPaused({
    reason,
    pausedUntil,
    affectedTaskCount: deps.repo.getQueueStats().queued
  })
  deps.logger.warn(
    `[drain-loop] environmental failure — pausing drain until ${new Date(pausedUntil).toISOString()}: ${reason}`
  )
  // Short-circuit the rest of this drain tick. The next tick checks the pause.
  return
}
// (Existing per-task error handling below — spec-level path.)
```

3. At the TOP of `runDrain`, check whether we're in a pause window:

```typescript
// Pause-respecting preflight.
if (deps.drainPausedUntil && Date.now() < deps.drainPausedUntil) {
  deps.logger.info(
    `[drain-loop] skipping tick — paused until ${new Date(deps.drainPausedUntil).toISOString()}`
  )
  return
}
// Pause expired (or never set) — clear the marker and continue.
deps.drainPausedUntil = undefined
```

Add `drainPausedUntil: number | undefined` to `DrainLoopDeps` and set it alongside `emitDrainPaused` when a pause begins.

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- drain-loop`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/drain-loop.ts src/main/agent-manager/drain-loop.test.ts src/main/agent-manager/types.ts
git commit -m "feat(drain-loop): pause on environmental failures instead of scorching the queue"
```

---

### Task 5: Wire `emitDrainPaused` to the broadcast channel from AgentManagerImpl

**Files:**
- Modify: `src/main/agent-manager/index.ts`
- Modify: `src/main/agent-manager/index.test.ts` (if affected)

- [ ] **Step 1: Find where DrainLoopDeps is constructed**

Run: `grep -n "drainDeps\|DrainLoopDeps" src/main/agent-manager/index.ts | head -5`

- [ ] **Step 2: Pass `emitDrainPaused` through**

Add a new field on `AgentManagerImpl`:

```typescript
private _drainPausedUntil: number | undefined

// In the `_drainLoop` method or wherever DrainLoopDeps is assembled:
const drainDeps: DrainLoopDeps = {
  // ... existing fields ...
  drainPausedUntil: this._drainPausedUntil,
  emitDrainPaused: (event) => {
    this._drainPausedUntil = event.pausedUntil
    // Broadcast via the main-process broadcast bus:
    broadcast('agentManager:drainPaused', event)
  }
}
```

(`broadcast` is the existing helper in `src/main/broadcast.ts` — check its exact name/shape and match.)

- [ ] **Step 3: Run tests**

Run: `npm run test:main`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "feat(agent-manager): broadcast drain-pause events to renderer"
```

---

### Task 6: Renderer — drain-pause banner

**Files:**
- Create: `src/renderer/src/hooks/useDrainStatus.ts`
- Modify: `src/renderer/src/views/DashboardView.tsx` (or the Task Pipeline banner host — pick whichever is already rendered at the top level)
- Test: `src/renderer/src/hooks/__tests__/useDrainStatus.test.ts`

- [ ] **Step 1: Write the failing hook test**

```typescript
// useDrainStatus.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDrainStatus } from '../useDrainStatus'

describe('useDrainStatus', () => {
  beforeEach(() => {
    const api = (globalThis as unknown as { api: { agentManager: { onDrainPaused: ReturnType<typeof vi.fn> } } }).api
    api.agentManager.onDrainPaused = vi.fn()
  })

  it('subscribes on mount and returns null when no event has fired', () => {
    const api = (globalThis as unknown as { api: { agentManager: { onDrainPaused: ReturnType<typeof vi.fn> } } }).api
    const unsubscribe = vi.fn()
    api.agentManager.onDrainPaused = vi.fn().mockReturnValue(unsubscribe)

    const { result, unmount } = renderHook(() => useDrainStatus())
    expect(result.current).toBeNull()
    expect(api.agentManager.onDrainPaused).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('surfaces the event and clears when the paused-until window elapses', () => {
    vi.useFakeTimers()
    let emitted: (event: { reason: string; pausedUntil: number; affectedTaskCount: number }) => void = () => {}
    const api = (globalThis as unknown as { api: { agentManager: { onDrainPaused: ReturnType<typeof vi.fn> } } }).api
    api.agentManager.onDrainPaused = vi.fn((cb) => {
      emitted = cb
      return () => {}
    })

    const now = Date.now()
    const { result } = renderHook(() => useDrainStatus())
    act(() => {
      emitted({ reason: 'Main repo dirty', pausedUntil: now + 10_000, affectedTaskCount: 3 })
    })
    expect(result.current?.reason).toBe('Main repo dirty')
    act(() => {
      vi.advanceTimersByTime(10_500)
    })
    expect(result.current).toBeNull()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Extend the test-setup stub for `agentManager.onDrainPaused`**

Open `src/renderer/src/test-setup.ts` and add to the `agentManager` section:

```typescript
onDrainPaused: vi.fn().mockReturnValue(() => {})
```

(Match the field location — if no `agentManager` key exists on `api`, add it. The preload bridge structure from Task 3 determines the key name.)

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- useDrainStatus`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

```typescript
// src/renderer/src/hooks/useDrainStatus.ts
import { useEffect, useState } from 'react'

export interface DrainPausedState {
  reason: string
  pausedUntil: number
  affectedTaskCount: number
}

/**
 * Subscribe to drain-paused events from the agent manager. Returns the
 * current pause state, or null when no pause is active. Auto-clears when
 * `pausedUntil` elapses.
 */
export function useDrainStatus(): DrainPausedState | null {
  const [state, setState] = useState<DrainPausedState | null>(null)

  useEffect(() => {
    return window.api.agentManager.onDrainPaused((event) => {
      setState(event)
    })
  }, [])

  useEffect(() => {
    if (!state) return
    const ms = Math.max(0, state.pausedUntil - Date.now())
    const timer = setTimeout(() => setState(null), ms)
    return () => clearTimeout(timer)
  }, [state])

  return state
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- useDrainStatus`
Expected: all PASS.

- [ ] **Step 6: Render the banner on DashboardView**

Open the Dashboard view and add a banner component near the top:

```typescript
import { useDrainStatus } from '../hooks/useDrainStatus'

// Inside DashboardView's render:
const drainStatus = useDrainStatus()

// Render:
{drainStatus && (
  <div role="alert" className="drain-pause-banner">
    <strong>Drain loop paused:</strong> {drainStatus.reason}
    {' '}({drainStatus.affectedTaskCount} tasks queued; auto-resume at{' '}
    {new Date(drainStatus.pausedUntil).toLocaleTimeString()})
  </div>
)}
```

Add a small amount of CSS to make it visible (amber background, clear padding). Reuse existing tokens from `neon.css` / `tokens.css` if possible.

- [ ] **Step 7: Run the Dashboard test(s) for regression**

Run: `npm test -- DashboardView` (if a test exists). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/hooks/useDrainStatus.ts src/renderer/src/hooks/__tests__/useDrainStatus.test.ts src/renderer/src/test-setup.ts src/renderer/src/views/DashboardView.tsx
git commit -m "feat(renderer): drain-pause banner driven by useDrainStatus hook"
```

---

### Task 7: Full-suite regression and smoke test

- [ ] **Step 1: Run every suite**

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

Expected: all green.

- [ ] **Step 2: Manual smoke test (dirty main)**

Temporarily create an untracked file in the repo:

```bash
touch docs/tmp-smoke.md
```

Queue a trivial task (any existing task or direct SQL insert). Watch the Dashboard: the banner should appear within a few seconds. No task should transition to `error`.

Clean up:

```bash
rm docs/tmp-smoke.md
sqlite3 ~/.bde/bde.db "DELETE FROM sprint_tasks WHERE id='smoke-<whatever>'"
```

- [ ] **Step 3: No additional commit**

---

## Self-Review Notes

- **Spec coverage:** Classification → Task 1; docs-only escape → Task 2; broadcast channel → Task 3; pause behavior → Tasks 4–5; banner → Task 6.
- **Placeholders:** Task 4 step 2 uses "Follow the existing drain-loop test patterns" — this is reading guidance, not a placeholder. All code blocks are concrete.
- **Type consistency:** `AgentManagerDrainPausedEvent` name used in Tasks 3, 5, 6 (implicit via the channel and hook types).
- **Known limitation:** The `affectedTaskCount` is the queue length at pause time, not a count of tasks that were *saved* from scorching. That's a UX simplification — the number on the banner is the number of tasks waiting to run, not a historical count.
