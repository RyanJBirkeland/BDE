# Unified Roadmap — 14 Features & Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the agent pipeline drain loop, then build out infrastructure, features, quality, and research items across 4 phases.

**Architecture:** Phase 0 cleans up vestigial Queue API references in the agent manager. Phases 1-3 add new modules alongside existing code. Phase 4 is documentation only.

**Tech Stack:** TypeScript, Electron IPC, SQLite (better-sqlite3), React + Zustand, Vitest

---

## Phase 0 — Critical Pipeline Fix

### Task 1: Clean up drain loop — remove vestigial Queue API mapping

The drain loop's `fetchQueuedTasks()` already delegates to `this.repo.getQueuedTasks(limit)` (line 258 of `index.ts`), so it IS using the repository. However, two problems remain:

1. **Misleading log message** on line 523: says "Fetching queued tasks via Queue API" — confusing for debugging
2. **`_mapQueuedTask()` does unnecessary camelCase-to-snake_case remapping** (lines 302-344): it converts `retryCount` to `retry_count`, `fastFailCount` to `fast_fail_count`, etc. But `getQueuedTasks()` returns `SprintTask[]` from SQLite which already uses snake_case. The mapper silently produces `0` for `retry_count` (because `Number(undefined)` = `NaN` then `|| 0`) instead of preserving the actual value.
3. **`claimTaskViaApi()` name** is misleading — it calls `this.repo.claimTask()` directly, not an API.

This means **retry counts are silently reset to 0 every drain cycle**, causing tasks to retry forever instead of failing after 3 attempts.

**Files:**

- Modify: `src/main/agent-manager/index.ts`
- Modify: `src/main/agent-manager/__tests__/index-methods.test.ts`

- [ ] **Step 1: Write failing test for retry_count preservation**

In `index-methods.test.ts`, add a test that verifies `_mapQueuedTask` preserves `retry_count` from the SQLite row (snake_case) rather than looking for `retryCount` (camelCase):

```typescript
it('_mapQueuedTask preserves retry_count from SQLite row', () => {
  const raw = {
    id: 'task-1',
    title: 'Test task',
    repo: 'bde',
    prompt: 'do the thing',
    spec: null,
    retry_count: 2,
    fast_fail_count: 1,
    notes: null,
    playground_enabled: 1,
    max_runtime_ms: 300000,
    max_cost_usd: null,
    model: 'claude-sonnet-4-5'
  }
  const result = mgr._mapQueuedTask(raw)
  expect(result).not.toBeNull()
  expect(result!.retry_count).toBe(2)
  expect(result!.fast_fail_count).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent-manager/__tests__/index-methods.test.ts --reporter=verbose`
Expected: FAIL — `_mapQueuedTask` reads `retryCount` (camelCase) which is `undefined`, producing `0` instead of `2`.

- [ ] **Step 3: Simplify `_mapQueuedTask` to pass through SQLite fields directly**

Replace the entire `_mapQueuedTask` method in `src/main/agent-manager/index.ts` (lines 302-344):

```typescript
_mapQueuedTask(raw: Record<string, unknown>): {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
  notes: string | null
  playground_enabled: boolean
  max_runtime_ms: number | null
  max_cost_usd: number | null
  model: string | null
} | null {
  // Validate required fields
  if (!raw.id || typeof raw.id !== 'string') {
    this.logger.warn(`[agent-manager] Task missing or invalid 'id' field: ${JSON.stringify(raw)}`)
    return null
  }
  if (!raw.title || typeof raw.title !== 'string') {
    this.logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'title' field`)
    return null
  }
  if (!raw.repo || typeof raw.repo !== 'string') {
    this.logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'repo' field`)
    return null
  }

  // Fields come from SQLite via getQueuedTasks() — already snake_case
  return {
    id: raw.id,
    title: raw.title,
    prompt: (raw.prompt as string) ?? null,
    spec: (raw.spec as string) ?? null,
    repo: raw.repo,
    retry_count: Number(raw.retry_count) || 0,
    fast_fail_count: Number(raw.fast_fail_count) || 0,
    notes: (raw.notes as string) ?? null,
    playground_enabled: Boolean(raw.playground_enabled),
    max_runtime_ms: Number(raw.max_runtime_ms) || null,
    max_cost_usd: Number(raw.max_cost_usd) || null,
    model: (raw.model as string) ?? null
  }
}
```

- [ ] **Step 4: Rename misleading methods and log messages**

In `src/main/agent-manager/index.ts`:

1. Rename `claimTaskViaApi` to `claimTask` (line 262)
2. Update its call site at line 453: `this.claimTask(task.id)`
3. Fix log message on line 523: change `"Fetching queued tasks via Queue API"` to `"Fetching queued tasks from SQLite"`

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/main/agent-manager/__tests__/index-methods.test.ts --reporter=verbose
npx vitest run src/main/agent-manager/__tests__/index-extracted.test.ts --reporter=verbose
npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index-methods.test.ts
git commit -m "fix: drain loop _mapQueuedTask reads snake_case fields from SQLite instead of camelCase"
```

---

## Phase 1 — Pipeline Infrastructure

### Task 2: Sequential agent branching — fetch latest main before worktree creation

Currently `setupWorktree()` creates a branch from whatever HEAD the local repo has. If the user hasn't pulled recently, agents branch from stale code and produce conflicting PRs. Fix: `git fetch origin main` and fast-forward before creating the worktree.

**Depends on:** Task 1 (pipeline must be working)

**Files:**

- Modify: `src/main/agent-manager/worktree.ts`
- Test: `src/main/agent-manager/__tests__/worktree.test.ts`

- [ ] **Step 1: Write failing test**

In `worktree.test.ts`, add a test verifying `setupWorktree` calls `git fetch origin main` before `git worktree add`:

```typescript
it('fetches latest main before creating worktree', async () => {
  const calls: string[][] = []
  execFileMock.mockImplementation((_cmd, args, _opts) => {
    calls.push(args as string[])
    return Promise.resolve({ stdout: '', stderr: '' })
  })
  await setupWorktree({ repoPath: '/repo', worktreeBase: '/wt', taskId: 'abc', title: 'test' })
  const fetchIdx = calls.findIndex((a) => a[0] === 'fetch' && a.includes('origin'))
  const worktreeIdx = calls.findIndex((a) => a[0] === 'worktree' && a[1] === 'add')
  expect(fetchIdx).toBeGreaterThanOrEqual(0)
  expect(worktreeIdx).toBeGreaterThan(fetchIdx)
})
```

- [ ] **Step 2: Run test — verify failure**

```bash
npx vitest run src/main/agent-manager/__tests__/worktree.test.ts --reporter=verbose
```

- [ ] **Step 3: Add fetch + fast-forward to `setupWorktree`**

In `src/main/agent-manager/worktree.ts`, inside `setupWorktree()` after `nukeStaleState()` (line 212) and before `git worktree add` (line 215), add:

```typescript
// Fetch latest main to reduce merge conflicts on agent branches
try {
  await execFileAsync('git', ['fetch', 'origin', 'main', '--no-tags'], {
    cwd: repoPath,
    env,
    timeout: 30_000
  })
  // Fast-forward local main to match origin (non-destructive — only if it's a fast-forward)
  await execFileAsync('git', ['merge', '--ff-only', 'origin/main'], {
    cwd: repoPath,
    env,
    timeout: 10_000
  })
  log.info(`[worktree] Fetched and fast-forwarded main for task ${taskId}`)
} catch (err) {
  // Non-fatal — proceed with whatever HEAD we have
  log.warn(`[worktree] Failed to fetch/ff main (proceeding anyway): ${err}`)
}
```

- [ ] **Step 4: Run all worktree tests + typecheck**

```bash
npx vitest run src/main/agent-manager/__tests__/worktree.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/worktree.ts src/main/agent-manager/__tests__/worktree.test.ts
git commit -m "feat: fetch latest main before worktree creation to reduce agent merge conflicts"
```

---

### Task 3: Plan-to-task spec extractor

Parse plan markdown files (like this one) and extract individual task sections as standalone specs suitable for task creation. Useful for feeding plan docs directly into the task pipeline.

**Depends on:** None (standalone utility)

**Files:**

- Create: `src/main/services/plan-extractor.ts`
- Create: `src/main/services/__tests__/plan-extractor.test.ts`
- Modify: `src/main/handlers/workbench.ts` (add IPC handler)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`

- [ ] **Step 1: Write tests for the extractor**

Create `src/main/services/__tests__/plan-extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { extractTasksFromPlan } from '../plan-extractor'

describe('extractTasksFromPlan', () => {
  it('extracts ### Task N: sections with content', () => {
    const md = `# Plan\n\n## Phase 1\n\n### Task 1: Fix the thing\n\nDo A then B.\n\n**Files:**\n- foo.ts\n\n### Task 2: Add feature\n\nDo C.\n`
    const tasks = extractTasksFromPlan(md)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].title).toBe('Fix the thing')
    expect(tasks[0].spec).toContain('Do A then B')
    expect(tasks[0].spec).toContain('**Files:**')
    expect(tasks[0].taskNumber).toBe(1)
    expect(tasks[1].title).toBe('Add feature')
    expect(tasks[1].taskNumber).toBe(2)
  })

  it('returns empty array for plan with no ### Task sections', () => {
    const md = `# Just a doc\n\nSome text.`
    expect(extractTasksFromPlan(md)).toEqual([])
  })

  it('extracts depends_on references from "Depends on: Task N" lines', () => {
    const md = `### Task 3: Downstream\n\n**Depends on:** Task 1, Task 2\n\nContent.`
    const tasks = extractTasksFromPlan(md)
    expect(tasks[0].dependsOnTaskNumbers).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Implement the extractor**

Create `src/main/services/plan-extractor.ts`:

```typescript
export interface ExtractedTask {
  taskNumber: number
  title: string
  spec: string
  phase: string | null
  dependsOnTaskNumbers: number[]
}

const TASK_HEADING_RE = /^###\s+Task\s+(\d+):\s*(.+)$/
const DEPENDS_RE = /\*\*Depends on:\*\*\s*(.+)/i
const PHASE_RE = /^##\s+(Phase\s+\d+\S*)\s*/

export function extractTasksFromPlan(markdown: string): ExtractedTask[] {
  const lines = markdown.split('\n')
  const tasks: ExtractedTask[] = []
  let currentPhase: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const phaseMatch = lines[i].match(PHASE_RE)
    if (phaseMatch) {
      currentPhase = phaseMatch[1]
      continue
    }

    const taskMatch = lines[i].match(TASK_HEADING_RE)
    if (!taskMatch) continue

    const taskNumber = parseInt(taskMatch[1], 10)
    const title = taskMatch[2].trim()

    // Collect body until next ### heading or end of file
    const bodyLines: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j].match(/^###\s/)) {
      bodyLines.push(lines[j])
      j++
    }
    const spec = bodyLines.join('\n').trim()

    // Extract depends_on references
    const depsMatch = spec.match(DEPENDS_RE)
    const dependsOnTaskNumbers: number[] = []
    if (depsMatch) {
      const refs = depsMatch[1].matchAll(/Task\s+(\d+)/gi)
      for (const ref of refs) {
        dependsOnTaskNumbers.push(parseInt(ref[1], 10))
      }
    }

    tasks.push({ taskNumber, title, spec, phase: currentPhase, dependsOnTaskNumbers })
  }

  return tasks
}
```

- [ ] **Step 3: Add IPC handler in workbench handlers**

In `src/main/handlers/workbench.ts`, add:

```typescript
import { extractTasksFromPlan } from '../services/plan-extractor'

safeHandle('workbench:extractPlanTasks', async (_e, markdown: string) => {
  return extractTasksFromPlan(markdown)
})
```

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, add to the workbench section:
```typescript
extractPlanTasks: (markdown: string) => ipcRenderer.invoke('workbench:extractPlanTasks', markdown),
```

In `src/preload/index.d.ts`, add the type:
```typescript
extractPlanTasks: (markdown: string) => Promise<Array<{ taskNumber: number; title: string; spec: string; phase: string | null; dependsOnTaskNumbers: number[] }>>
```

- [ ] **Step 5: Run tests + typecheck**

```bash
npx vitest run src/main/services/__tests__/plan-extractor.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/plan-extractor.ts src/main/services/__tests__/plan-extractor.test.ts \
  src/main/handlers/workbench.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: plan-to-task spec extractor for importing plan markdown into pipeline"
```

---

### Task 4: Status endpoint — lightweight HTTP GET /status on port 18791

A minimal HTTP server that returns agent manager status, queue stats, and health info. Separate from the removed Queue API — this is read-only monitoring.

**Depends on:** Task 1 (needs working agent manager)

**Files:**

- Create: `src/main/services/status-server.ts`
- Create: `src/main/services/__tests__/status-server.test.ts`
- Modify: `src/main/index.ts` (start/stop lifecycle)

- [ ] **Step 1: Write tests**

Create `src/main/services/__tests__/status-server.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStatusServer } from '../status-server'

describe('status-server', () => {
  let server: ReturnType<typeof createStatusServer>

  afterEach(() => {
    server?.stop()
  })

  it('returns JSON status on GET /status', async () => {
    const mockAgentManager = {
      getStatus: vi.fn().mockReturnValue({ running: true, activeAgents: [] }),
      getMetrics: vi.fn().mockReturnValue({ drainLoopCount: 5 })
    }
    const mockRepo = {
      getQueueStats: vi.fn().mockReturnValue({ queued: 2, active: 1, done: 5 })
    }
    server = createStatusServer(mockAgentManager as any, mockRepo as any, 0) // port 0 = random
    const port = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/status`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentManager.running).toBe(true)
    expect(body.queue.queued).toBe(2)
  })

  it('returns 404 on unknown paths', async () => {
    server = createStatusServer({} as any, {} as any, 0)
    const port = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/other`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Implement the server**

Create `src/main/services/status-server.ts`:

```typescript
import http from 'node:http'
import type { AgentManager } from '../agent-manager'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { createLogger } from '../logger'

const logger = createLogger('status-server')

export interface StatusServer {
  start(): Promise<number>
  stop(): void
}

export function createStatusServer(
  agentManager: Pick<AgentManager, 'getStatus' | 'getMetrics'>,
  repo: Pick<ISprintTaskRepository, 'getQueueStats'>,
  port = 18791
): StatusServer {
  let server: http.Server | null = null

  function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (req.method === 'GET' && req.url === '/status') {
      try {
        const status = agentManager.getStatus()
        const metrics = agentManager.getMetrics()
        const queue = repo.getQueueStats()
        const body = JSON.stringify({
          agentManager: status,
          metrics,
          queue,
          ts: new Date().toISOString()
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal error' }))
        logger.error(`[status-server] /status error: ${err}`)
      }
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  }

  return {
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = http.createServer(handleRequest)
        server.listen(port, '127.0.0.1', () => {
          const addr = server!.address()
          const boundPort =
            typeof addr === 'object' && addr ? addr.port : port
          logger.info(
            `[status-server] Listening on 127.0.0.1:${boundPort}`
          )
          resolve(boundPort)
        })
        server.on('error', reject)
      })
    },
    stop(): void {
      server?.close()
      server = null
    }
  }
}
```

- [ ] **Step 3: Wire into app lifecycle**

In `src/main/index.ts`, after the agent manager is created (look for `createAgentManager`):

```typescript
import { createStatusServer } from './services/status-server'

// After agentManager and repo are created:
const statusServer = createStatusServer(agentManager, repo)
statusServer.start().catch((err) =>
  mainLogger.warn(`Status server failed to start: ${err}`)
)

// In app.on('before-quit'):
statusServer.stop()
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run src/main/services/__tests__/status-server.test.ts --config src/main/vitest.main.config.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/status-server.ts src/main/services/__tests__/status-server.test.ts src/main/index.ts
git commit -m "feat: lightweight status server on port 18791 for pipeline monitoring"
```

---

## Phase 2 — Features

### Task 5: Workflow templates — reusable task chain macros

Define named task sequences with pre-wired dependencies. A workflow template is a JSON array of task skeletons; creating a workflow instantiates all tasks with dependency edges.

**Depends on:** Task 1

**Files:**

- Create: `src/shared/workflow-types.ts`
- Create: `src/main/services/workflow-engine.ts`
- Create: `src/main/services/__tests__/workflow-engine.test.ts`
- Modify: `src/main/handlers/sprint-local.ts` (add `sprint:createWorkflow` IPC)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`

- [ ] **Step 1: Define the type**

Create `src/shared/workflow-types.ts`:

```typescript
export interface WorkflowStep {
  title: string
  prompt?: string
  spec?: string
  repo: string
  dependsOnSteps?: number[] // 0-based indices into the workflow steps array
  depType?: 'hard' | 'soft' // defaults to 'hard'
  playgroundEnabled?: boolean
  model?: string
}

export interface WorkflowTemplate {
  name: string
  description: string
  steps: WorkflowStep[]
}
```

- [ ] **Step 2: Implement the workflow engine**

Create `src/main/services/workflow-engine.ts`:

```typescript
import type { WorkflowTemplate } from '../../shared/workflow-types'
import type {
  ISprintTaskRepository,
  CreateTaskInput
} from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency } from '../../shared/types'

export interface WorkflowResult {
  tasks: SprintTask[]
  errors: string[]
}

export function instantiateWorkflow(
  template: WorkflowTemplate,
  repo: ISprintTaskRepository
): WorkflowResult {
  const created: SprintTask[] = []
  const errors: string[] = []

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i]

    // Resolve dependency IDs from step indices
    const dependsOn: TaskDependency[] = []
    if (step.dependsOnSteps) {
      for (const depIdx of step.dependsOnSteps) {
        if (depIdx < 0 || depIdx >= created.length) {
          errors.push(`Step ${i}: dependsOnSteps[${depIdx}] out of range`)
          continue
        }
        dependsOn.push({
          id: created[depIdx].id,
          type: step.depType ?? 'hard'
        })
      }
    }

    const input: CreateTaskInput = {
      title: `[${template.name}] ${step.title}`,
      repo: step.repo,
      prompt: step.prompt,
      spec: step.spec,
      status: dependsOn.length > 0 ? 'blocked' : 'backlog',
      depends_on: dependsOn.length > 0 ? dependsOn : undefined,
      playground_enabled: step.playgroundEnabled,
      model: step.model
    }

    const task = repo.createTask(input)
    if (!task) {
      errors.push(
        `Step ${i}: createTask failed for "${step.title}"`
      )
      break // Stop — later steps may depend on this one
    }
    created.push(task)
  }

  return { tasks: created, errors }
}
```

- [ ] **Step 3: Write tests**

Create `src/main/services/__tests__/workflow-engine.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { instantiateWorkflow } from '../workflow-engine'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import type { WorkflowTemplate } from '../../../shared/workflow-types'

function mockRepo(): ISprintTaskRepository {
  let counter = 0
  return {
    createTask: vi.fn((input) => ({
      id: `task-${++counter}`,
      title: input.title,
      status: input.status ?? 'backlog',
      depends_on: input.depends_on ?? null,
      repo: input.repo
      // ... minimal SprintTask shape
    }))
  } as unknown as ISprintTaskRepository
}

describe('instantiateWorkflow', () => {
  it('creates tasks with dependency edges from step indices', () => {
    const template: WorkflowTemplate = {
      name: 'test-flow',
      description: 'Test',
      steps: [
        { title: 'Step A', repo: 'bde' },
        { title: 'Step B', repo: 'bde', dependsOnSteps: [0] }
      ]
    }
    const repo = mockRepo()
    const result = instantiateWorkflow(template, repo)
    expect(result.tasks).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(repo.createTask).toHaveBeenCalledTimes(2)
    const secondCall = (repo.createTask as any).mock.calls[1][0]
    expect(secondCall.depends_on).toEqual([
      { id: 'task-1', type: 'hard' }
    ])
    expect(secondCall.status).toBe('blocked')
  })
})
```

- [ ] **Step 4: Add IPC handler + preload**

In `src/main/handlers/sprint-local.ts`:
```typescript
import { instantiateWorkflow } from '../services/workflow-engine'
// ... inside registerSprintLocalHandlers:
safeHandle(
  'sprint:createWorkflow',
  async (_e, template: WorkflowTemplate) => {
    return instantiateWorkflow(template, repo)
  }
)
```

Update `src/preload/index.ts` and `src/preload/index.d.ts` accordingly.

- [ ] **Step 5: Run tests + typecheck**

```bash
npx vitest run src/main/services/__tests__/workflow-engine.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/workflow-types.ts src/main/services/workflow-engine.ts \
  src/main/services/__tests__/workflow-engine.test.ts \
  src/main/handlers/sprint-local.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: workflow templates — reusable task chain macros with auto-wired dependencies"
```

---

### Task 6: Batch task import from JSON

Import a JSON file containing an array of task objects (with optional dependency references by title or index). Complementary to Task 3 (plan extractor) — this handles structured JSON, that handles markdown.

**Depends on:** Task 5 (shares `CreateTaskInput` patterns and `sprint-local.ts` handler file)

**Files:**

- Create: `src/main/services/batch-import.ts`
- Create: `src/main/services/__tests__/batch-import.test.ts`
- Modify: `src/main/handlers/sprint-local.ts` (add `sprint:batchImport` IPC)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { batchImportTasks } from '../batch-import'

describe('batchImportTasks', () => {
  it('creates tasks from JSON array and wires deps by index', () => {
    const repo = {
      createTask: vi.fn((input) => ({
        id: `id-${Math.random()}`,
        ...input
      }))
    } as any
    const tasks = [
      {
        title: 'A',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo A'
      },
      {
        title: 'B',
        repo: 'bde',
        spec: '## Intro\n\n## Details\n\nDo B',
        dependsOnIndices: [0]
      }
    ]
    const result = batchImportTasks(tasks, repo)
    expect(result.created).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
  })

  it('validates required fields', () => {
    const repo = { createTask: vi.fn() } as any
    const result = batchImportTasks(
      [{ title: '' } as any],
      repo
    )
    expect(result.errors.length).toBeGreaterThan(0)
    expect(repo.createTask).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement**

Create `src/main/services/batch-import.ts`:

```typescript
import type {
  ISprintTaskRepository,
  CreateTaskInput
} from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency } from '../../shared/types'

export interface BatchTaskInput {
  title: string
  repo: string
  prompt?: string
  spec?: string
  status?: string
  dependsOnIndices?: number[]
  depType?: 'hard' | 'soft'
  playgroundEnabled?: boolean
  model?: string
  tags?: string[]
}

export interface BatchImportResult {
  created: SprintTask[]
  errors: string[]
}

export function batchImportTasks(
  tasks: BatchTaskInput[],
  repo: ISprintTaskRepository
): BatchImportResult {
  const created: SprintTask[] = []
  const errors: string[] = []

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (!t.title || !t.repo) {
      errors.push(`Task[${i}]: missing required title or repo`)
      continue
    }

    const dependsOn: TaskDependency[] = []
    if (t.dependsOnIndices) {
      for (const idx of t.dependsOnIndices) {
        if (idx < 0 || idx >= created.length) {
          errors.push(
            `Task[${i}]: dependsOnIndices[${idx}] out of range`
          )
          continue
        }
        dependsOn.push({
          id: created[idx].id,
          type: t.depType ?? 'hard'
        })
      }
    }

    const input: CreateTaskInput = {
      title: t.title,
      repo: t.repo,
      prompt: t.prompt,
      spec: t.spec,
      status:
        dependsOn.length > 0
          ? 'blocked'
          : (t.status ?? 'backlog'),
      depends_on:
        dependsOn.length > 0 ? dependsOn : undefined,
      playground_enabled: t.playgroundEnabled,
      model: t.model,
      tags: t.tags
    }

    const task = repo.createTask(input)
    if (!task) {
      errors.push(
        `Task[${i}]: createTask failed for "${t.title}"`
      )
      continue
    }
    created.push(task)
  }

  return { created, errors }
}
```

- [ ] **Step 3: Wire IPC handler + preload** (same pattern as Task 5)

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run src/main/services/__tests__/batch-import.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/batch-import.ts src/main/services/__tests__/batch-import.test.ts \
  src/main/handlers/sprint-local.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: batch task import from JSON with dependency wiring"
```

---

### Task 7: Settings profiles — named config snapshots with quick switch

Save and restore named snapshots of BDE settings. Stored in the SQLite `settings` table under `profiles.*` keys.

**Depends on:** None

**Files:**

- Create: `src/main/services/settings-profiles.ts`
- Create: `src/main/services/__tests__/settings-profiles.test.ts`
- Modify: `src/main/handlers/config-handlers.ts` (add IPC handlers)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  saveProfile,
  loadProfile,
  listProfiles,
  deleteProfile
} from '../settings-profiles'

// Mock settings module
vi.mock('../../settings')

describe('settings-profiles', () => {
  it('saves a named profile as JSON in settings table', () => {
    // ... assert setSettingJson called with correct key
  })
  it('loads a profile and returns the settings map', () => {
    // ... assert getSettingJson called, returns snapshot
  })
  it('lists all profile names from manifest', () => {
    // ... assert reads profiles._manifest
  })
  it('deletes a profile and updates manifest', () => {
    // ... assert deleteSetting + setSettingJson for manifest
  })
})
```

- [ ] **Step 2: Implement**

Create `src/main/services/settings-profiles.ts`:

```typescript
import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson
} from '../settings'

const PROFILE_PREFIX = 'profiles.'
const PROFILE_KEYS_TO_SAVE = [
  'agentManager.maxConcurrent',
  'agentManager.worktreeBase',
  'agentManager.maxRuntime',
  'agentManager.defaultModel',
  'appearance.theme',
  'appearance.reducedMotion'
]

export function saveProfile(name: string): void {
  const snapshot: Record<string, string | null> = {}
  for (const key of PROFILE_KEYS_TO_SAVE) {
    snapshot[key] = getSetting(key)
  }
  setSettingJson(`${PROFILE_PREFIX}${name}`, snapshot)
  // Update manifest
  const manifest =
    getSettingJson<string[]>('profiles._manifest') ?? []
  if (!manifest.includes(name)) {
    setSettingJson('profiles._manifest', [...manifest, name])
  }
}

export function loadProfile(
  name: string
): Record<string, string | null> | null {
  return getSettingJson<Record<string, string | null>>(
    `${PROFILE_PREFIX}${name}`
  )
}

export function applyProfile(name: string): boolean {
  const snapshot = loadProfile(name)
  if (!snapshot) return false
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== null) {
      setSetting(key, value)
    } else {
      deleteSetting(key)
    }
  }
  return true
}

export function listProfiles(): string[] {
  return getSettingJson<string[]>('profiles._manifest') ?? []
}

export function deleteProfile(name: string): void {
  deleteSetting(`${PROFILE_PREFIX}${name}`)
  const manifest =
    getSettingJson<string[]>('profiles._manifest') ?? []
  setSettingJson(
    'profiles._manifest',
    manifest.filter((n) => n !== name)
  )
}
```

- [ ] **Step 3: Wire IPC handlers in `config-handlers.ts`**

Add 4 handlers: `config:saveProfile`, `config:loadProfile`, `config:listProfiles`, `config:deleteProfile`.

- [ ] **Step 4: Run tests + typecheck**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: settings profiles — save/load/switch named config snapshots"
```

---

### Task 8: Sprint planning module — sprints table, sprint_id on tasks, burn-down data

Add a `sprints` table to group tasks into time-boxed sprints with start/end dates and burn-down tracking.

**Depends on:** None (data layer only)

**Files:**

- Modify: `src/main/db.ts` (new migration — add `sprints` table, add `sprint_id` column to `sprint_tasks`)
- Create: `src/main/data/sprint-planning-queries.ts`
- Create: `src/main/data/__tests__/sprint-planning-queries.test.ts`
- Modify: `src/shared/types.ts` (add `Sprint` type, add `sprint_id` to `SprintTask`)

**Important:** Check the current last migration version number in `db.ts` before adding. Never modify existing migrations.

- [ ] **Step 1: Add migration**

In `src/main/db.ts`, add a new migration entry at the end of the `migrations` array:

```typescript
{
  version: N, // next version number after current last
  description:
    'Add sprints table and sprint_id to sprint_tasks',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sprints (
        id         TEXT PRIMARY KEY
                     DEFAULT (lower(hex(randomblob(16)))),
        name       TEXT NOT NULL,
        goal       TEXT,
        start_date TEXT NOT NULL,
        end_date   TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'planning'
                     CHECK(status IN (
                       'planning','active','completed','cancelled'
                     )),
        created_at TEXT NOT NULL
                     DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL
                     DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `)
    const cols = (
      db.pragma('table_info(sprint_tasks)') as {
        name: string
      }[]
    ).map((c) => c.name)
    if (!cols.includes('sprint_id')) {
      db.exec(
        `ALTER TABLE sprint_tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id)`
      )
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sprint_tasks_sprint ON sprint_tasks(sprint_id)`
      )
    }
  }
}
```

- [ ] **Step 2: Add `Sprint` type to `src/shared/types.ts`**

```typescript
export interface Sprint {
  id: string
  name: string
  goal: string | null
  start_date: string
  end_date: string
  status: 'planning' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}
```

Add `sprint_id?: string | null` to the `SprintTask` interface.

- [ ] **Step 3: Implement queries**

Create `src/main/data/sprint-planning-queries.ts`:

```typescript
import { getDb } from '../db'
import type { Sprint } from '../../shared/types'

export function createSprint(input: {
  name: string
  goal?: string
  start_date: string
  end_date: string
}): Sprint | null {
  const db = getDb()
  const row = db
    .prepare(
      `INSERT INTO sprints (name, goal, start_date, end_date)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(
      input.name,
      input.goal ?? null,
      input.start_date,
      input.end_date
    ) as Record<string, unknown> | undefined
  return (row as Sprint) ?? null
}

export function getSprint(id: string): Sprint | null {
  const row = getDb()
    .prepare('SELECT * FROM sprints WHERE id = ?')
    .get(id)
  return (row as Sprint) ?? null
}

export function listSprints(): Sprint[] {
  return getDb()
    .prepare('SELECT * FROM sprints ORDER BY start_date DESC')
    .all() as Sprint[]
}

export function assignTaskToSprint(
  taskId: string,
  sprintId: string
): boolean {
  const result = getDb()
    .prepare(
      'UPDATE sprint_tasks SET sprint_id = ? WHERE id = ?'
    )
    .run(sprintId, taskId)
  return result.changes > 0
}

export function getSprintBurndown(
  sprintId: string
): Array<{
  date: string
  remaining: number
  completed: number
}> {
  const db = getDb()
  // Get all tasks in this sprint
  const tasks = db
    .prepare(
      'SELECT status, completed_at FROM sprint_tasks WHERE sprint_id = ?'
    )
    .all(sprintId) as Array<{
    status: string
    completed_at: string | null
  }>

  const total = tasks.length
  const completedByDate = new Map<string, number>()

  for (const t of tasks) {
    if (
      t.completed_at &&
      (t.status === 'done' || t.status === 'cancelled')
    ) {
      const date = t.completed_at.slice(0, 10) // YYYY-MM-DD
      completedByDate.set(
        date,
        (completedByDate.get(date) ?? 0) + 1
      )
    }
  }

  // Build cumulative burndown
  const dates = [...completedByDate.keys()].sort()
  let cumCompleted = 0
  return dates.map((date) => {
    cumCompleted += completedByDate.get(date) ?? 0
    return {
      date,
      remaining: total - cumCompleted,
      completed: cumCompleted
    }
  })
}
```

- [ ] **Step 4: Write tests**

Create `src/main/data/__tests__/sprint-planning-queries.test.ts` using in-memory SQLite (same pattern as other data tests).

- [ ] **Step 5: Update `sprint_tasks` full column list in CLAUDE.md**

Add `sprint_id` to the column list in the gotchas section.

- [ ] **Step 6: Run tests + typecheck**

```bash
npm run test:main
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: sprint planning module — sprints table, sprint_id on tasks, burn-down queries"
```

---

### Task 9: Plugin system foundation — lifecycle hooks from ~/.bde/plugins/

Minimal plugin loader that discovers JS files in `~/.bde/plugins/`, loads them, and calls lifecycle hooks (onTaskCreated, onTaskCompleted, onAgentSpawned).

**Depends on:** None

**Files:**

- Create: `src/shared/plugin-types.ts`
- Create: `src/main/services/plugin-loader.ts`
- Create: `src/main/services/__tests__/plugin-loader.test.ts`
- Modify: `src/main/index.ts` (load plugins at startup)

- [ ] **Step 1: Define plugin interface**

Create `src/shared/plugin-types.ts`:

```typescript
export interface BdePlugin {
  name: string
  version?: string
  onTaskCreated?: (task: {
    id: string
    title: string
    repo: string
  }) => void | Promise<void>
  onTaskCompleted?: (task: {
    id: string
    title: string
    status: string
  }) => void | Promise<void>
  onAgentSpawned?: (info: {
    taskId: string
    branch: string
  }) => void | Promise<void>
}
```

- [ ] **Step 2: Implement plugin loader**

Create `src/main/services/plugin-loader.ts`:

```typescript
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../logger'
import type { BdePlugin } from '../../shared/plugin-types'

const logger = createLogger('plugin-loader')
const PLUGINS_DIR = join(homedir(), '.bde', 'plugins')

let loadedPlugins: BdePlugin[] = []

export function loadPlugins(): BdePlugin[] {
  if (!existsSync(PLUGINS_DIR)) {
    logger.info(
      `[plugin-loader] No plugins directory at ${PLUGINS_DIR}`
    )
    return []
  }

  const files = readdirSync(PLUGINS_DIR).filter(
    (f) => f.endsWith('.js') || f.endsWith('.cjs')
  )
  loadedPlugins = []

  for (const file of files) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(PLUGINS_DIR, file))
      const plugin: BdePlugin = mod.default ?? mod
      if (!plugin.name) {
        logger.warn(
          `[plugin-loader] Skipping ${file} — missing 'name' export`
        )
        continue
      }
      loadedPlugins.push(plugin)
      logger.info(
        `[plugin-loader] Loaded plugin: ${plugin.name}`
      )
    } catch (err) {
      logger.error(
        `[plugin-loader] Failed to load ${file}: ${err}`
      )
    }
  }

  return loadedPlugins
}

export function getPlugins(): BdePlugin[] {
  return loadedPlugins
}

export async function emitPluginEvent<
  K extends keyof BdePlugin
>(
  event: K,
  data: BdePlugin[K] extends (arg: infer A) => unknown
    ? A
    : never
): Promise<void> {
  for (const plugin of loadedPlugins) {
    const handler = plugin[event]
    if (typeof handler === 'function') {
      try {
        await (handler as (arg: unknown) => unknown)(data)
      } catch (err) {
        logger.error(
          `[plugin-loader] Plugin ${plugin.name}.${String(event)} error: ${err}`
        )
      }
    }
  }
}
```

- [ ] **Step 3: Write tests**

Create `src/main/services/__tests__/plugin-loader.test.ts` — mock filesystem, verify load/emit patterns.

- [ ] **Step 4: Wire into `src/main/index.ts` at startup**

```typescript
import { loadPlugins } from './services/plugin-loader'

// After app.whenReady():
loadPlugins()
```

- [ ] **Step 5: Run tests + typecheck**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: plugin system foundation — lifecycle hooks loaded from ~/.bde/plugins/"
```

---

## Phase 3 — Quality & Polish

### Task 10: Onboarding wizard — first-launch guided tour

A 5-step modal wizard shown on first launch: Welcome, Claude Auth, Git Check, Repo Config, Done. Gated by an `onboarding.completed` setting.

**Depends on:** None

**Files:**

- Create: `src/renderer/src/components/onboarding/OnboardingWizard.tsx`
- Create: `src/renderer/src/components/onboarding/steps/` (WelcomeStep, AuthStep, GitStep, RepoStep, DoneStep)
- Create: `src/renderer/src/assets/onboarding-neon.css`
- Modify: `src/renderer/src/App.tsx` (gate wizard display)

- [ ] **Step 1: Write tests for the wizard component**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingWizard } from '../OnboardingWizard'

describe('OnboardingWizard', () => {
  it('renders Welcome step initially', () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)
    expect(
      screen.getByText(/welcome to bde/i)
    ).toBeInTheDocument()
  })

  it('navigates through steps with Next button', async () => {
    const user = userEvent.setup()
    render(<OnboardingWizard onComplete={vi.fn()} />)
    await user.click(
      screen.getByRole('button', { name: /next/i })
    )
    expect(
      screen.getByText(/claude authentication/i)
    ).toBeInTheDocument()
  })

  it('calls onComplete on final step', async () => {
    const onComplete = vi.fn()
    render(<OnboardingWizard onComplete={onComplete} />)
    // Click through all 5 steps to completion
    for (let i = 0; i < 4; i++) {
      await userEvent
        .setup()
        .click(
          screen.getByRole('button', { name: /next/i })
        )
    }
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: /get started/i })
      )
    expect(onComplete).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement wizard component** with step state machine (useState for step index)

- [ ] **Step 3: Create `onboarding-neon.css`** following BEM `.onboarding-*` convention, using `var(--neon-*)` tokens

- [ ] **Step 4: Gate in `App.tsx`**

```typescript
// In App.tsx, check setting on mount:
const [showOnboarding, setShowOnboarding] = useState(false)
useEffect(() => {
  window.api.getSetting('onboarding.completed').then((val) => {
    if (!val) setShowOnboarding(true)
  })
}, [])

// Render wizard overlay when showOnboarding is true
{showOnboarding && (
  <OnboardingWizard
    onComplete={() => {
      window.api.setSetting('onboarding.completed', 'true')
      setShowOnboarding(false)
    }}
  />
)}
```

- [ ] **Step 5: Run tests + typecheck**

```bash
npx vitest run -- OnboardingWizard --reporter=verbose
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: onboarding wizard — 5-step first-launch guided tour"
```

---

### Task 11: React.memo on pipeline components

Memoize `TaskPill`, `PipelineStage`, and `PipelineBacklog` to prevent unnecessary re-renders when the pipeline polls.

**Depends on:** None

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskPill.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineStage.tsx`
- Modify: `src/renderer/src/components/sprint/PipelineBacklog.tsx`

- [ ] **Step 1: Wrap `TaskPill` export in `React.memo`**

In `TaskPill.tsx`, change the export pattern:
```typescript
// Before:
export function TaskPill(props: TaskPillProps) { ... }

// After:
import React from 'react'

function TaskPillInner(props: TaskPillProps) { ... }
export const TaskPill = React.memo(TaskPillInner)
TaskPill.displayName = 'TaskPill'
```

- [ ] **Step 2: Same for `PipelineStage`**

```typescript
function PipelineStageInner(props: PipelineStageProps) { ... }
export const PipelineStage = React.memo(PipelineStageInner)
PipelineStage.displayName = 'PipelineStage'
```

- [ ] **Step 3: Same for `PipelineBacklog`**

- [ ] **Step 4: Run existing pipeline tests to verify no regressions**

```bash
npx vitest run --reporter=verbose -- SprintPipeline TaskPill PipelineStage PipelineBacklog
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/sprint/TaskPill.tsx \
  src/renderer/src/components/sprint/PipelineStage.tsx \
  src/renderer/src/components/sprint/PipelineBacklog.tsx
git commit -m "perf: React.memo on TaskPill, PipelineStage, PipelineBacklog to reduce re-renders"
```

---

### Task 12: SQLite resilience — retry wrapper for SQLITE_BUSY

Wrap SQLite operations with automatic retry + exponential backoff when `SQLITE_BUSY` is encountered (common with WAL mode under concurrent access from multiple processes).

**Depends on:** None

**Files:**

- Create: `src/main/data/sqlite-retry.ts`
- Create: `src/main/data/__tests__/sqlite-retry.test.ts`
- Modify: `src/main/data/sprint-queries.ts` (wrap critical operations)

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../sqlite-retry'

describe('withRetry', () => {
  it('returns result on first success', () => {
    const fn = vi.fn().mockReturnValue(42)
    expect(withRetry(fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on SQLITE_BUSY and succeeds', () => {
    const busyError = Object.assign(
      new Error('database is locked'),
      { code: 'SQLITE_BUSY' }
    )
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw busyError
      })
      .mockReturnValue(42)
    expect(withRetry(fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', () => {
    const busyError = Object.assign(
      new Error('database is locked'),
      { code: 'SQLITE_BUSY' }
    )
    const fn = vi.fn().mockImplementation(() => {
      throw busyError
    })
    expect(() => withRetry(fn, { maxRetries: 3 })).toThrow(
      'database is locked'
    )
    expect(fn).toHaveBeenCalledTimes(4) // initial + 3 retries
  })

  it('does not retry non-BUSY errors', () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new Error('syntax error')
    })
    expect(() => withRetry(fn)).toThrow('syntax error')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Implement**

Create `src/main/data/sqlite-retry.ts`:

```typescript
interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

function isBusyError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as any).code === 'SQLITE_BUSY' ||
      err.message.includes('database is locked'))
  )
}

function sleepSync(ms: number): void {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    ms
  )
}

export function withRetry<T>(
  fn: () => T,
  opts: RetryOptions = {}
): T {
  const {
    maxRetries = 5,
    baseDelayMs = 10,
    maxDelayMs = 1000
  } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn()
    } catch (err) {
      lastError = err
      if (!isBusyError(err) || attempt === maxRetries)
        throw err
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),
        maxDelayMs
      )
      sleepSync(delay)
    }
  }

  throw lastError
}
```

- [ ] **Step 3: Wrap critical sprint-queries operations**

In `src/main/data/sprint-queries.ts`, wrap `updateTask` and `claimTask` transaction blocks:

```typescript
import { withRetry } from './sqlite-retry'

// In updateTask, wrap the transaction call:
return withRetry(() =>
  db.transaction(() => {
    /* existing transaction body */
  })()
)

// In claimTask, wrap the transaction call:
return withRetry(() =>
  db.transaction(() => {
    /* existing transaction body */
  })()
)
```

Note: `better-sqlite3` already has a `busy_timeout` pragma (set to 5000ms in `db.ts`), but `withRetry` adds application-level resilience for cases where the pragma timeout isn't sufficient (e.g., long-running VACUUM operations).

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/main/data/__tests__/sqlite-retry.test.ts --reporter=verbose
npm run test:main
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: SQLite BUSY retry wrapper with exponential backoff for concurrent access"
```

---

### Task 13: Post-merge stabilization check

After merging multiple agent PRs touching the same files, run automated checks for common merge artifacts. This is a one-time audit task, not permanent infrastructure.

**Depends on:** None

**Files to check (conflict-prone from CLAUDE.md):**

- `src/renderer/src/App.tsx` — duplicate imports, duplicate switch cases
- `src/main/index.ts` — duplicate handler registrations, duplicate imports
- `src/preload/index.ts` — duplicate channel exposures

**Procedure:**

- [ ] **Step 1: Run full CI locally**

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

- [ ] **Step 2: Check for duplicate imports in conflict-prone files**

Manually scan `App.tsx`, `index.ts`, and `preload/index.ts` for:
- Duplicate `import` lines
- Duplicate handler registrations
- Duplicate property definitions in objects

- [ ] **Step 3: Check handler count test assertions**

Verify handler count tests match the actual number of `safeHandle()` calls in each module. If counts are off, a merge introduced or removed a handler without updating the test.

- [ ] **Step 4: Fix any issues found, run CI again**

- [ ] **Step 5: Commit (if fixes needed)**

```bash
git commit -m "chore: post-merge stabilization — fix duplicate imports/handlers from batch merges"
```

---

## Phase 4 — Research

### Task 14: Competitive teardown — feature comparison vs Cursor/Windsurf/Devin/Copilot Workspace

Document-only task. No code changes. Produce a structured comparison matrix.

**Depends on:** None

**Files:**

- Create: `docs/research/2026-04-competitive-teardown.md`

- [ ] **Step 1: Research each tool's capabilities**

Cover these dimensions for each competitor:
- Agent autonomy level (fully autonomous vs copilot)
- Task management (queue, deps, retry)
- Code review workflow
- IDE integration (editor, terminal, git)
- Multi-repo support
- Plugin/extension system
- Pricing model
- Unique differentiators

Tools to compare:
- **Cursor** — AI-first code editor (fork of VS Code)
- **Windsurf** — Codeium's AI IDE
- **Devin** — Cognition's fully autonomous agent
- **GitHub Copilot Workspace** — GitHub's spec-to-PR agent
- **BDE** — this project

- [ ] **Step 2: Write comparison matrix**

Format as markdown table + detailed per-tool sections.

- [ ] **Step 3: Identify BDE's unique advantages and gaps**

Focus on:
- BDE's unique task pipeline (queue, deps, auto-retry, review) — no competitor has this
- BDE's local-first SQLite architecture vs cloud-dependent competitors
- BDE's plugin/workflow extensibility (after Tasks 5, 9)

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-04-competitive-teardown.md
git commit -m "chore: competitive teardown — BDE vs Cursor/Windsurf/Devin/Copilot Workspace"
```

---

## Cross-Task Notes

### Shared file modifications

These files are touched by multiple tasks — coordinate carefully:

| File | Tasks |
|------|-------|
| `src/main/handlers/sprint-local.ts` | 5, 6 |
| `src/preload/index.ts` + `index.d.ts` | 3, 5, 6, 7 |
| `src/main/index.ts` | 4, 9 |
| `src/main/data/sprint-queries.ts` | 12 |
| `src/shared/types.ts` | 8 |
| `src/main/db.ts` | 8 |

### Parallelization guide

- **Phase 0**: Task 1 must complete first — all Phase 1+ depends on pipeline correctness
- **Phase 1**: Tasks 2, 3, 4 can run in parallel (different files, no shared state)
- **Phase 2**: Tasks 5 then 6 are sequential (shared IPC handler file). Tasks 7, 8, 9 can parallel with each other and with 5/6
- **Phase 3**: Tasks 10, 11, 12, 13 can all run in parallel (no shared files)
- **Phase 4**: Task 14 is fully independent (docs only)

### Test commands summary

```bash
npm run typecheck          # Must pass before any commit
npm test                   # Renderer unit tests
npm run test:main          # Main process integration tests
npm run lint               # ESLint
npx vitest run <file>      # Single test file
```
