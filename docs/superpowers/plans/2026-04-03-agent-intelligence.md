# Agent Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BDE agents smarter by giving them per-task model selection, upstream context propagation, retry learning, structured failure diagnostics, cost budgets, and worktree checkpoint preservation for failed tasks.

**Spec:** `docs/superpowers/specs/2026-04-03-developer-persona-audit.md` (items #5, #9, #10, #14, #26, #33)

**Architecture:** Six features that span the full stack — SQLite schema (3 new columns), agent-manager runtime (watchdog, prompt composition, failure capture), and renderer UI (WorkbenchForm dropdown, TaskDetailDrawer diagnostic panel). All changes are additive; no breaking schema changes.

**Tech Stack:** Electron, TypeScript, SQLite (better-sqlite3), Zustand, React, vitest

---

## File Map

### Modified Files

| File | Change |
| --- | --- |
| `src/main/db.ts` | Migration v24: add `model`, `retry_context`, `failure_reason`, `max_cost_usd`, `partial_diff` columns |
| `src/shared/types.ts` | Add new fields to `SprintTask`, add `FailureReason` type, add `model` to `GENERAL_PATCH_FIELDS` |
| `src/main/data/sprint-queries.ts` | Add new fields to `UPDATE_ALLOWLIST`, `CreateTaskInput`, `createTask()` INSERT |
| `src/main/agent-manager/prompt-composer.ts` | Add `upstreamContext` and `retryContext` to `BuildPromptInput`, inject into prompt |
| `src/main/agent-manager/run-agent.ts` | Pass `task.model` to `spawnAgent()`, capture retry context on failure, capture partial diff |
| `src/main/agent-manager/types.ts` | Add `model` to `RunAgentTask` interface |
| `src/main/agent-manager/index.ts` | Pass `model` through `_mapQueuedTask()`, propagate upstream context |
| `src/main/agent-manager/watchdog.ts` | Add `cost-budget-exceeded` verdict |
| `src/main/agent-manager/completion.ts` | Capture `partial_diff` before worktree cleanup on failure, classify `failure_reason` |
| `src/main/handlers/sprint-local.ts` | Pass new fields through in `sprint:create` and `sprint:retry` |
| `src/renderer/src/stores/taskWorkbench.ts` | Add `model` field to state |
| `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` | Add model dropdown in advanced section |
| `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` | Add failure diagnostic panel for failed/error tasks |

---

## Task 1: Per-Task Model Selection

**What:** Add a `model` field to SprintTask so users can choose sonnet/opus/haiku per task. The agent manager uses this instead of `defaultModel` when spawning.

### Step 1.1 — Schema + Types

- [ ] **Test first** — `src/main/__tests__/integration/sprint-crud.test.ts`:
  ```bash
  npm run test:main -- --grep "model"
  ```
  Add test: create a task with `model: 'claude-haiku-3-5'`, retrieve it, assert the field persists.

- [ ] **Migration v24** in `src/main/db.ts` — add after migration v23:
  ```ts
  {
    version: 24,
    description: 'Add model, retry_context, failure_reason, max_cost_usd, partial_diff columns',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('model')) {
        db.exec("ALTER TABLE sprint_tasks ADD COLUMN model TEXT DEFAULT NULL")
      }
      if (!cols.includes('retry_context')) {
        db.exec("ALTER TABLE sprint_tasks ADD COLUMN retry_context TEXT DEFAULT NULL")
      }
      if (!cols.includes('failure_reason')) {
        db.exec("ALTER TABLE sprint_tasks ADD COLUMN failure_reason TEXT DEFAULT NULL")
      }
      if (!cols.includes('max_cost_usd')) {
        db.exec("ALTER TABLE sprint_tasks ADD COLUMN max_cost_usd REAL DEFAULT NULL")
      }
      if (!cols.includes('partial_diff')) {
        db.exec("ALTER TABLE sprint_tasks ADD COLUMN partial_diff TEXT DEFAULT NULL")
      }
    }
  }
  ```

- [ ] **SprintTask type** in `src/shared/types.ts` — add fields:
  ```ts
  model?: string | null
  retry_context?: string | null
  failure_reason?: 'auth' | 'timeout' | 'test_failure' | 'compilation' | 'spawn' | 'unknown' | null
  max_cost_usd?: number | null
  partial_diff?: string | null
  ```

- [ ] **FailureReason type** in `src/shared/types.ts` — add standalone type:
  ```ts
  export type FailureReason = 'auth' | 'timeout' | 'test_failure' | 'compilation' | 'spawn' | 'unknown'
  ```

- [ ] **GENERAL_PATCH_FIELDS** in `src/shared/types.ts` — add `'model'` and `'maxCostUsd'`.

- [ ] **UPDATE_ALLOWLIST** in `src/main/data/sprint-queries.ts` — add `'model'`, `'retry_context'`, `'failure_reason'`, `'max_cost_usd'`, `'partial_diff'`.

- [ ] **CreateTaskInput** in `src/main/data/sprint-queries.ts` — add `model?: string` field. Update `createTask()` INSERT to include `model`:
  ```ts
  // In the INSERT statement, add model column + value
  `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name, depends_on, playground_enabled, model)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING *`
  // Add input.model ?? null as the 11th parameter
  ```

- [ ] **Verify:** `npm run typecheck && npm run test:main`

### Step 1.2 — Agent Manager Passthrough

- [ ] **Test first** — `src/main/agent-manager/__tests__/run-agent.test.ts`:
  Add test: when `task.model` is `'claude-haiku-3-5'`, assert `spawnAgent()` receives `model: 'claude-haiku-3-5'` instead of `defaultModel`.

- [ ] **RunAgentTask** in `src/main/agent-manager/run-agent.ts` — add `model?: string | null` to the interface:
  ```ts
  export interface RunAgentTask {
    id: string
    title: string
    prompt: string | null
    spec: string | null
    repo: string
    retry_count: number
    fast_fail_count: number
    playground_enabled?: boolean
    max_runtime_ms?: number | null
    model?: string | null
  }
  ```

- [ ] **run-agent.ts** — in `runAgent()`, compute effective model and use it everywhere:
  ```ts
  // Line ~153: after destructuring deps
  const effectiveModel = task.model || defaultModel
  ```
  Replace ALL occurrences of `defaultModel` in the function body with `effectiveModel`. There are ~6 references:
  - `spawnAgent({ ..., model: effectiveModel, ... })` (line ~199)
  - `agent.model = effectiveModel` (line ~255)
  - `createAgentRecord({ ..., model: effectiveModel, ... })` (line ~273)
  - `emitAgentEvent(agentRunId, { type: 'agent:started', model: effectiveModel, ... })` (line ~295)
  - `updateAgentMeta` uses `agent.model` which is already set correctly

- [ ] **_mapQueuedTask** in `src/main/agent-manager/index.ts` — add `model` to the returned object:
  ```ts
  return {
    // ... existing fields ...
    model: (raw.model as string) ?? null
  }
  ```
  Also update the return type annotation to include `model: string | null`.

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 1.3 — WorkbenchForm UI

- [ ] **Test first** — `src/renderer/src/components/task-workbench/__tests__/WorkbenchForm.test.tsx`:
  Add test: render WorkbenchForm, open advanced section, assert model dropdown exists with 4 options (Default, Opus, Sonnet, Haiku). Select Opus, assert store state updates to `'claude-opus-4'`.

- [ ] **taskWorkbench store** — add `model: string` to state in `src/renderer/src/stores/taskWorkbench.ts`:
  - In `TaskWorkbenchState` interface: `model: string`
  - In `defaults()`: `model: ''` (empty string = use agent manager default)
  - In `loadTask()`: `model: task.model ?? ''`
  - In `resetForm()` via `defaults()`: already reset

- [ ] **WorkbenchForm.tsx** — read `model` from store and add dropdown in the `advancedOpen` section. Add after the priority select field, inside the `wb-form__field--row` div:
  ```tsx
  const model = useTaskWorkbenchStore((s) => s.model)

  const MODEL_OPTIONS = [
    { label: 'Default (Sonnet)', value: '' },
    { label: 'Claude Opus 4', value: 'claude-opus-4' },
    { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
    { label: 'Claude Haiku 3.5', value: 'claude-haiku-3-5' }
  ] as const

  // Inside the advancedOpen block, after priority field:
  <div className="wb-form__field wb-form__field--flex">
    <label htmlFor="wb-form-model" className="wb-form__label">Model</label>
    <select
      id="wb-form-model"
      value={model}
      onChange={(e) => setField('model', e.target.value)}
      className="wb-form__select"
    >
      {MODEL_OPTIONS.map((m) => (
        <option key={m.value} value={m.value}>{m.label}</option>
      ))}
    </select>
  </div>
  ```

- [ ] **createOrUpdateTask** — pass `model` through to both create and edit paths:
  - Edit: add `model: model || undefined` to the `updateTask` call
  - Create: add `model: model || undefined` to the `CreateTicketInput` object

- [ ] **Verify:** `npm run typecheck && npm test`

---

## Task 2: Context Propagation Between Tasks

**What:** When a pipeline task has completed upstream hard dependencies, include their specs and `git diff --stat` in the agent prompt so the agent knows what upstream tasks did.

### Step 2.1 — Upstream Context Builder

- [ ] **Test first** — `src/main/agent-manager/__tests__/prompt-composer.test.ts`:
  Add test: call `buildAgentPrompt()` with `upstreamContext` containing 2 upstream tasks. Assert prompt includes `## Upstream Task Context` section with both task titles and specs. Assert total upstream section is capped at 4000 chars.

- [ ] **Types** in `src/main/agent-manager/prompt-composer.ts` — add:
  ```ts
  export interface UpstreamTaskContext {
    title: string
    spec: string | null
    diffStat: string | null
  }
  ```

- [ ] **BuildPromptInput** — add field:
  ```ts
  export interface BuildPromptInput {
    // ... existing fields ...
    upstreamContext?: UpstreamTaskContext[]
  }
  ```

- [ ] **buildAgentPrompt()** — after the task content section (just before the `return prompt` line), add upstream context injection:
  ```ts
  if (input.upstreamContext && input.upstreamContext.length > 0) {
    const MAX_UPSTREAM_CHARS = 4000
    let section = '\n\n## Upstream Task Context\n\n'
    section += 'These upstream tasks have already completed. Their changes are in the codebase:\n\n'
    let totalChars = 0
    for (const upstream of input.upstreamContext) {
      const entry = `### ${upstream.title}\n` +
        (upstream.spec ? `**Spec:** ${upstream.spec.slice(0, 1000)}\n` : '') +
        (upstream.diffStat ? `**Changes:**\n\`\`\`\n${upstream.diffStat}\n\`\`\`\n` : '') +
        '\n'
      if (totalChars + entry.length > MAX_UPSTREAM_CHARS) break
      section += entry
      totalChars += entry.length
    }
    prompt += section
  }
  ```

- [ ] **Verify:** `npm run typecheck && npm test`

### Step 2.2 — Gather Upstream Context at Spawn Time

- [ ] **Test first** — `src/main/agent-manager/__tests__/index.test.ts` (or a new focused test file):
  Mock `repo.getTask()` to return a completed task for a dependency ID. Assert that the spawned task receives `upstreamContext` with the upstream task's title and spec.

- [ ] **RunAgentTask** in `src/main/agent-manager/run-agent.ts` — add:
  ```ts
  import type { UpstreamTaskContext } from './prompt-composer'

  export interface RunAgentTask {
    // ... existing fields ...
    upstreamContext?: UpstreamTaskContext[]
  }
  ```

- [ ] **run-agent.ts** — pass upstream context to `buildAgentPrompt()`. Update the call at line ~181:
  ```ts
  const prompt = buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled,
    upstreamContext: task.upstreamContext
  })
  ```

- [ ] **index.ts** `_processQueuedTask` — gather upstream context between the claim and spawn steps. After the worktree setup succeeds, before `this._spawnAgent(task, wt, repoPath)`:
  ```ts
  // Gather upstream context from completed dependencies
  let upstreamContext: UpstreamTaskContext[] | undefined
  const depData = raw.dependsOn ?? raw.depends_on
  if (depData) {
    try {
      const deps = typeof depData === 'string' ? JSON.parse(depData) : depData
      if (Array.isArray(deps)) {
        upstreamContext = []
        for (const dep of deps) {
          if (dep.type !== 'hard') continue
          const upTask = this.repo.getTask(dep.id)
          if (!upTask || upTask.status !== 'done') continue
          upstreamContext.push({
            title: upTask.title,
            spec: upTask.spec,
            diffStat: null  // Diff stat retrieval is expensive; specs alone provide good context
          })
          if (upstreamContext.length >= 5) break
        }
      }
    } catch { /* deps already validated above */ }
  }

  this._spawnAgent({ ...task, upstreamContext }, wt, repoPath)
  ```
  **Important:** Import `UpstreamTaskContext` at the top of `index.ts`:
  ```ts
  import type { UpstreamTaskContext } from './prompt-composer'
  ```

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

---

## Task 3: Retry with Context

**What:** Before cleaning up a failed agent's worktree, capture `git diff` and last agent events. Store in `retry_context` field. On retry, `buildAgentPrompt()` includes this context.

### Step 3.1 — Capture Retry Context on Failure

- [ ] **Test first** — `src/main/agent-manager/__tests__/run-agent.test.ts`:
  Add test: mock an agent that exits with failure while `retry_count < MAX_RETRIES`. Assert `repo.updateTask` is called with `retry_context` containing a JSON string with `diff` and `lastOutput` fields.

- [ ] **New helper** in `src/main/agent-manager/run-agent.ts`:
  ```ts
  import { execFile as execFileCb } from 'node:child_process'
  import { promisify } from 'node:util'
  import { buildAgentEnv } from '../env-utils'

  const execFileAsync = promisify(execFileCb)

  async function captureRetryContext(
    worktreePath: string,
    lastOutput: string,
    logger: Logger
  ): Promise<string | null> {
    try {
      const { stdout: diff } = await execFileAsync(
        'git', ['diff', '--stat', 'HEAD'],
        { cwd: worktreePath, env: buildAgentEnv(), maxBuffer: 50 * 1024 }
      )
      const context = JSON.stringify({
        diff: diff.trim().slice(0, 2000),
        lastOutput: lastOutput.slice(0, 1000),
        capturedAt: new Date().toISOString()
      })
      return context.length > 5000 ? context.slice(0, 5000) : context
    } catch (err) {
      logger.warn(`[agent-manager] Failed to capture retry context: ${err}`)
      return null
    }
  }
  ```
  Note: `execFileAsync` and `buildAgentEnv` are already imported in `completion.ts` but not in `run-agent.ts`. Add the imports at the top of `run-agent.ts`. Since `run-agent.ts` already imports from `node:fs/promises`, adding `child_process` is consistent.

- [ ] **run-agent.ts** — in the `resolveFailure` catch block (after `resolveSuccess` fails, around line ~474), capture retry context before `resolveFailure`:
  ```ts
  } catch (err) {
    logger.warn(`[agent-manager] resolveSuccess failed for task ${task.id}: ${err}`)

    // Capture retry context before marking failure
    if ((task.retry_count ?? 0) < MAX_RETRIES) {
      const retryCtx = await captureRetryContext(worktree.worktreePath, lastAgentOutput, logger)
      if (retryCtx) {
        try { repo.updateTask(task.id, { retry_context: retryCtx }) } catch { /* best-effort */ }
      }
    }

    const isTerminal = resolveFailure(
      { taskId: task.id, retryCount: task.retry_count ?? 0, repo },
      logger
    )
    // ... rest unchanged
  }
  ```

- [ ] **Also capture in fast-fail-requeue path** (around line ~444): Before the requeue `updateTask`, capture retry context:
  ```ts
  } else if (ffResult === 'fast-fail-requeue') {
    const retryCtx = await captureRetryContext(worktree.worktreePath, lastAgentOutput, logger)
    try {
      repo.updateTask(task.id, {
        status: 'queued',
        fast_fail_count: (task.fast_fail_count ?? 0) + 1,
        claimed_by: null,
        ...(retryCtx ? { retry_context: retryCtx } : {})
      })
    } catch (err) {
      logger.error(`[agent-manager] Failed to requeue fast-fail task ${task.id}: ${err}`)
    }
  }
  ```

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 3.2 — Inject Retry Context into Prompt

- [ ] **Test first** — `src/main/agent-manager/__tests__/prompt-composer.test.ts`:
  Add test: call `buildAgentPrompt()` with `retryContext: '{"diff":"2 files changed","lastOutput":"Error: test failed"}'` and `retryCount: 1`. Assert prompt includes `## Previous Attempt` section with the parsed diff and last output.

- [ ] **BuildPromptInput** in `prompt-composer.ts` — add:
  ```ts
  retryContext?: string | null
  retryCount?: number
  ```

- [ ] **buildAgentPrompt()** — after upstream context injection (and before `return prompt`), add retry context:
  ```ts
  if (input.retryCount && input.retryCount > 0 && input.retryContext) {
    prompt += '\n\n## Previous Attempt\n\n'
    prompt += `This is retry #${input.retryCount}. The previous attempt failed.\n\n`
    try {
      const ctx = JSON.parse(input.retryContext)
      if (ctx.lastOutput) {
        prompt += `**Last output before failure:**\n${ctx.lastOutput}\n\n`
      }
      if (ctx.diff) {
        prompt += `**Changes made before failure:**\n\`\`\`\n${ctx.diff}\n\`\`\`\n\n`
      }
    } catch {
      prompt += input.retryContext + '\n'
    }
    prompt += 'Learn from this failure. Take a different approach or fix the issue that caused the failure.\n'
  }
  ```

- [ ] **run-agent.ts** — pass retry context to `buildAgentPrompt()`. Update the call at line ~181:
  ```ts
  // Fetch full task to get retry_context (RunAgentTask doesn't carry it)
  const fullTask = repo.getTask(task.id)

  const prompt = buildAgentPrompt({
    agentType: 'pipeline',
    taskContent,
    branch: worktree.branch,
    playgroundEnabled: task.playground_enabled,
    upstreamContext: task.upstreamContext,
    retryContext: fullTask?.retry_context ?? null,
    retryCount: task.retry_count
  })
  ```

- [ ] **sprint:retry handler** in `src/main/handlers/sprint-local.ts` — do NOT clear `retry_context` on retry. The current handler resets `notes`, `started_at`, `completed_at`, `fast_fail_count`, `agent_run_id` — but `retry_context` should be preserved so the new agent gets it. Verify this is the case (it will be, since the handler only resets explicitly listed fields).

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

---

## Task 4: Structured Failure Diagnostics

**What:** Add a `failure_reason` enum field classified automatically on failure. Show a diagnostic panel in TaskDetailDrawer with error details, suggested fixes, and action buttons.

### Step 4.1 — Classify Failure Reason

- [ ] **Test first** — `src/main/agent-manager/__tests__/completion.test.ts`:
  Add tests for `classifyFailureReason()`:
  - Notes containing "Invalid API key" returns `'auth'`
  - Notes containing "exceeded the maximum runtime" returns `'timeout'`
  - Notes containing "npm test" + "failed" returns `'test_failure'`
  - Notes containing "typecheck" returns `'compilation'`
  - Notes containing "Spawn failed" returns `'spawn'`
  - Notes containing random text returns `'unknown'`
  - Watchdog verdict `'max-runtime'` returns `'timeout'` regardless of notes

- [ ] **New exported function** in `src/main/agent-manager/completion.ts`:
  ```ts
  export type FailureReason = 'auth' | 'timeout' | 'test_failure' | 'compilation' | 'spawn' | 'unknown'

  export function classifyFailureReason(notes: string | null, watchdogVerdict?: string): FailureReason {
    if (watchdogVerdict === 'max-runtime' || watchdogVerdict === 'idle') return 'timeout'
    if (!notes) return 'unknown'
    const lower = notes.toLowerCase()
    if (lower.includes('spawn failed') || lower.includes('spawn timed out')) return 'spawn'
    if (lower.includes('invalid api key') || lower.includes('oauth') || lower.includes('authentication')) return 'auth'
    if (lower.includes('typecheck') || lower.includes('type error') || lower.includes('ts2')) return 'compilation'
    if (lower.includes('test') && (lower.includes('fail') || lower.includes('error'))) return 'test_failure'
    if (lower.includes('timeout') || lower.includes('exceeded the maximum runtime')) return 'timeout'
    return 'unknown'
  }
  ```

- [ ] **Integrate into failure paths** — in every location that sets `status: 'failed'` or `status: 'error'`, also set `failure_reason`. Key locations:

  **`run-agent.ts`:**
  - Spawn failure (~line 216): add `failure_reason: 'spawn'`
  - Fast-fail-exhausted (~line 430): add `failure_reason: classifyFailureReason(notes)`
  - No-content error (~line 158): add `failure_reason: 'spawn'`

  **`completion.ts`:**
  - `resolveFailure()` terminal path (~line 401): add `failure_reason: classifyFailureReason(notes)` to the `updateTask` call
  - Worktree eviction (~line 267): add `failure_reason: 'spawn'`
  - Branch detection failure (~line 293): add `failure_reason: 'spawn'`

  **`index.ts`:**
  - `handleWatchdogVerdict()` max-runtime path (~line 109): add `failure_reason: 'timeout'`
  - `handleWatchdogVerdict()` idle path (~line 125): add `failure_reason: 'timeout'`
  - Worktree setup failure (~line 451): add `failure_reason: 'spawn'`
  - Repo path missing (~line 413): add `failure_reason: 'spawn'`

  Import `classifyFailureReason` from `./completion` where needed.

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 4.2 — Diagnostic Panel in TaskDetailDrawer

- [ ] **Test first** — `src/renderer/src/components/sprint/__tests__/TaskDetailDrawer.test.tsx`:
  Add test: render drawer with a task `{ status: 'failed', failure_reason: 'timeout', notes: 'Agent exceeded...' }`. Assert:
  - Element with test ID `failure-diagnostics` is rendered
  - Text "Agent Timed Out" appears
  - Text about breaking into subtasks appears
  - Notes are shown in a details/summary block

- [ ] **FAILURE_DIAGNOSTICS constant** — add at the top of `TaskDetailDrawer.tsx`:
  ```ts
  const FAILURE_DIAGNOSTICS: Record<string, { heading: string; suggestion: string }> = {
    auth: {
      heading: 'Authentication Failed',
      suggestion: 'Run "claude login" in your terminal to refresh your OAuth token, then retry.'
    },
    timeout: {
      heading: 'Agent Timed Out',
      suggestion: 'The task may be too large for a single agent session. Consider breaking it into subtasks or increasing max_runtime_ms in the task settings.'
    },
    test_failure: {
      heading: 'Tests Failed',
      suggestion: 'The agent\'s changes broke existing tests. Review the partial diff below (if available) and retry with a more specific spec that addresses the failing tests.'
    },
    compilation: {
      heading: 'TypeScript Compilation Failed',
      suggestion: 'The agent introduced type errors. Check the partial diff for the problematic code and add type hints to the spec.'
    },
    spawn: {
      heading: 'Agent Failed to Start',
      suggestion: 'Check that Claude Code CLI is installed and authenticated. Run "claude login" and verify the repo path in Settings.'
    },
    unknown: {
      heading: 'Agent Failed',
      suggestion: 'Check the agent logs and notes below for details on what went wrong.'
    }
  }
  ```

- [ ] **Diagnostic panel JSX** — in the drawer body section, after the existing notes/prompt block and before the agent section, add:
  ```tsx
  {(task.status === 'failed' || task.status === 'error') && (
    <div className="task-drawer__diagnostics" data-testid="failure-diagnostics">
      {(() => {
        const reason = (task as SprintTask & { failure_reason?: string }).failure_reason ?? 'unknown'
        const diag = FAILURE_DIAGNOSTICS[reason] ?? FAILURE_DIAGNOSTICS.unknown
        return (
          <>
            <div className="task-drawer__diag-heading">{diag.heading}</div>
            <div className="task-drawer__diag-suggestion">{diag.suggestion}</div>
            {task.notes && (
              <details className="task-drawer__diag-details">
                <summary>Error details</summary>
                <pre className="task-drawer__diag-notes">{task.notes}</pre>
              </details>
            )}
            {(task as SprintTask & { partial_diff?: string }).partial_diff && (
              <details className="task-drawer__diag-details">
                <summary>Partial work (diff)</summary>
                <pre className="task-drawer__diag-notes">
                  {(task as SprintTask & { partial_diff?: string }).partial_diff}
                </pre>
              </details>
            )}
          </>
        )
      })()}
    </div>
  )}
  ```

- [ ] **CSS** — add diagnostic styles to `src/renderer/src/styles/sprint-pipeline-neon.css`:
  ```css
  .task-drawer__diagnostics {
    margin: 8px 0;
    padding: 10px;
    border: 1px solid var(--neon-border);
    border-radius: 6px;
    background: var(--bde-surface-elevated);
  }
  .task-drawer__diag-heading {
    font-weight: 600;
    color: var(--neon-error);
    margin-bottom: 4px;
  }
  .task-drawer__diag-suggestion {
    font-size: 0.85rem;
    color: var(--neon-text-muted);
    margin-bottom: 8px;
  }
  .task-drawer__diag-details {
    margin-top: 6px;
  }
  .task-drawer__diag-details summary {
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--neon-text-muted);
  }
  .task-drawer__diag-notes {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    padding: 6px;
    background: var(--bde-surface);
    border-radius: 4px;
    margin-top: 4px;
  }
  ```

- [ ] **Verify:** `npm run typecheck && npm test`

---

## Task 5: Cost Budgets per Task

**What:** Add `max_cost_usd` field to SprintTask. The watchdog checks `agent.costUsd` against the budget and kills the agent if exceeded.

### Step 5.1 — Watchdog Cost Check

- [ ] **Test first** — `src/main/agent-manager/__tests__/watchdog.test.ts`:
  Add tests for the new verdict:
  - Agent with `costUsd: 5.00`, `maxCostUsd: 3.00` => verdict `'cost-budget-exceeded'`
  - Agent with `costUsd: 1.00`, `maxCostUsd: 3.00` => verdict `'ok'`
  - Agent with `maxCostUsd: null` => cost check is skipped, verdict based on other checks
  - Agent with `maxCostUsd: 0` => immediately exceeded (edge case)

- [ ] **WatchdogVerdict type** in `src/main/agent-manager/watchdog.ts` — update:
  ```ts
  export type WatchdogVerdict = 'ok' | 'idle' | 'max-runtime' | 'rate-limit-loop' | 'cost-budget-exceeded'
  ```

- [ ] **checkAgent()** in `watchdog.ts` — add cost check before the return:
  ```ts
  export function checkAgent(
    agent: ActiveAgent,
    now: number,
    config: AgentManagerConfig
  ): WatchdogVerdict {
    const maxRuntime = agent.maxRuntimeMs ?? config.maxRuntimeMs
    if (now - agent.startedAt >= maxRuntime) return 'max-runtime'
    if (now - agent.lastOutputAt >= config.idleTimeoutMs) return 'idle'
    if (agent.rateLimitCount >= RATE_LIMIT_LOOP_THRESHOLD) return 'rate-limit-loop'
    if (agent.maxCostUsd != null && agent.costUsd >= agent.maxCostUsd) return 'cost-budget-exceeded'
    return 'ok'
  }
  ```

- [ ] **ActiveAgent** in `src/main/agent-manager/types.ts` — add:
  ```ts
  export interface ActiveAgent {
    // ... existing fields ...
    maxCostUsd: number | null
  }
  ```

- [ ] **RunAgentTask** in `run-agent.ts` — add `max_cost_usd?: number | null`.

- [ ] **run-agent.ts** — set `maxCostUsd` when creating the ActiveAgent record (~line 250):
  ```ts
  const agent: ActiveAgent = {
    // ... existing fields ...
    maxCostUsd: task.max_cost_usd ?? null
  }
  ```

- [ ] **_mapQueuedTask** in `index.ts` — add to the returned object:
  ```ts
  max_cost_usd: Number(raw.maxCostUsd) || null
  ```

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 5.2 — Handle Cost Budget Verdict

- [ ] **Test first** — `src/main/agent-manager/__tests__/index.test.ts`:
  Add test: call `handleWatchdogVerdict('cost-budget-exceeded', taskId, ...)`. Assert `updateTaskFn` is called with `status: 'error'` and notes mentioning cost budget.

- [ ] **WatchdogVerdict type** in `src/main/agent-manager/index.ts` — update to include `'cost-budget-exceeded'`:
  ```ts
  export type WatchdogVerdict = 'max-runtime' | 'idle' | 'rate-limit-loop' | 'cost-budget-exceeded'
  ```

- [ ] **handleWatchdogVerdict** in `index.ts` — add a new `else if` branch after `rate-limit-loop`:
  ```ts
  } else if (verdict === 'cost-budget-exceeded') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        claimed_by: null,
        failure_reason: 'timeout',
        notes: 'Agent exceeded the cost budget for this task. Consider increasing the budget or breaking the task into smaller subtasks.',
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(`[agent-manager] Failed onTerminal for task ${taskId} after cost kill: ${err}`)
      )
    } catch (err) {
      logger.warn(`[agent-manager] Failed to update task ${taskId} after cost kill: ${err}`)
    }
  }
  ```

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 5.3 — UI for Cost Budget

- [ ] **Test first** — `src/renderer/src/components/task-workbench/__tests__/WorkbenchForm.test.tsx`:
  Add test: render WorkbenchForm, open advanced section, assert cost budget input with placeholder "No limit" exists. Enter "5", assert store updates `maxCostUsd` to `5`.

- [ ] **taskWorkbench store** — add `maxCostUsd: number | null` to `TaskWorkbenchState`:
  - In interface: `maxCostUsd: number | null`
  - In `defaults()`: `maxCostUsd: null`
  - In `loadTask()`: `maxCostUsd: (task as any).max_cost_usd ?? null`
  - (resetForm via defaults already handles it)

- [ ] **WorkbenchForm.tsx** — read `maxCostUsd` from store and add input in advanced section, after the model dropdown:
  ```tsx
  const maxCostUsd = useTaskWorkbenchStore((s) => s.maxCostUsd)

  // In advanced section:
  <div className="wb-form__field wb-form__field--flex">
    <label htmlFor="wb-form-cost-budget" className="wb-form__label">
      Cost Budget ($)
    </label>
    <input
      id="wb-form-cost-budget"
      type="number"
      step="0.50"
      min="0"
      value={maxCostUsd ?? ''}
      onChange={(e) => setField('maxCostUsd', e.target.value ? Number(e.target.value) : null)}
      placeholder="No limit"
      className="wb-form__input wb-form__input--narrow"
    />
  </div>
  ```

- [ ] **createOrUpdateTask** — pass `max_cost_usd` through:
  - Edit: add `max_cost_usd: maxCostUsd ?? undefined` to `updateTask` call
  - Create: add `max_cost_usd: maxCostUsd ?? undefined` to `CreateTicketInput`

- [ ] **Verify:** `npm run typecheck && npm test`

---

## Task 6: Worktree Checkpoint (Partial Diff Preservation)

**What:** Before cleaning up a failed worktree, snapshot `git diff` into `partial_diff` field. Show partial work in the diagnostic panel for salvageability.

### Step 6.1 — Capture Partial Diff

- [ ] **Test first** — `src/main/agent-manager/__tests__/run-agent.test.ts`:
  Add test: mock an agent that exits with failure, with `existsSync` returning true for the worktree. Assert `capturePartialDiff` is called and `repo.updateTask` receives `partial_diff` with diff content.

- [ ] **New helper** in `src/main/agent-manager/run-agent.ts`:
  ```ts
  const MAX_PARTIAL_DIFF_SIZE = 50_000 // 50KB cap

  async function capturePartialDiff(
    worktreePath: string,
    logger: Logger
  ): Promise<string | null> {
    try {
      const { stdout: diff } = await execFileAsync(
        'git', ['diff', 'HEAD'],
        { cwd: worktreePath, env: buildAgentEnv(), maxBuffer: 200 * 1024 }
      )
      if (!diff.trim()) {
        // Also check for staged but uncommitted changes
        const { stdout: stagedDiff } = await execFileAsync(
          'git', ['diff', '--cached'],
          { cwd: worktreePath, env: buildAgentEnv(), maxBuffer: 200 * 1024 }
        )
        if (!stagedDiff.trim()) return null
        return stagedDiff.length > MAX_PARTIAL_DIFF_SIZE
          ? stagedDiff.slice(0, MAX_PARTIAL_DIFF_SIZE) + '\n... (truncated)'
          : stagedDiff
      }
      return diff.length > MAX_PARTIAL_DIFF_SIZE
        ? diff.slice(0, MAX_PARTIAL_DIFF_SIZE) + '\n... (truncated)'
        : diff
    } catch (err) {
      logger.warn(`[agent-manager] Failed to capture partial diff: ${err}`)
      return null
    }
  }
  ```

  Note: `execFileAsync` and `buildAgentEnv` need to be imported at the top of `run-agent.ts` if not already available. The file already imports `readFile` and `stat` from `node:fs/promises`, so add:
  ```ts
  import { execFile as execFileCb } from 'node:child_process'
  import { promisify } from 'node:util'
  import { buildAgentEnv } from '../env-utils'
  const execFileAsync = promisify(execFileCb)
  ```

- [ ] **Integrate** — before every `cleanupWorktree()` call in failure paths, capture the diff. The key locations in `run-agent.ts`:

  1. **After fast-fail-exhausted** (~line 430-442): Before the worktree cleanup at the bottom of `runAgent`:
     ```ts
     // Before cleanupWorktree for non-review tasks
     if (currentTask?.status !== 'review') {
       // Capture partial diff for failed tasks
       if (currentTask?.status === 'failed' || currentTask?.status === 'error') {
         const partialDiff = await capturePartialDiff(worktree.worktreePath, logger)
         if (partialDiff) {
           try { repo.updateTask(task.id, { partial_diff: partialDiff }) } catch { /* best-effort */ }
         }
       }
       cleanupWorktree({ ... })
     }
     ```

  2. **After resolveFailure** in the catch block (~line 474): Capture diff before the cleanup at the end of the function:
     Same pattern as above — the cleanup happens at the end of `runAgent`, so the single capture point before cleanup covers all failure paths.

  The cleanest approach: move the partial diff capture to the single `cleanupWorktree` block at the end of `runAgent()`, right before the `cleanupWorktree` call for non-review tasks:
  ```ts
  if (currentTask?.status !== 'review') {
    // Capture partial diff for failed/error tasks before cleanup
    if (currentTask?.status === 'failed' || currentTask?.status === 'error') {
      const partialDiff = await capturePartialDiff(worktree.worktreePath, logger)
      if (partialDiff) {
        try { repo.updateTask(task.id, { partial_diff: partialDiff }) } catch { /* best-effort */ }
      }
    }
    cleanupWorktree({
      repoPath,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch
    }).catch(...)
  }
  ```

- [ ] **Verify:** `npm run typecheck && npm test && npm run test:main`

### Step 6.2 — Display in UI

- [ ] Already covered by the diagnostic panel in Task 4 (the `partial_diff` details block).

- [ ] **Future enhancement (not in this plan):** Add failed tasks with `partial_diff` to the Code Review queue so users can cherry-pick useful changes.

- [ ] **Verify:** `npm run typecheck && npm test`

---

## Pre-Commit Verification

After implementing all tasks, run the full verification suite:

```bash
npm run typecheck   # Zero errors
npm test            # All renderer tests pass
npm run test:main   # All main process tests pass
npm run lint        # Zero errors (warnings OK)
```

---

## Dependency Graph

```
Task 1 (Schema + Model Selection)  ← MUST be first (creates migration v24 with all columns)
  ├─► Task 2 (Context Propagation) — uses RunAgentTask + prompt-composer changes
  ├─► Task 3 (Retry with Context) — uses retry_context column
  ├─► Task 4 (Failure Diagnostics) — uses failure_reason column
  ├─► Task 5 (Cost Budgets) — uses max_cost_usd column + ActiveAgent.maxCostUsd
  └─► Task 6 (Worktree Checkpoint) — uses partial_diff column
```

Task 1 must be implemented first (it creates the migration with all new columns). Tasks 2-6 can be parallelized after Task 1.

---

## sprint_tasks Full Column List After v24

id, title, prompt, repo, status, priority, depends_on, spec, notes, pr_url, pr_number, pr_status, pr_mergeable_state, agent_run_id, retry_count, fast_fail_count, started_at, completed_at, claimed_by, template_name, playground_enabled, needs_review, max_runtime_ms, spec_type, worktree_path, session_id, next_eligible_at, **model**, **retry_context**, **failure_reason**, **max_cost_usd**, **partial_diff**, created_at, updated_at.

---

## Key Decisions

1. **Single migration (v24)** for all 5 new columns — avoids migration ordering issues when tasks are parallelized as independent agents.
2. **`model` empty string = use default** — empty string in the store maps to `undefined` in the API, which falls through to `defaultModel` in the agent manager.
3. **Upstream context capped at 4000 chars / 5 tasks** — prevents prompt bloat. Specs are truncated to 1000 chars each.
4. **Retry context is JSON** — structured capture of diff stat + last output, parseable by the prompt composer. Capped at 5KB.
5. **Partial diff capped at 50KB** — enough to show meaningful work, not enough to bloat SQLite.
6. **Cost budget check in watchdog** — runs every 10s via existing `WATCHDOG_INTERVAL_MS`. Agent could overshoot by at most 10s of cost accrual, which is acceptable.
7. **Failure classification is best-effort string matching** — good enough for UX guidance and suggested fixes. Not a reliable classifier, but strictly better than raw error text.
8. **No diff stat in upstream context (MVP)** — retrieving `git diff --stat` for upstream tasks requires knowing which branch they worked on, which is cleaned up after merge. Specs alone provide sufficient context for the agent.
