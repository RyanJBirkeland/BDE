# Architecture Audit — BDE (2026-04-14)

## Executive Summary

The BDE codebase demonstrates strong Clean Architecture fundamentals with clear separation of concerns between handlers, services, and data layers. Dependency Rule violations are minimal and well-documented as partial adoption of the repository pattern. The primary findings are architectural clarity issues (files mixing multiple concerns) and orchestration logic inadvertently sprinkled across the agent manager instead of consolidated in dedicated services. Five high-confidence findings below address the most impactful gaps. The repository abstraction is partially applied and documented in CLAUDE.md as acceptable technical debt.

---

## F-t1-arch-1: Agent Manager Contains Orchestration Business Logic Scattered Across Run-Agent and Index

**Severity:** High
**Category:** Architecture
**Location:** `src/main/agent-manager/run-agent.ts:200-450`, `src/main/agent-manager/index.ts:200-400`
**Evidence:** 
- `buildAgentPrompt()` composition logic in run-agent.ts lines 299-323
- OAuth refresh handling (lines 83-95) embedded in message consumption
- Cost tracking and token accumulation (lines 100-107) mixed with spawning logic
- Task terminal state transitions (handleTaskTerminal calls in run-agent.ts:372) tightly coupled with worktree cleanup

**Impact:** 
The agent lifecycle orchestration is woven through multiple files (run-agent.ts, index.ts, terminal-handler.ts, completion.ts) making it difficult to reason about state machines and validate completeness of terminal transitions. A new developer cannot find "where does an agent go from active→done?" without reading 5+ files. If a transition rule is missed (e.g., failing to notify dependents), the bug location is ambiguous.

**Recommendation:** 
Extract an `AgentOrchestrationService` that owns:
- Prompt assembly pipeline (consolidate from run-agent.ts + prompt-composer.ts delegation)
- Cost/token tracking lifecycle
- Terminal transition state machine (currently split across index.ts onTaskTerminal + terminal-handler.ts + completion.ts)
- OAuth refresh policy

Pass this service to runAgent() as a dependency rather than scattering calls. Handlers become one-liners: "call service.orchestrate(task)" and the service owns all rules.

**Effort:** L
**Confidence:** High

---

## F-t1-arch-2: Handler Bloat in Group-Handlers — Business Logic in Handler Initialization

**Severity:** Medium
**Category:** Architecture
**Location:** `src/main/handlers/group-handlers.ts:22-42`, `src/main/handlers/group-handlers.ts:95-116`
**Evidence:**
```typescript
const epicIndex = createEpicDependencyIndex()  // line 23 — at module scope

function initEpicIndex(): void {              // line 28
  const groups = listGroups()
  epicIndex.rebuild(groups)
}

function rebuildEpicIndex(): void {           // line 36 — called 3x per handler
  const groups = listGroups()
  epicIndex.rebuild(groups)
}
```
The epic dependency index is initialized on handler registration (line 42) rather than at application startup. It rebuilds on every mutation (groups:create, groups:addDependency, groups:removeDependency). This in-memory cache belongs in a service, not leaked into handler scope.

**Impact:** 
- The `epicIndex` variable is global to the handler module, making it fragile if handlers are ever re-registered
- Rebuilding happens inside handlers instead of being orchestrated by a service; no single place owns "when is the epic index stale?"
- Cannot be unit-tested independently of IPC handler registration

**Recommendation:** 
Create `EpicIndexService` that owns index lifecycle:
```typescript
export class EpicIndexService {
  private index: EpicDependencyIndex
  
  constructor(private repo: ITaskGroupRepository) {
    this.index = createEpicDependencyIndex()
    this.rebuild() // on creation
  }
  
  rebuild(): void {
    this.index.rebuild(this.repo.listGroups())
  }
}
```
Inject into handler deps; handlers call `epicIndexService.rebuild()` after mutations. The service is testable independently.

**Effort:** M
**Confidence:** High

---

## F-t1-arch-3: Sprint-Local Handler Directly Accesses Data Layer (listGroups, getAgentLogInfo, UPDATE_ALLOWLIST)

**Severity:** Medium
**Category:** Architecture
**Location:** `src/main/handlers/sprint-local.ts:35,39`, `src/main/handlers/sprint-local.ts:89`, `src/main/handlers/sprint-local.ts:164`
**Evidence:**
```typescript
import { UPDATE_ALLOWLIST } from '../data/sprint-maintenance-facade'  // line 33
import { getAgentLogInfo } from '../data/agent-queries'                 // line 35
import { listGroups } from '../data/task-group-queries'                 // line 39

// In handlers:
const filteredPatch = validateAndFilterPatch(patch, UPDATE_ALLOWLIST)   // line 89
const info = getAgentLogInfo(getDb(), agentId)                          // line 164
```

The handler imports from `data/` modules directly. CLAUDE.md documents this as partially applied repository adoption, but the imports undermine the abstraction layer. Callers reach past the repository interface to raw queries.

**Impact:** 
If the query implementation changes (e.g., schema refactor), handlers must be updated. The contract is implicit (which data keys are safe to update) instead of explicit at the service/handler boundary. Tests must mock multiple data modules instead of a single interface.

**Recommendation:** 
Extend `ISprintTaskRepository` or create a new `SprintTaskService` interface that:
- Exposes `validatePatchFields(patch) → FilteredPatch` (hides UPDATE_ALLOWLIST)
- Exposes `getTaskAgentInfo(taskId) → AgentInfo | null` (hides getAgentLogInfo + getDb coupling)
- Exposes `listDependentGroups() → TaskGroup[]` (used by task-validation.ts + handlers)

Import the service instead of raw queries. The repository pattern is then consistently applied and handlers no longer reach into data/.

**Effort:** M
**Confidence:** High

---

## F-t1-arch-4: Task Validation Logic Duplicated Between sprint-local.ts and sprint-batch-handlers.ts

**Severity:** Medium
**Category:** Architecture
**Location:** `src/main/handlers/sprint-local.ts:56-69` (uses validateTaskCreation), `src/main/handlers/sprint-batch-handlers.ts:59-81` (uses validateTaskSpec inline)
**Evidence:**
```typescript
// sprint-local.ts — delegates to service
const validation = validateTaskCreation(task, { logger, listTasks, listGroups })
if (!validation.valid) throw new Error(...)

// sprint-batch-handlers.ts — inline validation for batch
if (filtered.status === 'queued') {
  const task = getTask(id)
  if (task) {
    try {
      const specText = (filtered.spec as string) ?? task.spec ?? null
      await validateTaskSpec({ ... })
    } catch (err) { ... }
  }
}
```

Both handlers validate task specs before queuing, but use different code paths. Single-task creation calls `validateTaskCreation()` (which includes dependency blocking), but batch update does NOT auto-block and only validates spec. This creates subtle inconsistency: a task created individually might auto-block, but the same task updated via batch won't.

**Impact:** 
- Inconsistent behavior across UI paths (create → may auto-block; batch-update-to-queued → never auto-blocks)
- If validation rules change, two places must be updated
- Test coverage is split (one set tests validateTaskCreation, another tests inline logic)

**Recommendation:** 
Extract a `TaskQueueingPolicy` service that owns all rules for transitioning to `queued`:
```typescript
export class TaskQueueingService {
  async validateAndPrepareQueuing(taskId, incomingPatch): Promise<QueueResult> {
    // Spec validation + dependency auto-blocking
    // Returns final patch (possibly with status changed to 'blocked')
  }
}
```
Both sprint-local.ts and sprint-batch-handlers.ts call this. Spec validation + dependency blocking happen identically for all queueing paths.

**Effort:** M
**Confidence:** Medium

---

## F-t1-arch-5: Bootstrap.ts Direct SQL Access Violates Abstraction Layer

**Severity:** Medium
**Category:** Architecture
**Location:** `src/main/bootstrap.ts:152-159`
**Evidence:**
```typescript
try {
  const db = getDb()
  const result = db.prepare("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'").run()
  if (result.changes > 0) {
    logger.info(`Cleaned ${result.changes} test task artifacts`)
  }
} catch { /* non-fatal */ }
```

Bootstrap.ts is a startup orchestration file. It reaches directly into the database to clean up test artifacts instead of delegating to a data service or repository method. This is the only place in the codebase that executes raw SQL directly (not through a query function).

**Impact:** 
If the sprint_tasks schema changes, this SQL breaks without compilation errors (SQL is a string literal). The cleanup logic is isolated from the rest of task mutation logic and is not centralized. Harder to audit all places that mutate sprint_tasks.

**Recommendation:** 
Create `SprintTaskMaintenanceService.cleanTestArtifacts()`:
```typescript
export function cleanTestArtifacts(): number {
  const result = db.prepare("DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'").run()
  return result.changes
}
```
Call from bootstrap.ts; the function lives in services/ where other cleanup operations belong (pruning, archiving, etc.). Schema changes are now localized to the data layer.

**Effort:** S
**Confidence:** High

---

## Summary Table

| Finding | File | Severity | Type | Effort |
|---------|------|----------|------|--------|
| F-t1-arch-1 | agent-manager/* | High | Orchestration scattered | L |
| F-t1-arch-2 | group-handlers.ts | Medium | In-memory state in handler | M |
| F-t1-arch-3 | sprint-local.ts | Medium | Direct data imports | M |
| F-t1-arch-4 | sprint-local + batch | Medium | Duplicated validation | M |
| F-t1-arch-5 | bootstrap.ts | Medium | Raw SQL outside data layer | S |

All findings are violations of Clean Architecture principles (dependency rule or single responsibility) but do not impact runtime behavior. They increase cognitive load and maintenance friction.

