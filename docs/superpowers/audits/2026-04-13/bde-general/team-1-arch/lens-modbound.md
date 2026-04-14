# Module Boundary Audit — 2026-04-13

## Overall Assessment

The BDE codebase maintains **strong process boundaries** (renderer/preload/main are properly isolated with IPC) and follows a generally sound **three-layer architecture** (handlers → services → data). However, there are **4 meaningful architectural violations** that cross the handler/service boundary, violate the separation of concerns principle, and should be addressed:

1. **Services importing validation helpers from handlers** — task-state-service pulls validateTaskSpec from handlers layer, inverting the dependency direction
2. **Handlers creating repository instances directly** — violates the DI pattern already established in agent-manager, creates hidden dependencies
3. **Handler layer mixing raw database queries** — agent-handlers imports and calls data-layer functions directly instead of through services
4. **Main process wiring service functions directly** — index.ts calls git command functions that should be encapsulated in services or handlers

These are not critical in isolation but together signal a need for stricter layer enforcement. The baseline issues mentioned in CLAUDE.md (repository abstraction bypass, status transitions in data layer) are known and explicitly documented, so those are excluded from this audit.

---

## F-t1-modbound-1: Service Layer Importing from Handler Layer

**Severity:** High  
**Category:** Module Boundaries  
**Location:** `/Users/ryan/projects/BDE/src/main/services/task-state-service.ts:16`

**Evidence:**
```typescript
// task-state-service.ts
import { validateTaskSpec } from '../handlers/sprint-validation-helpers'

export async function prepareQueueTransition(
  taskId: string,
  incomingPatch: Record<string, unknown>,
  deps: QueueTransitionDeps
): Promise<QueueTransitionResult> {
  // ...
  const specText = (incomingPatch.spec as string) ?? task.spec ?? null
  await validateTaskSpec({ title: task.title, repo: task.repo, spec: specText, context: 'queue' })
```

**Impact:**  
The service layer (task-state-service) is importing from the handler layer (handlers/sprint-validation-helpers). This inverts the normal dependency direction: handlers should call services, not the reverse. This creates a hidden bidirectional dependency that violates Clean Architecture layering and makes it harder to reason about which layer owns each responsibility. The spec validation logic is a business rule (belongs in services or shared), not an IPC concern (handler layer).

**Recommendation:**  
Move `validateTaskSpec` from `src/main/handlers/sprint-validation-helpers.ts` to `src/main/services/spec-validation-service.ts` (or equivalent). Have both handlers and task-state-service import from the service layer. This also clarifies ownership: spec validation is a service-layer concern, not a handler concern.

**Effort:** M  
**Confidence:** High

---

## F-t1-modbound-2: Handlers Creating Multiple Repository Instances

**Severity:** Medium  
**Category:** Module Boundaries  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/agent-handlers.ts:33`, `/Users/ryan/projects/BDE/src/main/handlers/sprint-local.ts:69`, `/Users/ryan/projects/BDE/src/main/handlers/sprint-batch-handlers.ts:134`

**Evidence:**
```typescript
// agent-handlers.ts:33
export function registerAgentHandlers(am?: AgentManager): void {
  const repo = createSprintTaskRepository()
  // handler code uses repo...
}

// sprint-local.ts:69
safeHandle('sprint:createWorkflow', async (_e, template: WorkflowTemplate) => {
  const repo = createSprintTaskRepository()
  const result = instantiateWorkflow(template, repo)
  // ...
})

// sprint-batch-handlers.ts:134
const repo = createSprintTaskRepository()
return batchImportTasks(tasks, repo)
```

**Impact:**  
Multiple handlers create `SprintTaskRepository` instances independently. This violates the Dependency Injection pattern already established in the codebase (agent-manager receives the repo via constructor, main/index.ts hoists repo construction for the terminal service). Creating multiple repository instances can lead to inconsistency if the factory returns stateful objects, complicates testing, and makes it harder to swap implementations. Handlers should receive the repository as a dependency, not create it.

**Recommendation:**  
Extend the `AppHandlerDeps` interface to include the `ISprintTaskRepository` instance created in `src/main/index.ts` (currently this repo is only shared with agent-manager and terminal-service). Pass it through `registerAllHandlers()` and into each handler registration function. This keeps the single source of truth in the bootstrap code and makes all handler dependencies explicit.

**Effort:** M  
**Confidence:** High

---

## F-t1-modbound-3: Handlers Calling Data-Layer Functions Directly

**Severity:** Medium  
**Category:** Module Boundaries  
**Location:** `/Users/ryan/projects/BDE/src/main/handlers/agent-handlers.ts:98-101`

**Evidence:**
```typescript
// agent-handlers.ts
safeHandle('agent:history', async (_e, agentId: string) => {
  // Event history from local SQLite — kept for viewing historical runs
  const { getEventHistory } = await import('../data/event-queries')
  const { getDb } = await import('../db')
  const rows = getEventHistory(getDb(), agentId)
  return rows.map((r) => JSON.parse(r.payload))
})
```

**Impact:**  
The handler is importing and calling `getEventHistory()` directly from the data layer, bypassing any service layer abstraction. While the handler passes the DB to the data-layer function (good), this still creates a tight coupling to the specific data-access API. If data layer changes, handlers break. The pattern elsewhere (e.g., sprint-local.ts) is to call service-layer functions like `getTask()`, which is the correct direction.

**Recommendation:**  
Either: (1) wrap `getEventHistory` in a service-layer function in `src/main/services/agent-history-service.ts` and call that from the handler, OR (2) if this is truly a read-only data-access operation with no business logic, accept it as a thin convenience call and document it as an exception. However, given that `agent-history` is already a module (`agent-history.ts`), prefer moving this into a service-layer wrapper there or in a dedicated service module.

**Effort:** S  
**Confidence:** Medium

---

## F-t1-modbound-4: Main Process Bootstrap Wiring Service Functions as Closure Arguments

**Severity:** Medium  
**Category:** Module Boundaries  
**Location:** `/Users/ryan/projects/BDE/src/main/index.ts:182-222`

**Evidence:**
```typescript
// index.ts — git command wrappers defined in-line as closures
const getHeadCommitSha = async (worktreePath: string): Promise<string> => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

const getBranch = async (worktreePath: string): Promise<string> => {
  // similar git command wrapper
}

const getDiff = async (worktreePath: string): Promise<string> => {
  // similar git command wrapper
}

// Passed into reviewService
const reviewService = createReviewService({
  repo: reviewRepo,
  taskRepo: sprintTaskRepository,
  logger: reviewServiceLogger,
  resolveWorktreePath: async (taskId) => resolveWorktreePathViaRepo(taskId),
  getHeadCommitSha,
  getDiff,
  getBranch,
  runSdkOnce
})
```

**Impact:**  
The main/index.ts bootstrap is defining low-level git command wrappers (`getHeadCommitSha`, `getBranch`, `getDiff`) as inline closures and passing them as dependencies to the review service. This couples bootstrap logic to git command execution, making it harder to test, reuse, or swap implementations. These functions are also duplicated elsewhere (e.g., review.ts handlers re-implement similar patterns). The proper place for git command abstractions is a service module (e.g., `src/main/services/git-command-service.ts`).

**Recommendation:**  
Extract `getHeadCommitSha`, `getBranch`, and `getDiff` into a dedicated `src/main/services/git-command-service.ts` module. This centralizes git command patterns, makes them testable, reusable, and easier to mock. Have both bootstrap (for review service setup) and handlers (like review.ts) import from this service. This also makes it clearer that these are stable abstractions, not one-off bootstrap utilities.

**Effort:** M  
**Confidence:** High

---

## Summary of Recommended Changes

| Finding | Priority | Type | Effort |
|---------|----------|------|--------|
| F-t1-modbound-1 | High | Layer inversion (service ← handler) | M |
| F-t1-modbound-2 | High | Hidden dependencies (repo creation) | M |
| F-t1-modbound-3 | Medium | Data layer coupling (bypassing service) | S |
| F-t1-modbound-4 | Medium | Bootstrap wiring (git commands inline) | M |

**Total effort to remediate:** 1–2 developer days.

**No findings on:**
- Renderer/main process boundary (properly enforced via IPC)
- Preload isolation (correct usage of contextBridge)
- Circular dependencies at the import level (none detected)
- Process-level violations (no renderer importing main modules, etc.)

