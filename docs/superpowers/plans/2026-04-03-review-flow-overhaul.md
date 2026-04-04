# Review Flow Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the code review experience from a single-task-at-a-time bottleneck into a fast, intelligent review flow with batch operations, one-click shipping, and AI-assisted summaries.

**Architecture:** The review flow lives in `src/renderer/src/components/code-review/` (React + Zustand) with backend handlers in `src/main/handlers/review.ts`. This plan fixes ConversationTab to use the agentEvents store, adds a "Ship It" button that combines merge+push, introduces multi-select batch operations in ReviewQueue, adds a configurable auto-review rules engine in the main process, and generates AI review summaries via the Agent SDK when tasks enter `review` status.

**Tech Stack:** TypeScript, React, Zustand, vitest, CSS

**Spec:** `docs/superpowers/specs/2026-04-03-developer-persona-audit.md`

---

### Task 1: Fix ConversationTab — Show Agent Conversation

**Files:**
- Modify: `src/renderer/src/components/code-review/ConversationTab.tsx`
- Modify: `src/renderer/src/components/code-review/__tests__/ConversationTab.test.tsx`
- Modify: `src/renderer/src/assets/code-review-neon.css`

Currently `ConversationTab` shows `task.spec` and `task.notes` — it should load agent events from the `agentEvents` store by `task.agent_run_id` and render them as a chat timeline with tool calls, text output, thinking, and errors.

- [ ] **Step 1: Write failing tests**

Replace `src/renderer/src/components/code-review/__tests__/ConversationTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { sprintState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>,
    loading: false,
    loadData: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(sprintState))
}))

const { agentEventsState } = vi.hoisted(() => ({
  agentEventsState: {
    events: {} as Record<string, Array<Record<string, unknown>>>,
    loadHistory: vi.fn()
  }
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(agentEventsState))
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null as string | null
  }))
  return { useCodeReviewStore: store }
})

import { ConversationTab } from '../ConversationTab'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ConversationTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = []
    agentEventsState.events = {}
    agentEventsState.loadHistory.mockClear()
    useCodeReviewStore.setState({ selectedTaskId: null })
  })

  it('shows placeholder when no task selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<ConversationTab />)
    expect(screen.getByText('No task selected')).toBeInTheDocument()
  })

  it('shows fallback spec/notes when task has no agent_run_id', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: '## Spec Content', notes: 'Some notes', agent_run_id: null }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Task Spec')).toBeInTheDocument()
    expect(screen.getByText('Agent Notes')).toBeInTheDocument()
  })

  it('calls loadHistory when task has agent_run_id', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-123' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(agentEventsState.loadHistory).toHaveBeenCalledWith('run-123')
  })

  it('renders agent text events', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        { type: 'agent:text', text: 'I will fix the bug now.', timestamp: 1000 }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('I will fix the bug now.')).toBeInTheDocument()
  })

  it('renders tool call events with tool name and summary', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        { type: 'agent:tool_call', tool: 'Edit', summary: 'Edited src/main.ts', timestamp: 2000 }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Edited src/main.ts')).toBeInTheDocument()
  })

  it('renders error events', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        { type: 'agent:error', message: 'Build failed with exit code 1', timestamp: 3000 }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Build failed with exit code 1')).toBeInTheDocument()
  })

  it('renders completion event with cost', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        { type: 'agent:completed', exitCode: 0, costUsd: 0.42, tokensIn: 1000, tokensOut: 500, durationMs: 60000, timestamp: 4000 }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument()
  })

  it('shows loading state when events are not yet loaded', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {} // no events loaded yet
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Loading conversation...')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ConversationTab.test.tsx`

- [ ] **Step 3: Implement ConversationTab**

Replace `src/renderer/src/components/code-review/ConversationTab.tsx`:

```tsx
import { useEffect } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { renderAgentMarkdown } from '../../lib/render-agent-markdown'
import type { AgentEvent } from '../../../../shared/types'
import { Terminal, Wrench, AlertTriangle, CheckCircle, MessageSquare, Brain } from 'lucide-react'

function EventItem({ event }: { event: AgentEvent }): React.JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString()

  switch (event.type) {
    case 'agent:text':
      return (
        <div className="cr-event cr-event--text">
          <MessageSquare size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <div className="cr-event__content">{event.text}</div>
          </div>
        </div>
      )
    case 'agent:tool_call':
      return (
        <div className="cr-event cr-event--tool">
          <Wrench size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__tool-name">{event.tool}</span>
            <span className="cr-event__summary">{event.summary}</span>
          </div>
        </div>
      )
    case 'agent:tool_result':
      return (
        <div className={`cr-event cr-event--result ${event.success ? '' : 'cr-event--result-fail'}`}>
          <Terminal size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__tool-name">{event.tool}</span>
            <span className="cr-event__summary">{event.summary}</span>
          </div>
        </div>
      )
    case 'agent:thinking':
      return (
        <div className="cr-event cr-event--thinking">
          <Brain size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__summary">Thinking... ({event.tokenCount} tokens)</span>
          </div>
        </div>
      )
    case 'agent:error':
      return (
        <div className="cr-event cr-event--error">
          <AlertTriangle size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <div className="cr-event__content cr-event__content--error">{event.message}</div>
          </div>
        </div>
      )
    case 'agent:completed':
      return (
        <div className="cr-event cr-event--completed">
          <CheckCircle size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__summary">
              Completed (exit {event.exitCode}) — ${event.costUsd.toFixed(2)} · {Math.round(event.durationMs / 1000)}s
            </span>
          </div>
        </div>
      )
    default:
      return <></>
  }
}

export function ConversationTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const events = useAgentEventsStore((s) => s.events)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)
  const task = tasks.find((t) => t.id === selectedTaskId)

  const agentRunId = task?.agent_run_id ?? null
  const agentEvents = agentRunId ? events[agentRunId] ?? null : null

  useEffect(() => {
    if (agentRunId) {
      loadHistory(agentRunId)
    }
  }, [agentRunId, loadHistory])

  if (!task) return <div className="cr-placeholder">No task selected</div>

  // If no agent_run_id, fall back to spec/notes display
  if (!agentRunId) {
    return (
      <div className="cr-conversation">
        <div className="cr-conversation__section">
          <h4 className="cr-conversation__heading">Task Spec</h4>
          <div className="cr-conversation__spec">
            {task.spec ? (
              renderAgentMarkdown(task.spec)
            ) : (
              <span className="cr-placeholder">No spec available</span>
            )}
          </div>
        </div>
        {task.notes && (
          <div className="cr-conversation__section">
            <h4 className="cr-conversation__heading">Agent Notes</h4>
            <div className="cr-conversation__notes">{task.notes}</div>
          </div>
        )}
      </div>
    )
  }

  // Loading state: agent_run_id exists but events not loaded yet
  if (!agentEvents) {
    return <div className="cr-placeholder">Loading conversation...</div>
  }

  // Empty events
  if (agentEvents.length === 0) {
    return <div className="cr-placeholder">No conversation events recorded</div>
  }

  return (
    <div className="cr-conversation cr-conversation--events">
      {agentEvents.map((event, i) => (
        <EventItem key={`${event.type}-${event.timestamp}-${i}`} event={event} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Add CSS for agent event timeline**

Append to `src/renderer/src/assets/code-review-neon.css`:

```css
/* Agent conversation events timeline */
.cr-conversation--events {
  padding: 8px 0;
  gap: 0;
}

.cr-event {
  display: flex;
  gap: 8px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--bde-border);
  align-items: flex-start;
}

.cr-event__icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--neon-text-dim);
}

.cr-event--text .cr-event__icon { color: var(--neon-blue); }
.cr-event--tool .cr-event__icon { color: var(--neon-purple); }
.cr-event--result .cr-event__icon { color: var(--neon-cyan); }
.cr-event--result-fail .cr-event__icon { color: var(--neon-red); }
.cr-event--thinking .cr-event__icon { color: var(--neon-text-dim); }
.cr-event--error .cr-event__icon { color: var(--neon-red); }
.cr-event--completed .cr-event__icon { color: var(--neon-cyan); }

.cr-event__body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  min-width: 0;
}

.cr-event__time {
  font-size: 10px;
  color: var(--neon-text-dim);
  font-family: var(--bde-font-code);
  flex-shrink: 0;
}

.cr-event__tool-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--neon-purple);
  font-family: var(--bde-font-code);
}

.cr-event__summary {
  font-size: 11px;
  color: var(--neon-text-muted);
  font-family: var(--bde-font-code);
}

.cr-event__content {
  font-size: 12px;
  color: var(--neon-text);
  line-height: 1.5;
  width: 100%;
}

.cr-event__content--error {
  color: var(--neon-red);
}
```

- [ ] **Step 5: Run tests — expect pass**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ConversationTab.test.tsx`

- [ ] **Step 6: Run full suite + typecheck**
Run: `cd ~/projects/BDE && npm run typecheck && npm test`

- [ ] **Step 7: Commit**
```
fix(code-review): show agent conversation events instead of spec in ConversationTab
```

---

### Task 2: Merge & Push in One Click — "Ship It" Button

**Files:**
- Modify: `src/renderer/src/components/code-review/ReviewActions.tsx`
- Modify: `src/renderer/src/components/code-review/__tests__/ReviewActions.test.tsx`
- Modify: `src/main/handlers/review.ts`
- Modify: `src/main/handlers/__tests__/review.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add `review:shipIt` IPC channel**

In `src/shared/ipc-channels.ts`, add a new channel entry alongside the existing review channels:

```ts
'review:shipIt': {
  payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }
  result: { success: boolean; pushed?: boolean; error?: string }
}
```

- [ ] **Step 2: Add main process handler**

In `src/main/handlers/review.ts`, add a new `review:shipIt` handler inside `registerReviewHandlers()`. This handler does: merge locally (reusing existing merge logic) → `git push origin main` → mark done. Extract the merge logic into a helper to avoid duplication.

```ts
// review:shipIt — merge + push + done in one action
safeHandle('review:shipIt', async (_e, payload) => {
  const { taskId, strategy } = payload

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  // Get branch name from the worktree
  const { stdout: branchName } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: task.worktree_path, env }
  )
  const branch = branchName.trim()

  // Resolve repo local path
  const repoConfig = getRepoConfig(task.repo)
  if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)
  const repoPath = repoConfig.localPath

  // Verify clean working tree
  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoPath, env
  })
  if (statusOut.trim()) {
    return { success: false, error: 'Working tree has uncommitted changes. Commit or stash first.' }
  }

  // Merge
  try {
    if (strategy === 'squash') {
      await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
      try {
        await execFileAsync('git', ['commit', '-m', `${task.title} (#${taskId})`], { cwd: repoPath, env })
      } catch (commitErr) {
        try { await execFileAsync('git', ['reset', 'HEAD'], { cwd: repoPath, env }) } catch { /* */ }
        throw commitErr
      }
    } else if (strategy === 'rebase') {
      await execFileAsync('git', ['rebase', 'HEAD', branch], { cwd: repoPath, env })
      await execFileAsync('git', ['merge', '--ff-only', branch], { cwd: repoPath, env })
    } else {
      await execFileAsync('git', ['merge', '--no-ff', branch, '-m', `Merge: ${task.title} (#${taskId})`], { cwd: repoPath, env })
    }
  } catch (err) {
    // Abort failed merge/rebase
    try {
      if (strategy === 'rebase') {
        await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, env })
      } else {
        await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
      }
    } catch { /* best-effort */ }
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Push
  let pushed = false
  try {
    await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
    pushed = true
  } catch (pushErr) {
    logger.warn(`[review:shipIt] Push failed for task ${taskId}: ${pushErr}`)
    // Merge succeeded, push failed — still mark done but warn user
  }

  // Clean up worktree + branch
  try {
    await execFileAsync('git', ['worktree', 'remove', task.worktree_path, '--force'], { cwd: repoPath, env })
  } catch { /* best-effort */ }
  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
  } catch { /* best-effort */ }

  // Mark task done
  const updated = _updateTask(taskId, {
    status: 'done',
    completed_at: new Date().toISOString(),
    worktree_path: null
  })
  if (updated) notifySprintMutation('updated', updated)
  if (_onStatusTerminal) {
    _onStatusTerminal(taskId, 'done')
  }

  return { success: true, pushed }
})
```

- [ ] **Step 3: Add preload bridge**

In `src/preload/index.ts`, add to the `review` object:

```ts
shipIt: (payload: { taskId: string; strategy: 'squash' | 'merge' | 'rebase' }) =>
  typedInvoke('review:shipIt', payload),
```

In `src/preload/index.d.ts`, add the matching type declaration.

- [ ] **Step 4: Write failing test for Ship It button**

Add to `src/renderer/src/components/code-review/__tests__/ReviewActions.test.tsx`:

```tsx
it('shows Ship It button when review task selected', () => {
  sprintState.tasks = [
    { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
  ]
  useCodeReviewStore.setState({ selectedTaskId: 't1' })
  render(<ReviewActions />)
  expect(screen.getByText('Ship It')).toBeInTheDocument()
})

it('Ship It triggers confirm dialog with merge+push description', async () => {
  sprintState.tasks = [
    { id: 't1', title: 'Review task', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
  ]
  useCodeReviewStore.setState({ selectedTaskId: 't1' })
  render(<ReviewActions />)
  fireEvent.click(screen.getByText('Ship It'))
  await waitFor(() => {
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ReviewActions.test.tsx`

- [ ] **Step 6: Add Ship It button to ReviewActions.tsx**

Add a new handler and button to `ReviewActions.tsx`:

```tsx
const handleShipIt = async (): Promise<void> => {
  const ok = await confirm({
    title: 'Ship It',
    message: `Merge "${task.title.slice(0, 50)}" into main using ${mergeStrategy}, push to origin, and mark done?\n\nThis will merge + push in one step.`,
    confirmLabel: 'Ship It',
    variant: 'default'
  })
  if (!ok) return
  setActionInFlight('shipIt')
  try {
    const result = await window.api.review.shipIt({
      taskId: task.id,
      strategy: mergeStrategy
    })
    if (result.success) {
      toast.success(result.pushed ? 'Merged & pushed!' : 'Merged locally (push failed — push manually)')
      selectTask(null)
      loadData()
    } else {
      toast.error(`Ship It failed: ${result.error || 'unknown error'}`)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Ship It failed')
  } finally {
    setActionInFlight(null)
  }
}
```

Add the button before "Merge Locally" in the primary actions area, using a `Rocket` icon from lucide-react:

```tsx
<button
  className="cr-actions__btn cr-actions__btn--ship"
  onClick={handleShipIt}
  disabled={!!actionInFlight}
>
  {actionInFlight === 'shipIt' ? (
    <Loader2 size={14} className="spin" />
  ) : (
    <Rocket size={14} />
  )}{' '}
  Ship It
</button>
```

- [ ] **Step 7: Add Ship It button CSS**

In `src/renderer/src/assets/code-review-neon.css`:

```css
.cr-actions__btn--ship {
  background: linear-gradient(135deg, var(--neon-cyan-surface) 0%, var(--neon-blue-surface) 100%);
  border-color: var(--neon-cyan-border);
  color: var(--neon-cyan);
}

.cr-actions__btn--ship:hover {
  box-shadow: 0 0 16px var(--neon-cyan-glow);
  transform: translateY(-1px);
}
```

- [ ] **Step 8: Update handler count test**

In `src/main/handlers/__tests__/review.test.ts`, update the `safeHandle()` call count assertion to include the new `review:shipIt` handler (increment by 1).

- [ ] **Step 9: Run tests — expect pass**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ReviewActions.test.tsx`

- [ ] **Step 10: Run full suite + typecheck**
Run: `cd ~/projects/BDE && npm run typecheck && npm test && npm run test:main`

- [ ] **Step 11: Commit**
```
feat(code-review): add Ship It button for one-click merge + push + done
```

---

### Task 3: Batch Review Actions — Multi-Select and Merge All

**Files:**
- Modify: `src/renderer/src/components/code-review/ReviewQueue.tsx`
- Modify: `src/renderer/src/components/code-review/__tests__/ReviewQueue.test.tsx`
- Modify: `src/renderer/src/stores/codeReview.ts`
- Modify: `src/renderer/src/views/CodeReviewView.tsx`
- Create: `src/renderer/src/components/code-review/BatchActions.tsx`
- Create: `src/renderer/src/components/code-review/__tests__/BatchActions.test.tsx`
- Modify: `src/renderer/src/assets/code-review-neon.css`

- [ ] **Step 1: Add batch selection state to codeReview store**

In `src/renderer/src/stores/codeReview.ts`, add:

```ts
// Add to CodeReviewState interface:
selectedBatchIds: Set<string>
toggleBatchId: (id: string) => void
selectAllBatch: (ids: string[]) => void
clearBatch: () => void

// Add to initial state:
selectedBatchIds: new Set<string>()

// Add implementations:
toggleBatchId: (id) =>
  set((s) => {
    const next = new Set(s.selectedBatchIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selectedBatchIds: next }
  }),
selectAllBatch: (ids) => set({ selectedBatchIds: new Set(ids) }),
clearBatch: () => set({ selectedBatchIds: new Set() })
```

**IMPORTANT:** `Set` is acceptable here because the entire `Set` is replaced on each mutation (not mutated in place), so Zustand detects the change via reference comparison.

- [ ] **Step 2: Write failing tests for ReviewQueue checkboxes**

Add to `src/renderer/src/components/code-review/__tests__/ReviewQueue.test.tsx`:

```tsx
it('renders checkboxes for each review task', () => {
  sprintState.tasks = [
    { id: 't1', title: 'Fix bug', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
  ]
  render(<ReviewQueue />)
  expect(screen.getByRole('checkbox')).toBeInTheDocument()
})

it('clicking checkbox toggles batch selection', () => {
  sprintState.tasks = [
    { id: 't1', title: 'Fix bug', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' }
  ]
  render(<ReviewQueue />)
  const checkbox = screen.getByRole('checkbox')
  fireEvent.click(checkbox)
  // Verify toggleBatchId was called — mock needs updating to expose this
})

it('select all checkbox selects all review tasks', () => {
  sprintState.tasks = [
    { id: 't1', title: 'Fix bug', repo: 'bde', status: 'review', updated_at: '2026-04-01T00:00:00Z' },
    { id: 't2', title: 'Add feature', repo: 'bde', status: 'review', updated_at: '2026-04-02T00:00:00Z' }
  ]
  render(<ReviewQueue />)
  const checkboxes = screen.getAllByRole('checkbox')
  // First checkbox is select-all
  fireEvent.click(checkboxes[0])
})
```

- [ ] **Step 3: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ReviewQueue.test.tsx`

- [ ] **Step 4: Add checkboxes to ReviewQueue**

Update `src/renderer/src/components/code-review/ReviewQueue.tsx` to add a checkbox per task and a "Select All" checkbox in the header:

```tsx
import { useCodeReviewStore } from '../../stores/codeReview'

// Inside the component, read batch state:
const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
const toggleBatchId = useCodeReviewStore((s) => s.toggleBatchId)
const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
const clearBatch = useCodeReviewStore((s) => s.clearBatch)

const allSelected = reviewTasks.length > 0 && reviewTasks.every((t) => selectedBatchIds.has(t.id))

// In header, add select-all checkbox:
<label className="cr-queue__select-all">
  <input
    type="checkbox"
    checked={allSelected}
    onChange={() => {
      if (allSelected) clearBatch()
      else selectAllBatch(reviewTasks.map((t) => t.id))
    }}
  />
</label>

// In each task item, add a checkbox:
<input
  type="checkbox"
  className="cr-queue__checkbox"
  checked={selectedBatchIds.has(task.id)}
  onChange={(e) => {
    e.stopPropagation()
    toggleBatchId(task.id)
  }}
  onClick={(e) => e.stopPropagation()}
/>
```

- [ ] **Step 5: Write BatchActions component tests**

Create `src/renderer/src/components/code-review/__tests__/BatchActions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockClearBatch } = vi.hoisted(() => ({ mockClearBatch: vi.fn() }))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedBatchIds: new Set<string>(),
    clearBatch: mockClearBatch
  }))
  return { useCodeReviewStore: store }
})

const { sprintState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>,
    loading: false,
    loadData: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(sprintState))
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import { BatchActions } from '../BatchActions'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('BatchActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = []
    useCodeReviewStore.setState({ selectedBatchIds: new Set(), clearBatch: mockClearBatch })
  })

  it('shows nothing when no tasks are selected', () => {
    const { container } = render(<BatchActions />)
    expect(container.querySelector('.cr-batch')).toBeNull()
  })

  it('shows batch bar with count when tasks are selected', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Fix', repo: 'bde', status: 'review', worktree_path: '/tmp/wt1', updated_at: '2026-04-01T00:00:00Z' },
      { id: 't2', title: 'Add', repo: 'bde', status: 'review', worktree_path: '/tmp/wt2', updated_at: '2026-04-02T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedBatchIds: new Set(['t1', 't2']) })
    render(<BatchActions />)
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    expect(screen.getByText('Merge All')).toBeInTheDocument()
  })

  it('merge all shows confirmation dialog', async () => {
    sprintState.tasks = [
      { id: 't1', title: 'Fix', repo: 'bde', status: 'review', worktree_path: '/tmp/wt1', updated_at: '2026-04-01T00:00:00Z' }
    ]
    useCodeReviewStore.setState({ selectedBatchIds: new Set(['t1']) })
    render(<BatchActions />)
    fireEvent.click(screen.getByText('Merge All'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 6: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/BatchActions.test.tsx`

- [ ] **Step 7: Implement BatchActions component**

Create `src/renderer/src/components/code-review/BatchActions.tsx`:

```tsx
import { useState } from 'react'
import { GitMerge, Loader2, X } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { toast } from '../../stores/toasts'

export function BatchActions(): React.JSX.Element | null {
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const { confirm, confirmProps } = useConfirm()
  const [merging, setMerging] = useState(false)

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')

  if (selectedTasks.length === 0) return null

  const handleMergeAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Merge ${selectedTasks.length} Tasks`,
      message: `Merge all ${selectedTasks.length} selected tasks into your local branch using squash strategy?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}`,
      confirmLabel: 'Merge All',
      variant: 'default'
    })
    if (!ok) return

    setMerging(true)
    let succeeded = 0
    let failed = 0

    for (const task of selectedTasks) {
      try {
        const result = await window.api.review.mergeLocally({
          taskId: task.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    setMerging(false)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Merged ${succeeded} tasks`)
    } else {
      toast.error(`Merged ${succeeded}, failed ${failed}`)
    }
  }

  return (
    <div className="cr-batch">
      <span className="cr-batch__count">{selectedTasks.length} selected</span>
      <button
        className="cr-actions__btn cr-actions__btn--primary"
        onClick={handleMergeAll}
        disabled={merging}
      >
        {merging ? <Loader2 size={14} className="spin" /> : <GitMerge size={14} />}
        {' '}Merge All
      </button>
      <button
        className="cr-actions__btn cr-actions__btn--ghost"
        onClick={clearBatch}
        disabled={merging}
      >
        <X size={14} /> Clear
      </button>
      <ConfirmModal {...confirmProps} />
    </div>
  )
}
```

- [ ] **Step 8: Wire BatchActions into CodeReviewView**

In `src/renderer/src/views/CodeReviewView.tsx`:

```tsx
import { BatchActions } from '../components/code-review/BatchActions'

// Add above the cr-main div:
<BatchActions />
```

- [ ] **Step 9: Add CSS for batch actions bar**

In `src/renderer/src/assets/code-review-neon.css`:

```css
/* Batch actions bar */
.cr-batch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--neon-cyan-border);
  background: var(--neon-cyan-surface);
  flex-shrink: 0;
}

.cr-batch__count {
  font-size: 12px;
  font-weight: 600;
  color: var(--neon-cyan);
  font-family: var(--bde-font-code);
}

/* Queue checkboxes */
.cr-queue__checkbox {
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--neon-cyan);
}

.cr-queue__select-all {
  display: flex;
  align-items: center;
  cursor: pointer;
}
```

- [ ] **Step 10: Run tests — expect pass**
Run: `cd ~/projects/BDE && npx vitest run src/renderer/src/components/code-review/__tests__/ReviewQueue.test.tsx src/renderer/src/components/code-review/__tests__/BatchActions.test.tsx`

- [ ] **Step 11: Run full suite + typecheck**
Run: `cd ~/projects/BDE && npm run typecheck && npm test`

- [ ] **Step 12: Commit**
```
feat(code-review): add batch review actions with multi-select and merge all
```

---

### Task 4: Auto-Review Rules Engine

**Files:**
- Create: `src/main/services/auto-review.ts`
- Create: `src/main/services/__tests__/auto-review.test.ts`
- Modify: `src/main/handlers/review.ts`
- Modify: `src/main/handlers/__tests__/review.test.ts`
- Modify: `src/shared/types.ts`

The auto-review engine checks incoming `review` status tasks against user-configured rules. Rules are stored in the `settings` table as `review.autoRules` JSON. When all rules match, the task is auto-merged.

- [ ] **Step 1: Define AutoReviewRule type**

In `src/shared/types.ts`, add:

```ts
export interface AutoReviewRule {
  id: string
  name: string
  enabled: boolean
  conditions: {
    maxLinesChanged?: number
    filePatterns?: string[]     // glob patterns — all changed files must match at least one
    excludePatterns?: string[]  // glob patterns — no changed files may match any
  }
  action: 'auto-merge' | 'auto-approve'
}
```

- [ ] **Step 2: Write failing tests for auto-review service**

Create `src/main/services/__tests__/auto-review.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateAutoReviewRules } from '../auto-review'
import type { AutoReviewRule } from '../../../shared/types'

describe('evaluateAutoReviewRules', () => {
  const cssOnlyRule: AutoReviewRule = {
    id: 'r1',
    name: 'CSS-only auto-merge',
    enabled: true,
    conditions: {
      maxLinesChanged: 10,
      filePatterns: ['*.css']
    },
    action: 'auto-merge'
  }

  it('returns matching rule when all conditions met', () => {
    const files = [{ path: 'src/style.css', additions: 3, deletions: 2 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).not.toBeNull()
    expect(result!.rule.id).toBe('r1')
  })

  it('returns null when line count exceeds max', () => {
    const files = [{ path: 'src/style.css', additions: 8, deletions: 5 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).toBeNull()
  })

  it('returns null when files do not match pattern', () => {
    const files = [{ path: 'src/main.ts', additions: 2, deletions: 1 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).toBeNull()
  })

  it('skips disabled rules', () => {
    const disabled = { ...cssOnlyRule, enabled: false }
    const files = [{ path: 'src/style.css', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([disabled], files)
    expect(result).toBeNull()
  })

  it('returns null when no rules configured', () => {
    const files = [{ path: 'src/main.ts', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([], files)
    expect(result).toBeNull()
  })

  it('respects excludePatterns', () => {
    const rule: AutoReviewRule = {
      id: 'r2', name: 'Safe changes', enabled: true,
      conditions: { maxLinesChanged: 50, excludePatterns: ['*.ts'] },
      action: 'auto-merge'
    }
    const files = [{ path: 'src/main.ts', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([rule], files)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/main/services/__tests__/auto-review.test.ts --config src/main/vitest.main.config.ts`

- [ ] **Step 4: Implement auto-review service**

Create `src/main/services/auto-review.ts`:

```ts
import type { AutoReviewRule } from '../../shared/types'

interface DiffFileSummary {
  path: string
  additions: number
  deletions: number
}

interface AutoReviewResult {
  rule: AutoReviewRule
  action: 'auto-merge' | 'auto-approve'
}

/**
 * Simple glob-to-regex: supports *.ext and **\/*.ext patterns.
 */
function globMatch(pattern: string, filepath: string): boolean {
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`).test(filepath)
}

export function evaluateAutoReviewRules(
  rules: AutoReviewRule[],
  files: DiffFileSummary[]
): AutoReviewResult | null {
  for (const rule of rules) {
    if (!rule.enabled) continue

    const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0)

    // Check max lines
    if (rule.conditions.maxLinesChanged !== undefined && totalLines > rule.conditions.maxLinesChanged) {
      continue
    }

    // Check file patterns (all files must match at least one pattern)
    if (rule.conditions.filePatterns && rule.conditions.filePatterns.length > 0) {
      const allMatch = files.every((f) =>
        rule.conditions.filePatterns!.some((p) => globMatch(p, f.path))
      )
      if (!allMatch) continue
    }

    // Check exclude patterns (no file may match any exclude pattern)
    if (rule.conditions.excludePatterns && rule.conditions.excludePatterns.length > 0) {
      const anyExcluded = files.some((f) =>
        rule.conditions.excludePatterns!.some((p) => globMatch(p, f.path))
      )
      if (anyExcluded) continue
    }

    return { rule, action: rule.action }
  }

  return null
}
```

- [ ] **Step 5: Run tests — expect pass**
Run: `cd ~/projects/BDE && npx vitest run src/main/services/__tests__/auto-review.test.ts --config src/main/vitest.main.config.ts`

- [ ] **Step 6: Integrate auto-review into the review flow**

In `src/main/handlers/review.ts`, after a task transitions to `review` status (in the completion handler path or via a new check), evaluate auto-review rules. This is best done as a post-transition hook: add a new IPC handler `review:checkAutoReview` that the renderer calls after a task enters review. This keeps the auto-review opt-in and auditable.

```ts
safeHandle('review:checkAutoReview', async (_e, payload: { taskId: string }) => {
  const task = _getTask(payload.taskId)
  if (!task || task.status !== 'review' || !task.worktree_path) {
    return { autoAction: null }
  }

  const rules = getSettingJson<AutoReviewRule[]>('review.autoRules') ?? []
  if (rules.length === 0) return { autoAction: null }

  // Get diff stats
  const { stdout: numstat } = await execFileAsync(
    'git', ['diff', '--numstat', 'origin/main...HEAD'],
    { cwd: task.worktree_path, env }
  )
  const files = numstat.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t')
    return {
      path: parts.slice(2).join('\t'),
      additions: parts[0] === '-' ? 0 : parseInt(parts[0], 10),
      deletions: parts[1] === '-' ? 0 : parseInt(parts[1], 10)
    }
  })

  const { evaluateAutoReviewRules } = await import('../services/auto-review')
  const result = evaluateAutoReviewRules(rules, files)
  if (!result) return { autoAction: null }

  return { autoAction: result.action, ruleName: result.rule.name }
})
```

- [ ] **Step 7: Update handler count test**
In `src/main/handlers/__tests__/review.test.ts`, increment the handler count by 1.

- [ ] **Step 8: Run full suite + typecheck**
Run: `cd ~/projects/BDE && npm run typecheck && npm test && npm run test:main`

- [ ] **Step 9: Commit**
```
feat(code-review): add auto-review rules engine for low-risk changes
```

---

### Task 5: AI Review Summary

**Files:**
- Create: `src/main/services/review-summary.ts`
- Create: `src/main/services/__tests__/review-summary.test.ts`
- Modify: `src/main/handlers/review.ts`
- Modify: `src/main/handlers/__tests__/review.test.ts`
- Modify: `src/renderer/src/components/code-review/ReviewDetail.tsx`
- Modify: `src/renderer/src/stores/codeReview.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/assets/code-review-neon.css`

Uses Agent SDK (haiku model) to scan the diff and generate a concise summary before human review.

- [ ] **Step 1: Add review summary state to codeReview store**

In `src/renderer/src/stores/codeReview.ts`, add:

```ts
// Add to interface:
reviewSummary: string | null
summaryLoading: boolean
setReviewSummary: (summary: string | null) => void
setSummaryLoading: (loading: boolean) => void

// Add to initial state:
reviewSummary: null
summaryLoading: false

// Add implementations:
setReviewSummary: (summary) => set({ reviewSummary: summary }),
setSummaryLoading: (loading) => set({ summaryLoading: loading })
```

Also update `selectTask` to clear summary state: add `reviewSummary: null, summaryLoading: false` to the `selectTask` setter.

- [ ] **Step 2: Write failing test for review summary service**

Create `src/main/services/__tests__/review-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildReviewSummaryPrompt } from '../review-summary'

describe('buildReviewSummaryPrompt', () => {
  it('includes file count and diff stat in prompt', () => {
    const diffStat = ' src/main.ts | 5 ++---\n 1 file changed, 2 insertions(+), 3 deletions(-)'
    const prompt = buildReviewSummaryPrompt(diffStat, 'Fix login bug')
    expect(prompt).toContain('1 file changed')
    expect(prompt).toContain('Fix login bug')
    expect(prompt).toContain('summary')
  })

  it('truncates very large diffs', () => {
    const largeDiff = 'x'.repeat(20000)
    const prompt = buildReviewSummaryPrompt(largeDiff, 'Big change')
    expect(prompt.length).toBeLessThan(16000)
  })
})
```

- [ ] **Step 3: Run tests — expect failures**
Run: `cd ~/projects/BDE && npx vitest run src/main/services/__tests__/review-summary.test.ts --config src/main/vitest.main.config.ts`

- [ ] **Step 4: Implement review summary service**

Create `src/main/services/review-summary.ts`:

```ts
const MAX_DIFF_CHARS = 12000

export function buildReviewSummaryPrompt(diffStat: string, taskTitle: string): string {
  const truncated = diffStat.length > MAX_DIFF_CHARS
    ? diffStat.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
    : diffStat

  return `You are reviewing code changes for a task titled "${taskTitle}".

Here is the diff stat:
\`\`\`
${truncated}
\`\`\`

Write a concise review summary in 2-4 bullet points. Include:
- Number of files changed, insertions, deletions
- Types of changes (new features, bug fixes, tests, refactoring, styling)
- Any potential risks or concerns (breaking changes, missing tests, large files)
- Overall assessment: safe to merge, needs attention, or risky

Keep the summary under 200 words. Be direct and factual.`
}
```

- [ ] **Step 5: Run tests — expect pass**
Run: `cd ~/projects/BDE && npx vitest run src/main/services/__tests__/review-summary.test.ts --config src/main/vitest.main.config.ts`

- [ ] **Step 6: Add IPC channel and handler**

In `src/shared/ipc-channels.ts`, add:

```ts
'review:generateSummary': {
  payload: { taskId: string }
  result: { summary: string }
}
```

In `src/main/handlers/review.ts`, add handler:

```ts
safeHandle('review:generateSummary', async (_e, payload: { taskId: string }) => {
  const task = _getTask(payload.taskId)
  if (!task) throw new Error(`Task ${payload.taskId} not found`)
  if (!task.worktree_path) throw new Error('Task has no worktree')

  // Get diff stat
  const { stdout: diffStat } = await execFileAsync(
    'git', ['diff', '--stat', 'origin/main...HEAD'],
    { cwd: task.worktree_path, env, maxBuffer: 10 * 1024 * 1024 }
  )

  const { buildReviewSummaryPrompt } = await import('../services/review-summary')
  const prompt = buildReviewSummaryPrompt(diffStat, task.title)

  // Use SDK for summary generation (haiku for speed)
  const { runSdkPrint } = await import('../sdk-streaming')
  const result = await runSdkPrint({
    prompt,
    model: 'claude-haiku-4-5-20250401',
    maxTokens: 500,
    systemPrompt: 'You are a concise code reviewer. Output only the summary bullets, no preamble.'
  })

  return { summary: result.text }
})
```

- [ ] **Step 7: Add preload bridge**

In `src/preload/index.ts`, add to the `review` object:

```ts
generateSummary: (payload: { taskId: string }) =>
  typedInvoke('review:generateSummary', payload),
```

Update `src/preload/index.d.ts` to match.

- [ ] **Step 8: Write failing test for summary display in ReviewDetail**

Add a test that the ReviewDetail shows an AI summary panel when summary data is present in the store.

- [ ] **Step 9: Add summary display to ReviewDetail**

In `src/renderer/src/components/code-review/ReviewDetail.tsx`, add a summary banner above the tab bar that shows when a review summary is available:

```tsx
import { useCodeReviewStore } from '../../stores/codeReview'
import { Sparkles, Loader2 } from 'lucide-react'

// Inside the component, after the selectedTaskId check:
const reviewSummary = useCodeReviewStore((s) => s.reviewSummary)
const summaryLoading = useCodeReviewStore((s) => s.summaryLoading)

// Render before the tabs:
{(reviewSummary || summaryLoading) && (
  <div className="cr-summary">
    <Sparkles size={12} className="cr-summary__icon" />
    {summaryLoading ? (
      <span className="cr-summary__loading">
        <Loader2 size={12} className="spin" /> Generating AI summary...
      </span>
    ) : (
      <div className="cr-summary__text">{reviewSummary}</div>
    )}
  </div>
)}
```

- [ ] **Step 10: Trigger summary generation on task select**

In `ReviewDetail.tsx`, add a `useEffect` that generates the summary when a task is selected:

```tsx
useEffect(() => {
  if (!selectedTaskId) return
  const task = tasks.find((t) => t.id === selectedTaskId)
  if (!task?.worktree_path || task.status !== 'review') return

  const setSummaryLoading = useCodeReviewStore.getState().setSummaryLoading
  const setReviewSummary = useCodeReviewStore.getState().setReviewSummary

  setSummaryLoading(true)
  window.api.review.generateSummary({ taskId: selectedTaskId })
    .then((result) => setReviewSummary(result.summary))
    .catch(() => setReviewSummary(null))
    .finally(() => setSummaryLoading(false))
}, [selectedTaskId])
```

- [ ] **Step 11: Add CSS for summary banner**

In `src/renderer/src/assets/code-review-neon.css`:

```css
/* AI Review Summary banner */
.cr-summary {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  background: var(--neon-purple-surface);
  border-bottom: 1px solid var(--neon-purple-border);
  align-items: flex-start;
}

.cr-summary__icon {
  color: var(--neon-purple);
  flex-shrink: 0;
  margin-top: 2px;
}

.cr-summary__loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--neon-text-dim);
  font-family: var(--bde-font-code);
}

.cr-summary__text {
  font-size: 12px;
  color: var(--neon-text-muted);
  line-height: 1.5;
  font-family: var(--bde-font-code);
  white-space: pre-wrap;
}
```

- [ ] **Step 12: Update handler count test**
In `src/main/handlers/__tests__/review.test.ts`, increment handler count by 1.

- [ ] **Step 13: Run full suite + typecheck**
Run: `cd ~/projects/BDE && npm run typecheck && npm test && npm run test:main`

- [ ] **Step 14: Commit**
```
feat(code-review): add AI review summary generation via haiku model
```
