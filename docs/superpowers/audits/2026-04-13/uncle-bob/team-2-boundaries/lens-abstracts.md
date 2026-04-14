# Clean Architecture Ports & Abstractions Audit
**Date:** 2026-04-13  
**Scope:** Concrete implementation leakage into high-level policy  
**Focus:** Repository pattern, SDK coupling, database access, filesystem operations

---

## F-t2-abstracts-1: Direct Database Access in Agent Execution Path
**Severity:** High  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/run-agent.ts:13`, `src/main/agent-manager/turn-tracker.ts:1-2`

**Evidence:**
```typescript
// run-agent.ts line 13
import { getDb } from '../db'

// run-agent.ts ~line 244 (updateAgentRunCost call)
import { updateAgentRunCost } from '../data/agent-queries'
updateAgentRunCost(getDb(), agentRunId, { tokensIn, tokensOut, costUsd })

// turn-tracker.ts line 50
insertAgentRunTurn(this.db ?? getDb(), { runId, turn, tokensIn, ... })
```

**Impact:**
- High-level orchestration (run-agent) directly couples to SQLite via `getDb()`, bypassing any abstraction
- The agent execution loop depends on a concrete database singleton, making it impossible to test without a real database
- Agent cost/turn tracking cannot be mocked or replaced with an alternative storage backend
- Violates the Stable Abstractions Principle: the most volatile module (agent execution) directly depends on an infrastructure detail (SQLite)

**Recommendation:**
Introduce a `IAgentRunRepository` or `IAgentMetadataStorage` port that abstracts cost/turn tracking. Inject it into `RunAgentDeps` instead of allowing direct `getDb()` calls. Example:
```typescript
export interface IAgentMetadataStorage {
  recordCostUpdate(agentRunId: string, cost: { tokensIn, tokensOut, costUsd }): void
  recordTurn(agentRunId: string, turn: AgentTurn): void
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-abstracts-2: SDK Type Coupling in sdk-adapter.ts
**Severity:** High  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/sdk-adapter.ts:4, 110, 119-177`

**Evidence:**
```typescript
// Direct import of node:child_process
import { spawn } from 'node:child_process'

// Line 110-111: Direct import of SDK concrete type
const sdk = await import('@anthropic-ai/claude-agent-sdk')
return spawnViaSdk(sdk, opts, env, token, opts.logger)

// Lines 119-177: Concrete SDK API assumptions
// spawnViaSdk assumes sdk.query() exists and has specific signature
// Tight coupling to SDK message shape (SDKWireMessage structure)
```

**Impact:**
- High-level agent manager depends on concrete `@anthropic-ai/claude-agent-sdk` types and behavior
- If SDK API changes (e.g., `query()` signature, message schema), agent-manager must be modified
- Cannot substitute an alternative agent backend (e.g., Anthropic Managed Agents, OpenAI, local LLM)
- Testing agent spawning requires the actual SDK to be installed and available
- No ability to mock or stub the SDK in tests without module-level mocking

**Recommendation:**
Create an `IAgentSpawner` interface that abstracts both SDK and CLI spawning:
```typescript
export interface IAgentSpawner {
  spawn(opts: { prompt: string; cwd: string; model: string }): Promise<AgentHandle>
}

// Then sdk-adapter.ts exports a concrete implementation:
export function createSdkAgentSpawner(): IAgentSpawner { ... }
```
Inject this into run-agent's dependencies instead of calling spawnWithTimeout directly.

**Effort:** L  
**Confidence:** High

---

## F-t2-abstracts-3: Filesystem Operations Not Behind Port in agent-manager
**Severity:** High  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/run-agent.ts:15-16`, `src/main/agent-manager/git-operations.ts:8-11`

**Evidence:**
```typescript
// run-agent.ts lines 15-16
import { mkdirSync, readFileSync } from 'node:fs'

// git-operations.ts line 8
import { execFileAsync, sleep } from '../lib/async-utils'
// execFileAsync wraps child_process.execFile but is still a wrapper, not an abstraction

// Usage in run-agent.ts: BDE_TASK_MEMORY_DIR is accessed directly
mkdirSync(BDE_TASK_MEMORY_DIR, { recursive: true })
readFileSync(taskMemoryPath, 'utf-8')
```

**Impact:**
- Agent execution directly depends on Node's `fs` module, making tests require real filesystem
- Cannot replace with in-memory filesystem or alternate storage during tests
- Git operations (rebase, push, PR creation) are tightly coupled to `execFileAsync` wrapper without an abstraction layer
- High-level orchestration (agent-manager) cannot be tested in isolation from filesystem I/O

**Recommendation:**
Create a `IFilesystemPort` and `IGitPort` abstraction:
```typescript
export interface IFilesystemPort {
  ensureDir(path: string): Promise<void>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
}

export interface IGitPort {
  rebaseOntoMain(worktreePath: string): Promise<{ success: boolean; notes?: string }>
  pushBranch(worktreePath: string, branch: string): Promise<{ success: boolean }>
  createPr(worktreePath: string, prTitle: string): Promise<{ prUrl: string | null }>
}
```
Inject these into RunAgentDeps and completion.ts dependencies.

**Effort:** L  
**Confidence:** High

---

## F-t2-abstracts-4: ISprintTaskRepository Not Used by Core Agent Execution
**Severity:** Medium  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/run-agent.ts:9, src/main/agent-manager/completion.ts:1-120`

**Evidence:**
```typescript
// run-agent.ts line 9 — repo IS injected
import type { ISprintTaskRepository } from '../data/sprint-task-repository'

// But look at the actual usage pattern in completion.ts:
// Lines 108-122: Direct use of repo.updateTask(), repo.getTask()
// However, the critical issue is that agent-manager can ONLY update via repo
// while OTHER code paths bypass repo entirely.

// In sprint-local.ts lines 20-30:
// Calls updateTask() from sprint-service directly, NOT via repo interface
import { updateTask, createTask, deleteTask } from '../services/sprint-service'
// Then calls these functions directly without going through repo abstraction
updateTask(id, patch)  // Bypasses repo!

// Meanwhile, in agent-manager/index.ts line 277:
// Uses repo interface correctly
this.repo.updateTask(task.id, { status: 'error', ... })
```

**Impact:**
- Repository pattern is inconsistently applied: agent-manager respects the abstraction, but IPC handlers (sprint-local) bypass it
- Creates two data access pathways: one through `repo` interface, one through `sprint-service` functions
- If sprint-queries is modified, both code paths must be checked and potentially updated
- Handlers cannot be tested with mocked repositories because they import functions directly
- The repository interface exists but is not the canonical abstraction for all data access

**Recommendation:**
- Make sprint-local handlers ALWAYS use the injected `ISprintTaskRepository` instead of importing functions directly
- Ensure all data mutations go through the repo interface, not bypass it
- If sprint-service needs to exist for backward compatibility, refactor it to be a thin wrapper around repo methods
- Update sprint-local.ts:
```typescript
// BEFORE: Bypass repo
import { updateTask, createTask } from '../services/sprint-service'
updateTask(id, patch)

// AFTER: Use injected repo
export function registerSprintLocalHandlers(deps: SprintLocalDeps, repo: ISprintTaskRepository): void {
  safeHandle('sprint:update', async (_e, id: string, patch) => {
    const result = repo.updateTask(id, patch)
    // ... emit events
  })
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-abstracts-5: agent-history Mixes File I/O and Database Access Without Port
**Severity:** High  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-history.ts:1-32`

**Evidence:**
```typescript
// Imports mix filesystem, database, and data access
import { mkdir, writeFile, appendFile, open, rm, readdir, rename, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { getDb } from './db'
import { insertAgentRecord, updateAgentMeta, ... } from './data/agent-queries'

// Direct use of both:
// Line 40-41: Direct DB call
const db = getDb()
const count = db.prepare('SELECT COUNT(*) as cnt FROM agent_runs').get()

// Line 75: Direct filesystem call
await rename(AGENTS_INDEX, AGENTS_INDEX + '.bak')

// Line 50: Direct query call
insertAgentRunTurn(this.db ?? getDb(), { runId, turn, ... })
```

**Impact:**
- agent-history is a business-level service but directly depends on SQLite and filesystem
- Cannot be tested without both a real database and real filesystem
- Responsibilities are not separated: persistent storage abstraction is missing
- Makes migration from SQLite to another backend painful (must update agent-history)
- The fallback pattern `this.db ?? getDb()` indicates an injectable dependency that was added post-hoc but is not systemic

**Recommendation:**
Introduce `IAgentHistoryStorage` port that encapsulates both DB and filesystem operations:
```typescript
export interface IAgentHistoryStorage {
  getAgentCount(): number
  insertAgent(meta: AgentMeta): void
  updateAgent(id: string, updates: Partial<AgentMeta>): void
  listAgents(): AgentMeta[]
  getAgentLog(agentId: string, fromByte: number): Promise<LogContent>
  appendToLog(agentId: string, content: string): Promise<void>
  deleteAgent(id: string): void
}

// agent-history.ts becomes a coordinator that uses this port:
export class AgentHistory {
  constructor(private storage: IAgentHistoryStorage) { }
  async migrateFromJson() { ... }
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-abstracts-6: Direct Sprint-Queries Imports in IPC Handlers
**Severity:** Medium  
**Category:** Abstractions / Ports  
**Location:** `src/main/handlers/sprint-local.ts:20-30`

**Evidence:**
```typescript
// sprint-local.ts
import { 
  getTask,
  updateTask,
  createTask,
  deleteTask,
  listTasks,
  listTasksRecent,
  getHealthCheckTasks,
  getSuccessRateBySpecType,
  type CreateTaskInput
} from '../services/sprint-service'

// Lines 50-51: Called directly
safeHandle('sprint:list', () => {
  return listTasksRecent()  // Bypasses repo, uses service function directly
})

// Lines 64: createTask from service, not repo
const row = createTask(validation.task)
```

**Evidence:** Also in handlers/agent-handlers.ts and other IPC endpoints
```typescript
// Pattern repeated: functions imported from sprint-service, not repo interface
getTask(taskId)
updateTask(id, patch)
```

**Impact:**
- IPC layer depends on concrete sprint-service functions, not the repository abstraction
- Handler tests cannot inject a mock repository
- If sprint-service behavior changes, all handlers must be retested
- The repository pattern exists for agent-manager but is ignored by IPC handlers
- Two separate data access patterns in the same codebase

**Recommendation:**
- All IPC handlers must receive the injected `ISprintTaskRepository` as a dependency
- Remove direct imports of sprint-service functions in handlers
- Ensure handlers only call repo methods
- Example refactor:
```typescript
// BEFORE
import { getTask, updateTask } from '../services/sprint-service'
export function registerSprintLocalHandlers(deps: SprintLocalDeps) {
  safeHandle('sprint:update', async (_e, id, patch) => {
    updateTask(id, patch)
  })
}

// AFTER
export function registerSprintLocalHandlers(
  deps: SprintLocalDeps, 
  repo: ISprintTaskRepository
): void {
  safeHandle('sprint:update', async (_e, id, patch) => {
    repo.updateTask(id, patch)
  })
}
```

**Effort:** M  
**Confidence:** High

---

## F-t2-abstracts-7: No Port for Git Operations in Agent Completion
**Severity:** Medium  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/completion.ts:12-16`, `src/main/agent-manager/git-operations.ts:1-200+`

**Evidence:**
```typescript
// completion.ts lines 12-16
import {
  rebaseOntoMain,
  findOrCreatePRUtil,
  autoCommitIfDirty,
  executeSquashMerge
} from './git-operations'

// These are called directly in completion logic:
const rebaseResult = await rebaseOntoMain(worktreePath, env, logger)
const prResult = await findOrCreatePRUtil(...)
await autoCommitIfDirty(...)
await executeSquashMerge(...)

// git-operations.ts imports execFileAsync directly:
import { execFileAsync } from '../lib/async-utils'
// Then uses it throughout for git commands
```

**Impact:**
- Completion logic is tightly coupled to git CLI operations via execFileAsync wrapper
- Cannot test completion.ts without real git commands available
- If git command behavior changes (e.g., different flags, error formats), completion logic breaks
- No abstraction for "version control" — just raw git CLI wrapping
- Makes it impossible to substitute with alternative VCS or mock git in tests

**Recommendation:**
Create an `IVersionControlPort` to abstract git operations:
```typescript
export interface IVersionControlPort {
  rebaseOntoMain(worktreePath: string): Promise<RebaseResult>
  commitChanges(worktreePath: string, message: string): Promise<CommitResult>
  createPr(opts: PrCreateOpts): Promise<PrCreateResult>
  pushBranch(worktreePath: string, branch: string): Promise<{ success: boolean }>
  checkExistingPr(repoSlug: string, branch: string): Promise<PrInfo | null>
}

// Move git-operations functions into a concrete implementation:
export class GitVersionControl implements IVersionControlPort {
  async rebaseOntoMain(worktreePath: string): Promise<RebaseResult> { ... }
}

// Inject into completion.ts via RunAgentDeps
```

**Effort:** M  
**Confidence:** High

---

## F-t2-abstracts-8: Sprint-Local Calls getDb() Directly for Agent Log Queries
**Severity:** Medium  
**Category:** Abstractions / Ports  
**Location:** `src/main/handlers/sprint-local.ts:2, 167`

**Evidence:**
```typescript
// sprint-local.ts line 2
import { getDb } from '../db'

// Line 167: Direct DB call within handler
safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
  const info = getAgentLogInfo(getDb(), agentId)
  // ...
})
```

**Impact:**
- IPC handlers bypass any abstraction and call `getDb()` directly
- Handler cannot be tested without a real database
- If database location or schema changes, handlers must be updated
- Inconsistent with pattern where agent-manager receives injected `repo`

**Recommendation:**
- Pass database access through the repository interface or a separate `IAgentMetadataPort`
- Do NOT call `getDb()` from handler code
- Instead: `repo.getAgentLogInfo(agentId)` or equivalent

**Effort:** S  
**Confidence:** High

---

## F-t2-abstracts-9: Hardcoded Path Resolution in agent-manager
**Severity:** Medium  
**Category:** Abstractions / Ports  
**Location:** `src/main/agent-manager/index.ts:231-234`

**Evidence:**
```typescript
// agent-manager/index.ts lines 231-234
private resolveRepoPath(repoSlug: string): string | null {
  const repoPaths = getRepoPaths()
  return repoPaths[repoSlug.toLowerCase()] ?? null
}

// This calls getRepoPaths() directly, which reads from settings
import { getRepoPaths } from '../paths'
// getRepoPaths() is a side-effecting function that reads from settings singleton
```

**Impact:**
- Agent manager directly depends on `getRepoPaths()` function and settings module
- Cannot inject custom path resolution for tests
- Settings-based path resolution is tightly coupled to agent spawning logic
- Makes it impossible to test with different repo configurations without modifying settings

**Recommendation:**
Inject a path resolver into agent-manager:
```typescript
export interface IRepoPathResolver {
  resolve(repoSlug: string): string | null
}

// Inject into AgentManagerImpl:
constructor(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  private pathResolver: IRepoPathResolver,
  logger: Logger
)
```
Then resolve paths through the injected interface.

**Effort:** S  
**Confidence:** Medium

---

## Summary of Violations

| Finding | Severity | Module | Issue |
|---------|----------|--------|-------|
| F-t2-abstracts-1 | High | run-agent.ts | Direct `getDb()` for cost tracking |
| F-t2-abstracts-2 | High | sdk-adapter.ts | SDK type coupling, no port |
| F-t2-abstracts-3 | High | run-agent.ts, git-operations.ts | fs + child_process not abstracted |
| F-t2-abstracts-4 | Medium | sprint-local.ts | Bypasses repo interface |
| F-t2-abstracts-5 | High | agent-history.ts | Mixed DB + FS without port |
| F-t2-abstracts-6 | Medium | sprint-local.ts | Direct sprint-service imports |
| F-t2-abstracts-7 | Medium | completion.ts | Git operations not abstracted |
| F-t2-abstracts-8 | Medium | sprint-local.ts | Direct getDb() for logs |
| F-t2-abstracts-9 | Medium | agent-manager/index.ts | Hardcoded path resolver |

**Root Cause:** The codebase has begun applying the repository pattern in agent-manager but has not extended it systematically to other high-level modules (IPC handlers, agent-history, completion). Middle-tier services (sprint-service) are used inconsistently: agent-manager respects the abstraction layer, while handlers and orchestration bypass it.

**Recommended Priority:** Fix F-t2-abstracts-1, 2, 3, 5 first (Core agent execution) → then F-t2-abstracts-4, 6 (Repository consistency) → then F-t2-abstracts-7, 8, 9 (Completion logic and utilities).
