# Clean Architecture Dependency Rule Audit — 2026-04-13

**Auditor:** Claude Code  
**Layer Model:** Innermost (`src/shared/`) → Middle (`src/main/`) → Outer (`src/renderer/`) → Outermost (`src/preload/`)  
**Total Findings:** 5  
**Severity Breakdown:** 3 Critical, 2 High

---

## F-t2-deprule-1: Shared Layer Test Importing Renderer UI Constants

**Severity:** Critical  
**Category:** Dependency Rule  
**Location:** `/Users/ryan/projects/BDE/src/shared/__tests__/task-state-machine.test.ts:14`

**Evidence:**
```typescript
import { type BucketKey, STATUS_METADATA } from '../../renderer/src/lib/task-status-ui'
```

**Impact:** 
The innermost layer (shared types and constants) depends on renderer UI implementation details. This violates the dependency rule at its most critical boundary. `STATUS_METADATA` is UI presentation logic that should not be part of shared domain knowledge. If the renderer changes its UI bucketing strategy, it breaks shared tests. Creates bidirectional coupling: shared ↔ renderer (architectural inversion).

**Recommendation:** 
Move `STATUS_METADATA` and `BucketKey` type to `src/shared/` as they are pure domain metadata. Renderer can import from shared, but shared must never import from renderer. Extract UI-specific rendering code into renderer-only modules that adapt shared `TaskStatus` to UI buckets.

**Effort:** S  
**Confidence:** High

---

## F-t2-deprule-2: High-Level Agent Orchestration Directly Importing Database Access Layer

**Severity:** Critical  
**Category:** Dependency Rule / Plugin Rule  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/turn-tracker.ts:1`

**Evidence:**
```typescript
import { getDb } from '../db'
// ...
insertAgentRunTurn(this.db ?? getDb(), {
  runId: this.runId,
  turn: this.turnCount,
  // ...
})
```

**Impact:** 
`TurnTracker` is a core agent lifecycle component that directly calls low-level database operations via `getDb()`. This couples orchestration logic to the SQLite data layer. The database becomes a hard dependency that cannot be swapped (e.g., for testing with in-memory store). If DB initialization fails, agent tracking fails silently. Violates the plugin rule: database details should plug into orchestration via dependency injection, not be called directly.

**Recommendation:** 
Inject a `TurnTrackerDeps` interface that includes a bound `insertAgentRunTurn` function or database handle. Pass it from `runAgent` deps. This allows tests to inject mock persistence and makes the contract explicit.

**Effort:** M  
**Confidence:** High

---

## F-t2-deprule-3: Agent Completion Logic Directly Importing Filesystem Operations

**Severity:** Critical  
**Category:** Dependency Rule / Plugin Rule  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/completion.ts:1, :326`

**Evidence:**
```typescript
import { existsSync } from 'node:fs'
// ...
if (!existsSync(worktreePath)) {
  // guard check in resolveSuccess
}
```

**Impact:** 
`completion.ts` is high-level task completion orchestration that directly imports and uses Node.js filesystem APIs. This creates a hard dependency on the filesystem abstraction (Node.js `fs` module). The completion logic is tightly coupled to filesystem existence checks—if deployment moves to a different filesystem abstraction (e.g., virtual/remote), this code breaks. Violates the dependency rule: completion policy should depend on abstractions, not implementation details.

**Recommendation:** 
Create an abstraction layer `WorktreePathValidator` with an `exists(path: string): boolean` method. Inject it into `resolveSuccess` options. Move the `existsSync` check into this adapter that wraps `node:fs`. This allows filesystem implementation to vary while preserving the completion contract.

**Effort:** S  
**Confidence:** High

---

## F-t2-deprule-4: Agent Execution Directly Accessing Database Without Injection

**Severity:** Critical  
**Category:** Dependency Rule / Plugin Rule  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:13, :539`

**Evidence:**
```typescript
import { getDb } from '../db'
// ...
updateAgentRunCost(getDb(), agentRunId, {
  costUsd: agent.costUsd ?? 0,
  tokensIn: totals.tokensIn,
  // ...
})
```

**Impact:** 
`run-agent.ts` is the core agent execution orchestrator. It directly calls `getDb()` to persist cost and token data. This creates a hard dependency on database availability during agent execution. If DB is down, cost tracking fails silently (caught but logged). The agent execution path is coupled to a specific data persistence mechanism. Violates the plugin rule: database operations should be injected as optional callbacks, not called directly.

**Recommendation:** 
Add `updateAgentRunMetrics?: (data: AgentMetrics) => Promise<void>` to `RunAgentDeps`. Make it optional with a no-op default. Pass database calls through this injected callback. This allows agents to run without persistence (in-memory mode) or swap persistence layers.

**Effort:** M  
**Confidence:** High

---

## F-t2-deprule-5: Agent Scratchpad File I/O in Core Orchestration Path

**Severity:** High  
**Category:** Dependency Rule / Plugin Rule  
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:15-16, :302-311`

**Evidence:**
```typescript
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// ...
export function readPriorScratchpad(taskId: string): string {
  const scratchpadDir = join(BDE_TASK_MEMORY_DIR, taskId)
  mkdirSync(scratchpadDir, { recursive: true })
  try {
    return readFileSync(join(scratchpadDir, 'progress.md'), 'utf-8')
  } catch {
    return ''
  }
}
```

**Impact:** 
`readPriorScratchpad` is called during agent context assembly—a hot path in orchestration. It directly uses `mkdirSync` and `readFileSync` from `node:fs`. This couples task memory loading to the filesystem abstraction. If memory needs to move to cloud storage or in-memory cache, all callers must change. The synchronous filesystem I/O also blocks the event loop during prompt assembly. Violates the plugin rule: memory access should be abstracted.

**Recommendation:** 
Create a `TaskMemoryAdapter` interface with `readPriorProgress(taskId: string): Promise<string>` (async to support remote stores). Inject into `assembleRunContext` deps. Move filesystem logic into a concrete `FileSystemTaskMemoryAdapter`. This allows memory sources to vary (cache, S3, in-memory) without touching orchestration.

**Effort:** M  
**Confidence:** High

---

## Summary

| Severity | Count | Rule Type | Recommendation Priority |
|----------|-------|-----------|------------------------|
| Critical | 3 | Plugin Rule (Direct I/O imports) | P0 — Extract abstractions for fs, db, memory |
| Critical | 1 | Dependency Rule (Inversion) | P0 — Move UI metadata to shared |
| High | 1 | Plugin Rule (Sync I/O in hot path) | P1 — Async memory abstraction |

### Priority Actions

1. **P0-1:** Move `STATUS_METADATA` and `BucketKey` from `src/renderer/src/lib/task-status-ui` to `src/shared/ui-metadata.ts`
2. **P0-2:** Extract `TurnTrackerDeps` with injected `insertAgentRunTurn` callback
3. **P0-3:** Create `WorktreePathValidator` abstraction, inject into `resolveSuccess`
4. **P0-4:** Add optional `updateAgentRunMetrics` callback to `RunAgentDeps`
5. **P1-1:** Create `TaskMemoryAdapter` interface, move `readPriorScratchpad` to concrete adapter

### Non-Violations (Correct Architecture)

✓ `src/shared/` has no imports from `src/main/` or `src/renderer/`  
✓ `src/renderer/` has no imports from `src/main/`  
✓ `git-operations.ts` and `worktree.ts` are correct abstraction layers  
✓ `dependency-service.ts` properly depends on shared types only  
✓ No circular imports detected between major boundaries  
✓ `task-terminal-service.ts` correctly abstracts dependency resolution  

---

**Audit Date:** 2026-04-13  
**Audit Scope:** Dependency rules only (not SOLID, not abstracts, not IPC width)  
**Confidence Level:** High (based on direct code inspection)
