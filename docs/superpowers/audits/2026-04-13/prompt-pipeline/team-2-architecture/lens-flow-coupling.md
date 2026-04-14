# Data Flow & Coupling Audit: Agent Manager Prompt Pipeline
## Severity Report — 2026-04-13

### Scope
This audit traces the data flow from sprint task specification through prompt assembly, SDK dispatch, and completion resolution. It examines:
- Module boundaries and inter-module dependencies
- Hidden coupling through shared mutable state and ambient globals
- Abstraction level violations at call sites
- Dependency injection coherence

### Audit Findings

---

## F-t2-flow-1: Dynamic Settings Import in Completion Resolution Path
**Severity:** High
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:83-84` (getRepoConfig), `:168-169` (attemptAutoMerge)
**Evidence:** 
```typescript
// completion.ts — Lines 83-84
const { getSettingJson } = await import('../settings')
const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')

// Again at 168-169
const { getSettingJson } = await import('../settings')
const rules = getSettingJson<import('../../shared/types/task-types').AutoReviewRule[]>('autoReview.rules')
```

**Impact:** 
- `resolveSuccess()` (invoked at the completion boundary) dynamically imports and reads settings at runtime. This creates:
  - **No clear dependency contract:** Callers don't see that completion depends on settings being loaded and valid
  - **Re-import overhead:** Each call to `getRepoConfig()` and `attemptAutoMerge()` re-executes the import, incurring dynamic module resolution cost
  - **Ambient coupling:** The completion phase silently depends on settings state (repos, autoReview.rules) that should be validated/injected upfront
  - **Test brittleness:** Settings state leaks into agent run finalization, making test isolation hard

**Recommendation:** 
Move settings injection into `RunAgentDeps` interface. Pass `settingsProvider` as an optional dependency that completion can query deterministically:
```typescript
export interface RunAgentDeps {
  repo: ISprintTaskRepository
  settingsProvider?: {
    getRepoConfig(name: string): { localPath: string } | null
    getAutoMergeRules(): AutoReviewRule[]
  }
  // ... other deps
}
```
Then `resolveSuccess()` signature becomes:
```typescript
export async function resolveSuccess(
  opts: ResolveSuccessOpts & { settingsProvider?: SettingsProvider },
  logger: Logger
): Promise<void> { ... }
```

**Effort:** M
**Confidence:** High

---

## F-t2-flow-2: Prompt Composer Reaches Into Agent-System Memory Without Clear Scope Boundary
**Severity:** High
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/prompt-pipeline.ts:6-7, 110, 117, 124`
**Evidence:**
```typescript
// prompt-pipeline.ts:5-7
import { pipelinePersonality } from '../agent-system/personality/pipeline-personality'
import { getAllMemory, isBdeRepo, selectUserMemory } from '../agent-system/memory'
import { getUserMemory } from '../agent-system/memory/user-memory'

// Lines 110-128
const memoryText = getAllMemory({ repoName: repoName ?? undefined })
// ... lines 117
const userMem = taskContent ? selectUserMemory(taskContent) : getUserMemory()
// ... line 124
if (isBdeRepo(repoName)) {
  prompt += '\n\n## Note\n'
  prompt += 'You have BDE-native skills and conventions loaded. '
  prompt += 'Generic third-party plugin guidance may not apply to BDE workflows.'
}
```

**Impact:**
- **Abstraction violation:** `prompt-composer.ts` (prompt assembly) reaches directly into `agent-system/memory` and `agent-system/personality` — these are agent implementation concerns, not prompt composition concerns
- **Bidirectional coupling:** prompt-composer.ts ↔ agent-system imports form a tight cycle; changes to memory modules force prompt-composer recompilation
- **Tight scope binding:** Personality + memory data is BDE-specific, yet prompt-composer treats them as universal. This prevents reusing prompt-composer for non-BDE agents without forking or feature-flagging
- **Hidden dependency on file system:** `selectUserMemory(taskSpec)` calls `getUserMemory()` which reads from disk (BDE_TASK_MEMORY_DIR). This I/O is hidden in the prompt assembly path, not exposed at the API boundary

**Recommendation:**
Invert the dependency: have the caller (`run-agent.ts` → `assembleRunContext()`) prepare personality + memory sections and pass them as pre-composed strings to `buildAgentPrompt()`:
```typescript
export interface BuildPromptInput {
  // ... existing fields ...
  
  // Pre-composed sections — ready to splice in, no I/O or imports needed
  personalitySection?: string    // Already formatted
  memorySection?: string         // Already filtered/selected
  skillsSection?: string         // Only if applicable
}

// prompt-composer becomes a thin dispatcher:
export function buildAgentPrompt(input: BuildPromptInput): string {
  let prompt = CODING_AGENT_PREAMBLE
  if (input.personalitySection) prompt += input.personalitySection
  if (input.memorySection) prompt += input.memorySection
  // ... etc
}
```

Then `assembleRunContext()` (in run-agent.ts) handles the composition:
```typescript
const personality = buildPersonalitySection(pipelinePersonality)
const memoryText = getAllMemory({ repoName: task.repo })
const userMem = taskContent ? selectUserMemory(taskContent) : getUserMemory()
return buildAgentPrompt({
  agentType: 'pipeline',
  personalitySection: personality,
  memorySection: memoryText,
  // ...
})
```

**Effort:** M
**Confidence:** High

---

## F-t2-flow-3: Conflicting Abstraction Levels in Task Spec Truncation Logic
**Severity:** Medium
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/prompt-pipeline.ts:167-173`
**Evidence:**
```typescript
const MAX_TASK_CONTENT_CHARS = 8000
const truncatedContent = truncateSpec(taskContent, MAX_TASK_CONTENT_CHARS)
const wasTruncated = taskContent.length > MAX_TASK_CONTENT_CHARS
prompt += truncatedContent
if (wasTruncated) {
  prompt += `\n\n[spec truncated at ${MAX_TASK_CONTENT_CHARS} chars — see full spec in task DB]`
}
```

**Impact:**
- **Prompt builder does content manipulation:** `buildPipelinePrompt()` truncates the task spec mid-flow, mixing content policy (8000 char limit) with prompt assembly
- **Magic constant leaks into prompt builder:** `MAX_TASK_CONTENT_CHARS = 8000` is a policy constant that should live in `types.ts` or a config module, not embedded in prompt builder
- **Silent data loss:** If spec is truncated, the agent only sees "truncated at 8000 chars" but has no way to access the full spec. This is especially problematic for Files to Change / How to Test sections (which are critical) if they fall past the 8000-char boundary

**Recommendation:**
Move truncation to the caller (`assembleRunContext()`), not the prompt builder. The prompt builder should receive `taskContent` already normalized:
```typescript
// In run-agent.ts
const normalizedTaskContent = taskContent.length > MAX_TASK_SPEC_CHARS 
  ? taskContent.slice(0, MAX_TASK_SPEC_CHARS) + '...[truncated]'
  : taskContent

return buildAgentPrompt({
  agentType: 'pipeline',
  taskContent: normalizedTaskContent,  // Already truncated
  // ...
})
```

Then `prompt-pipeline.ts` doesn't need to re-check or re-truncate.

**Effort:** S
**Confidence:** High

---

## F-t2-flow-4: RunAgentDeps Dependency Injection Incoherence
**Severity:** Medium
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:43-71`
**Evidence:**
```typescript
export interface RunAgentSpawnDeps {
  activeAgents: Map<string, ActiveAgent>
  defaultModel: string
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  onSpawnSuccess?: () => void
  onSpawnFailure?: () => void
}

export interface RunAgentDataDeps {
  repo: ISprintTaskRepository
  logger: Logger
}

export interface RunAgentEventDeps {
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  logger: Logger
}

/**
 * Full dependency bag for runAgent(). Composed via intersection so callers
 * that only consume a sub-set can depend on the narrower interface.
 */
export type RunAgentDeps = RunAgentSpawnDeps & RunAgentDataDeps & RunAgentEventDeps
```

**Impact:**
- **Duplicated fields:** `onTaskTerminal` appears in both `RunAgentSpawnDeps` and `RunAgentEventDeps`; `logger` appears in all three interfaces. This creates redundancy
- **Intersection instead of composition:** Using type intersection (`&`) instead of a single coherent interface masks the true shape. The intersection expands to 8 fields, but intent is opaque
- **No clear role segmentation:** It's unclear why spawn logic needs activeAgents + onSpawnSuccess/Failure callbacks, or why data layer needs onTaskTerminal. The interfaces don't document why these are grouped together
- **Callback function pointer ambiguity:** `onTaskTerminal` is passed to run-agent and also used within completion.ts, which also has its own `onTaskTerminal` parameter. When these don't align, subtle bugs occur

**Recommendation:**
Restructure to a single, flat interface with clear role comments:
```typescript
export interface RunAgentDeps {
  // Data access
  repo: ISprintTaskRepository
  
  // Configuration
  defaultModel: string
  
  // Runtime state
  activeAgents: Map<string, ActiveAgent>
  
  // Callbacks for lifecycle events
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  onSpawnSuccess?: () => void      // Circuit breaker success signal
  onSpawnFailure?: () => void      // Circuit breaker failure signal
  
  // Logging
  logger: Logger
}
```

This is clearer: all dependencies are visible at once, with comments explaining each role.

**Effort:** S
**Confidence:** Medium

---

## F-t2-flow-5: Completion Resolution Mutates Task State Then Queries It Synchronously
**Severity:** High
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:200-208`
**Evidence:**
```typescript
const mergeResult = await executeSquashMerge({
  taskId,
  branch,
  worktreePath,
  repoPath: repoConfig.localPath,
  title,
  logger
})

if (mergeResult === 'merged') {
  const reviewTask = repo.getTask(taskId)  // <-- Query immediately after mutation elsewhere
  repo.updateTask(taskId, {
    status: 'done',
    completed_at: nowIso(),
    worktree_path: null,
    ...(reviewTask?.duration_ms !== undefined ? { duration_ms: reviewTask.duration_ms } : {})
  })
```

**Impact:**
- **Race condition vector:** `executeSquashMerge()` modifies git state + remote repo, but `repo.getTask(taskId)` queries the local task DB without any re-fetch from remote. If another process updates the task DB between the merge and the query, the query will return stale data
- **Implicit ordering assumption:** The code assumes the task DB row hasn't changed since the merge started. If auto-merge rules or other completion handlers run in parallel, the task row could have been modified (e.g., `duration_ms` could have been set elsewhere)
- **Patch mutation pattern:** Building a patch with `...(reviewTask?.duration_ms !== undefined ? { duration_ms: ... } : {})` is brittle. If reviewTask is null, the patch silently loses fields

**Recommendation:**
Either:
1. **Fetch fresh task state** before mutating:
   ```typescript
   const beforeMerge = repo.getTask(taskId)
   const mergeResult = await executeSquashMerge(...)
   if (mergeResult === 'merged') {
     const afterMerge = repo.getTask(taskId)  // Re-fetch to catch any concurrent changes
     repo.updateTask(taskId, {
       status: 'done',
       completed_at: nowIso(),
       worktree_path: null,
       ...(afterMerge?.duration_ms !== undefined ? { duration_ms: afterMerge.duration_ms } : {})
     })
   }
   ```

2. **Or pass the task state as a parameter** so no re-fetch is needed:
   ```typescript
   export async function attemptAutoMerge(
     opts: AutoMergeOpts & { currentTask: SprintTask }
   ): Promise<void> { ... }
   ```

**Effort:** M
**Confidence:** High

---

## F-t2-flow-6: TurnTracker Holds Implicit Database Connection Reference
**Severity:** Medium
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/turn-tracker.ts:1, 12-15, 50`
**Evidence:**
```typescript
import { getDb } from '../db'
import { insertAgentRunTurn } from '../data/agent-queries'

export class TurnTracker {
  private tokensIn = 0
  // ...
  constructor(
    private runId: string,
    private db?: import('better-sqlite3').Database
  ) {}

  processMessage(msg: unknown): void {
    // ...
    insertAgentRunTurn(this.db ?? getDb(), { ... })
  }
}
```

**Impact:**
- **Optional parameter with fallback to global:** The `db` parameter is optional; if not provided, `processMessage()` calls `getDb()` — a module-level function that pulls the global DB singleton. This creates hidden coupling
- **Two code paths:** Callers can pass a DB instance OR rely on the fallback. Tests might pass a mock DB, but production code uses the singleton. This makes the class harder to reason about
- **Message processing does I/O:** Every call to `processMessage()` (in the hot message loop) may perform a DB insert. If the DB is slow or blocking, it can stall the message stream

**Recommendation:**
Make the database mandatory in the constructor or explicitly handle the no-DB case:
```typescript
export class TurnTracker {
  constructor(
    private runId: string,
    private db: import('better-sqlite3').Database  // Required, not optional
  ) {}
}

// Caller must provide:
const db = getDb()
const turnTracker = new TurnTracker(agentRunId, db)
```

Or, if the DB is optional, make it a separate concern (buffer turns in memory, flush later):
```typescript
export class TurnTracker {
  private turns: TurnRecord[] = []
  
  processMessage(msg: unknown): void {
    // Accumulate in memory
    this.turns.push({ ... })
  }
  
  async flush(db: Database): Promise<void> {
    // Bulk insert after agent run completes
    for (const turn of this.turns) {
      insertAgentRunTurn(db, turn)
    }
  }
}
```

**Effort:** M
**Confidence:** Medium

---

## F-t2-flow-7: Upstream Context Fetching Traverses Repository Boundary Without Explicit Validation
**Severity:** Medium
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:271-296` (fetchUpstreamContext)
**Evidence:**
```typescript
export function fetchUpstreamContext(
  deps: TaskDependency[] | null | undefined,
  repo: ISprintTaskRepository,
  logger: Logger
): Array<{ title: string; spec: string; partial_diff?: string }> {
  const upstreamContext: Array<{ title: string; spec: string; partial_diff?: string }> = []
  if (!deps || deps.length === 0) return upstreamContext
  for (const dep of deps) {
    try {
      const upstreamTask = repo.getTask(dep.id)
      if (upstreamTask && upstreamTask.status === 'done') {
        const spec = upstreamTask.spec || upstreamTask.prompt || ''
        if (spec.trim()) {
          upstreamContext.push({
            title: upstreamTask.title,
            spec: spec.trim(),
            partial_diff: upstreamTask.partial_diff || undefined
          })
        }
      }
    } catch (err) {
      logger.warn(`[agent-manager] Failed to fetch upstream task ${dep.id}: ${err}`)
    }
  }
  return upstreamContext
}
```

**Impact:**
- **Silent filtering of missing/invalid upstream tasks:** If an upstream task doesn't exist (`repo.getTask()` returns null) or isn't done, it's silently omitted from context. The agent is unaware that a declared dependency isn't available
- **No clear contract:** The function doesn't document whether empty upstreamContext is acceptable (dependency declared but not ready → task should wait) or a failure (dependency should block, not silently skip)
- **Partial diff without schema:** `partial_diff` is optional in the output but queried from `upstreamTask.partial_diff`. There's no type safety or documentation of the schema for this field, and if it's malformed, it's silently dropped

**Recommendation:**
Distinguish between "dependency not satisfied" (task should be blocked) and "dependency satisfied but unavailable" (e.g., spec deleted):
```typescript
export function fetchUpstreamContext(
  deps: TaskDependency[] | null | undefined,
  repo: ISprintTaskRepository,
  logger: Logger
): {
  context: Array<{ title: string; spec: string; partial_diff?: string }>
  missingDeps: string[]
  blockingDeps: string[]
} {
  const context: Array<{ title: string; spec: string; partial_diff?: string }> = []
  const missingDeps: string[] = []
  const blockingDeps: string[] = []
  
  if (!deps || deps.length === 0) {
    return { context, missingDeps, blockingDeps }
  }
  
  for (const dep of deps) {
    try {
      const upstreamTask = repo.getTask(dep.id)
      if (!upstreamTask) {
        missingDeps.push(dep.id)
        continue
      }
      if (upstreamTask.status !== 'done') {
        blockingDeps.push(dep.id)
        continue
      }
      // ... assemble context
    } catch (err) {
      logger.error(`[agent-manager] Failed to fetch upstream task ${dep.id}: ${err}`)
      blockingDeps.push(dep.id)  // Treat errors as blocking
    }
  }
  
  return { context, missingDeps, blockingDeps }
}
```

Callers can then decide: if `blockingDeps.length > 0`, the task should be blocked, not queued.

**Effort:** M
**Confidence:** Medium

---

## F-t2-flow-8: Agent Model Selection Defers to Task Default Without Validation Against Config
**Severity:** Low
**Category:** Coupling / Data Flow
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:721`
**Evidence:**
```typescript
export async function runAgent(
  task: RunAgentTask,
  worktree: { worktreePath: string; branch: string },
  repoPath: string,
  deps: RunAgentDeps
): Promise<void> {
  const { logger } = deps
  const effectiveModel = task.model || deps.defaultModel
  // ...
}
```

**Impact:**
- **Per-task model override without audit trail:** If `task.model` is set, it unconditionally overrides `defaultModel`. There's no logging, no validation that the override is a valid model, and no way to track which tasks were spawned with non-default models
- **Cost control gap:** An agent manager configured for "claude-opus-4-6" (expensive) could have a task override it to "claude-5" (hypothetical future, even more expensive) without guardrails
- **Silent cross-team model drift:** If one team member sets a task model to a different version, other team members won't see a clear record unless they inspect the task DB directly

**Recommendation:**
Validate and log model selection:
```typescript
const effectiveModel = task.model || deps.defaultModel

if (task.model && task.model !== deps.defaultModel) {
  logger.info(`[agent-manager] Task ${task.id} overrides model: ${task.model} (config default: ${deps.defaultModel})`)
}

// Optionally: validate against a whitelist
const allowedModels = ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5']
if (!allowedModels.includes(effectiveModel)) {
  logger.warn(`[agent-manager] Task ${task.id} requested unknown model: ${effectiveModel} — using default`)
  effectiveModel = deps.defaultModel
}
```

**Effort:** S
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Abstraction Level | Module Boundary | Effort |
|---------|----------|-------------------|-----------------|--------|
| F-t2-flow-1: Dynamic Settings Import in Completion | High | Mixed | Data ↔ Completion | M |
| F-t2-flow-2: Prompt Composer Agent-System Coupling | High | Violation | Composer ↔ Agent-System | M |
| F-t2-flow-3: Spec Truncation in Prompt Builder | Medium | Mixed | Policy ↔ Assembly | S |
| F-t2-flow-4: RunAgentDeps Incoherence | Medium | Design | Internal | S |
| F-t2-flow-5: Completion State Mutation Race | High | Logic | Data ↔ Git | M |
| F-t2-flow-6: TurnTracker Implicit DB Reference | Medium | Coupling | Telemetry ↔ DB | M |
| F-t2-flow-7: Upstream Context Silent Filtering | Medium | Logic | Data ↔ Prompt | M |
| F-t2-flow-8: Model Override Without Validation | Low | Validation | Config ↔ Task | S |

---

## Recommendations for Priority

**Immediate (High Severity):**
1. **F-t2-flow-2:** Invert prompt composer dependency on agent-system. This is the tightest coupling and most likely to cause cascading failures during refactoring.
2. **F-t2-flow-1:** Move settings injection into RunAgentDeps to eliminate hidden ambient coupling in completion resolution.
3. **F-t2-flow-5:** Add safeguards around task state mutation in auto-merge to prevent race conditions.

**Short-term (Medium Severity):**
1. **F-t2-flow-6:** Refactor TurnTracker to make DB dependency explicit and testable.
2. **F-t2-flow-7:** Enhance upstream context fetching to distinguish blocking vs. silent-skip dependencies.
3. **F-t2-flow-4:** Flatten RunAgentDeps to a single coherent interface.

**Optional (Low Severity):**
1. **F-t2-flow-3:** Move spec truncation policy to run-agent caller.
2. **F-t2-flow-8:** Add model selection logging and validation.

---

## Confidence Assessment

All findings are **High Confidence** except:
- **F-t2-flow-8:** Low confidence (model override is a minor concern; validation is defensive rather than correctness-critical)
- **F-t2-flow-4:** Medium confidence (incoherence is aesthetic; doesn't prevent correct usage)

