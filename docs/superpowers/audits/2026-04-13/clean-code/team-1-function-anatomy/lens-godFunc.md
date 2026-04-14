# God Function Audit — Team-1 Function Anatomy
**Date:** 2026-04-13  
**Auditor:** Claude Code (Haiku 4.5)  
**Scope:** Backend agent manager, sprint handlers, completion, worktree setup  
**Focus:** Functions doing too many things, violating SRP, operating at mixed abstraction levels

---

## F-t1-godFunc-1: resolveSuccess — Multi-Phase Orchestration with Mixed Concerns
**Severity:** High  
**Category:** God Function | Mixed Abstraction Levels | SRP Violation  
**Location:** `src/main/agent-manager/completion.ts:349–454`  
**Evidence:**
```typescript
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  // 0. Guard: worktree path existence check
  // 1. Detect current branch (git operation)
  // 2. Auto-commit uncommitted changes (git + high-level merge logic)
  // 3. Rebase onto origin/main (complex git operation with conflict handling)
  // 4. Check commits ahead of main (low-level git query)
  // 5. Transition to review (task DB update)
  // 6. Evaluate auto-review rules & conditionally merge (business logic + git operation)
```

**Impact:**  
- Contains 5+ distinct responsibilities: file validation, branch detection, auto-commit, rebase-with-conflict handling, commit verification, review transition, auto-merge evaluation
- Changes needed to any ONE piece (e.g., rebase strategy, auto-merge rules, or commit detection) require touching this entire 100+ line function
- Difficult to unit test in isolation—each change pathway tests multiple unrelated operations together
- Mixing low-level git operations (execFile, git commands) with high-level business logic (retry logic, task DB updates)

**Recommendation:**  
Extract sub-functions:
1. **`validateWorktreeExists()`** — Guard check (worktree path validation)
2. **`detectAndValidateBranch()`** — Branch detection + empty name check
3. **`prepareCommits()`** — Auto-commit + rebase, returns { success, notes, baseSha }
4. **`verifyCommitsExist()`** — Check commits ahead of main, handles retry logic
5. **`transitionAndAutoMerge()`** — Review transition + auto-merge evaluation

Then `resolveSuccess` becomes a clean orchestrator that calls these in sequence, handling the guard checks at each step.

**Effort:** M  
**Confidence:** High

---

## F-t1-godFunc-2: finalizeAgentRun — Post-Agent Lifecycle with 4+ Distinct Paths
**Severity:** High  
**Category:** God Function | Mixed Abstraction Levels | SRP Violation  
**Location:** `src/main/agent-manager/run-agent.ts:482–635`  
**Evidence:**
```typescript
async function finalizeAgentRun(
  task, worktree, repoPath, agent, agentRunId, turnTracker, exitCode, lastAgentOutput, deps
): Promise<void> {
  // 1. Emit completion event (telemetry)
  // 2. Check if watchdog already cleaned (idempotency guard)
  // 3. Update agent run record (SQLite)
  // 4. Persist cost breakdown (cost analytics)
  // 5. Classify exit code (fast-fail logic)
  // 6. Handle fast-fail-exhausted case (task update + terminal callback)
  // 7. Handle fast-fail-requeue case (task update with backoff)
  // 8. Handle normal exit → resolveSuccess (business logic delegation)
  // 9. Remove from active map (cleanup)
  // 10. Conditionally clean up worktree OR preserve for review (cleanup with branching logic)
```

**Impact:**  
- 10+ distinct operations across 150+ lines
- Three separate terminal-state handlers (fast-fail-exhausted, fast-fail-requeue, normal exit) with duplicate try-catch patterns
- Mixing telemetry (emit event), DB updates (SQLite), business logic (exit classification), and file operations (worktree cleanup)
- Hard to test individual paths; most test cases need to set up all the preconditions even though they only care about one branch

**Recommendation:**  
Extract sub-functions:
1. **`emitCompletionEvent()`** — Single responsibility: emit telemetry
2. **`updateAgentMetrics()`** — Update agent run record + cost breakdown
3. **`classifyAndHandleExit()`** — Returns { shouldNotify, status, taskUpdate } based on exit code
4. **`handleFastFailExhausted()`** — Emit exhausted state error message + task update
5. **`handleFastFailRequeue()`** — Queue retry with backoff
6. **`handleNormalExit()`** — Delegate to resolveSuccess
7. **`finalizeWorktree()`** — Clean up or preserve based on task status

Then `finalizeAgentRun` orchestrates these cleanly with the watchdog guard check at the top.

**Effort:** M  
**Confidence:** High

---

## F-t1-godFunc-3: setupWorktree — Disk, Lock, and Git Operations Mixed
**Severity:** High  
**Category:** God Function | Mixed Abstraction Levels | SRP Violation  
**Location:** `src/main/agent-manager/worktree.ts:141–219`  
**Evidence:**
```typescript
export async function setupWorktree(
  opts: SetupWorktreeOpts & { logger?: Logger }
): Promise<SetupWorktreeResult> {
  // 1. Create repo directory (filesystem)
  // 2. Validate repo path (filesystem check)
  // 3. Pre-check disk space (system resource query + calculation)
  // 4. Reserve disk (resource accounting)
  // 5. Fetch latest main (git network operation)
  // 6. Acquire per-repo lock (concurrency control)
  // 7. Cleanup stale worktrees (complex git + filesystem cleanup)
  // 8. Fast-forward merge (git operation)
  // 9. Create fresh worktree (git operation)
  // 10. Release lock (concurrency control)
  // 11. Release disk reservation (resource accounting cleanup)
}
```

**Impact:**  
- 11 distinct concerns: filesystem I/O, validation, resource management, concurrency control, network operations, cleanup
- Three separate try-catch blocks with different cleanup semantics (one with git-specific fallback logic)
- Difficult to debug—when setup fails, unclear if issue is disk space, lock contention, git error, or filesystem
- Operating at multiple abstraction levels simultaneously: system resources, concurrency, git protocol, filesystem

**Recommendation:**  
Extract sub-functions:
1. **`ensureRepoDirectoryExists()`** — Create repo dir + validate path existence
2. **`checkAndReserveDiskSpace()`** — Query pending reservations + ensure headroom
3. **`fetchLatestMain()`** — Fetch origin/main with timeout + error handling (non-fatal)
4. **`cleanupStaleState()`** — Extract the existing cleanupStaleWorktrees call into worktree setup context
5. **`fastForwardLocal()`** — ff-merge local main (non-fatal on failure)
6. **`createFreshWorktree()`** — Add worktree + branch in one atomic step

Separate concerns:
- **Lock management** — Pass `acquireLock` / `releaseLock` as callbacks, not inline
- **Disk tracking** — Move `reserveDisk` / `releaseDisk` into a resource-scope wrapper or context manager

Then `setupWorktree` becomes: validate → reserve → fetch → lock → cleanup/ff/create → unlock → release.

**Effort:** M  
**Confidence:** High

---

## F-t1-godFunc-4: _processQueuedTask — Repo Path Resolution + Dependency Checking + Task Claiming + Worktree Setup
**Severity:** High  
**Category:** God Function | SRP Violation | Too Many Parameters (8+ effective)  
**Location:** `src/main/agent-manager/index.ts:348–437`  
**Evidence:**
```typescript
async _processQueuedTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<void> {
  // 1. Map raw task + skip invalid tasks
  // 2. Check & block dependencies (uses _depIndex, taskStatusMap)
  // 3. Resolve repo path (lookup in config)
  // 4. Guard: repo path exists check + error handling
  // 5. Claim task (repo mutation)
  // 6. Refresh task status map (repo query)
  // 7. Setup worktree (async file/git operations) 
  // 8. Handle worktree error (update task + onTerminal callback)
  // 9. Spawn agent (delegate to _spawnAgent)
}
```

**Impact:**  
- 9 distinct phases with heavy error handling at each phase
- Operates at multiple abstraction levels: task data mapping, dependency graph operations, path resolution, file operations, agent spawning
- 4 consecutive repo.updateTask calls with different error messages
- Each phase has its own error recovery → onTaskTerminal callback duplication
- Testing requires mocking repo, depIndex, file system, and task spawning together

**Recommendation:**  
Extract sub-functions:
1. **`mapAndValidateQueuedTask()`** — Validate raw task, return typed task or null
2. **`checkTaskDependencies()`** — Query depIndex, return { blocked: bool, reason?: string }
3. **`resolveRepoPathOrFail()`** — Lookup repo → on fail, update task + onTerminal, throw
4. **`claimTaskOrSkip()`** — Attempt claim → if already claimed, log + return false
5. **`setupWorktreeOrFail()`** — Call setupWorktree → on fail, update task + onTerminal, throw

Then orchestrate:
```typescript
async _processQueuedTask(raw, taskStatusMap) {
  const task = mapAndValidateQueuedTask(raw, this.logger)
  if (!task) return
  
  if (await checkTaskDependencies(task.id, taskStatusMap, ...)) return
  
  const repoPath = this.resolveRepoPath(task.repo)
  if (!repoPath) { /* error handling */, return }
  
  if (!this.claimTask(task.id)) return
  
  const wt = await setupWorktreeOrFail(...)
  this._spawnAgent(task, wt, repoPath)
}
```

**Effort:** M  
**Confidence:** High

---

## F-t1-godFunc-5: buildAgentPrompt (via dispatcher pattern) — 5 Agent Types with Duplicated Context Building
**Severity:** Medium  
**Category:** Mixed Abstraction Levels | Code Duplication | SRP Boundary Issue  
**Location:** `src/main/agent-manager/prompt-composer.ts:650–682`  
**Evidence:**
```typescript
export function buildAgentPrompt(input: BuildPromptInput): string {
  // Router to 5 different builders
  switch(agentType) {
    case 'pipeline': return buildPipelinePrompt(input)
    case 'assistant'/'adhoc': return buildAssistantPrompt(input)
    case 'copilot': return buildCopilotPrompt(input)
    case 'synthesizer': return buildSynthesizerPrompt(input)
    case 'reviewer': return buildReviewerPrompt(input)
  }
}
```

**Sub-function: buildPipelinePrompt (423 lines)**  
- Preamble + personality + memory + skills + branch + playground + scratchpad + output cap + task spec + upstream context + retry context + self-review + operational sections + time limit
- 12+ distinct sections concatenated together
- Hard to reorder or swap sections; each builder is monolithic

**Sub-function: buildAssistantPrompt**  
- Nearly identical to pipeline but missing scratchpad; duplicates memory + skills + personality loading
- Duplicates buildUpstreamContextSection call

**Impact:**  
- Prompt composition is scattered across 5 large functions (300–423 lines each for pipeline/assistant)
- Context building (memory, skills, personality) duplicated across pipeline, assistant, synthesizer
- Hard to add cross-cutting concerns (e.g., a new compliance banner) without touching all 5 builders
- buildPipelinePrompt does too much; should delegate section building to smaller, composable functions

**Recommendation:**  
Instead of monolithic builders, use a **builder pattern with composable section objects**:
1. Extract **personality section building** → Reusable for all agents
2. Extract **memory injection** → Reusable for pipeline, assistant, synthesizer  
3. Extract **skills injection** → Reusable for coding agents
4. Extract **upstream context** → Already extracted well, reuse across all
5. **Compose via array of section builders** instead of string concatenation in if-chains

```typescript
function buildAgentPrompt(input: BuildPromptInput): string {
  const sections = [
    getPreamble(input.agentType),
    getPersonalitySection(input.agentType),
    ...(shouldInjectMemory(input.agentType) ? [getMemorySection(input)] : []),
    ...(shouldInjectSkills(input.agentType) ? [getSkillsSection()] : []),
    ...(input.branch ? [getBranchSection(input.branch)] : []),
    ...(input.upstreamContext ? [getUpstreamSection(input.upstreamContext)] : []),
    // Agent-type-specific sections last
    ...getAgentSpecificSections(input)
  ]
  return sections.join('')
}
```

**Effort:** M  
**Confidence:** Medium

---

## F-t1-godFunc-6: onTaskTerminal (AgentManager) — Dependency Resolution + Metrics + Callbacks
**Severity:** Medium  
**Category:** SRP Violation | Mixed Abstraction Levels  
**Location:** `src/main/agent-manager/index.ts:265–320`  
**Evidence:**
```typescript
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  // 1. Idempotency guard (_terminalCalled set)
  // 2. Metrics increment (telemetry)
  // 3. Conditional callback (config.onStatusTerminal)
  // 4. OR inline dependency resolution:
  //    - Rebuild dep index
  //    - Call resolveDependents with 11 parameters
  //    - Handle errors
  // 5. Cleanup _terminalCalled after 5 seconds (timer management)
}
```

**Impact:**  
- Mixing idempotency guards, metrics, callbacks, dependency resolution, index rebuilding
- 11 arguments to `resolveDependents` call makes it hard to understand what's happening
- The fallback (inline resolution when no onStatusTerminal) creates two very different code paths
- Cleanup timer (5s) is a detail that could be forgotten when refactoring

**Recommendation:**  
Extract:
1. **`recordTerminalMetrics()`** — Increment the right counter based on status
2. **`resolveDependent()`** — Rebuild index + call resolveDependents, handle errors internally
3. **`scheduleTerminalCleanup()`** — Register idempotency for cleanup in 5s

Then:
```typescript
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  if (this._terminalCalled.has(taskId)) {
    this.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }
  this._terminalCalled.add(taskId)
  
  try {
    recordTerminalMetrics(status, this._metrics)
    
    if (this.config.onStatusTerminal) {
      this.config.onStatusTerminal(taskId, status)
    } else {
      await this.resolveDependent(taskId, status)
    }
  } catch (err) {
    this.logger.error(`[agent-manager] onTaskTerminal failed for ${taskId}: ${err}`)
  } finally {
    scheduleTerminalCleanup(taskId, this._terminalCalled, 5000)
  }
}
```

**Effort:** S  
**Confidence:** High

---

## F-t1-godFunc-7: poll (inside createSprintPrPoller) — Nested Duplication in Terminal Callbacks
**Severity:** Medium  
**Category:** SRP Violation | Code Duplication  
**Location:** `src/main/sprint-pr-poller.ts:50–116`  
**Evidence:**
```typescript
async function poll(): Promise<void> {
  const tasks = deps.listTasksWithOpenPrs()
  const results = await deps.pollPrStatuses(inputs)
  
  for (const result of results) {
    if (result.merged) {
      // Block 1: Mark done + call onTaskTerminal for each task
      const ids = deps.markTaskDoneByPrNumber(prNumber)
      for (const id of ids) {
        const promises = ids.map((id) => 
          Promise.resolve(deps.onTaskTerminal(id, 'done'))
        )
        const results = await Promise.allSettled(promises)
        // Error handling with failed array construction
      }
    } else if (result.state === 'CLOSED') {
      // Block 2: Mark cancelled + call onTaskTerminal for each task (IDENTICAL LOGIC)
      const ids = deps.markTaskCancelledByPrNumber(prNumber)
      for (const id of ids) {
        const promises = ids.map((id) =>
          Promise.resolve(deps.onTaskTerminal(id, 'cancelled'))
        )
        // SAME error handling, different status
      }
    }
  }
}
```

**Impact:**  
- The merged and closed branches have nearly identical logic (50+ chars diff)
- onTaskTerminal callback pattern repeats twice with different status strings
- Hard to maintain: fixing a bug in the callback logic means editing both blocks

**Recommendation:**  
Extract:
1. **`notifyTerminal()`** — Takes ids array + status, handles Promise.allSettled + error logging

```typescript
async function notifyTerminal(ids: string[], status: string, onTaskTerminal, log) {
  const promises = ids.map((id) => Promise.resolve(onTaskTerminal(id, status)))
  const results = await Promise.allSettled(promises)
  const failed = results
    .map((r, i) => r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null)
    .filter(Boolean)
  if (failed.length > 0) {
    log.warn(`[sprint-pr-poller] onTaskTerminal failed for ${status}: ${JSON.stringify(failed)}`)
  }
}
```

Then `poll` becomes:
```typescript
if (result.merged) {
  const ids = deps.markTaskDoneByPrNumber(prNumber)
  await notifyTerminal(ids, 'done', deps.onTaskTerminal, log)
} else if (result.state === 'CLOSED') {
  const ids = deps.markTaskCancelledByPrNumber(prNumber)
  await notifyTerminal(ids, 'cancelled', deps.onTaskTerminal, log)
}
```

**Effort:** S  
**Confidence:** High

---

## F-t1-godFunc-8: sprint:batchUpdate handler — Update Filtering + Validation + Batch Processing
**Severity:** Medium  
**Category:** SRP Violation | Mixed Abstraction Levels  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:22–115`  
**Evidence:**
```typescript
safeHandle('sprint:batchUpdate', async (_e, operations) => {
  // 1. Pre-process: import GENERAL_PATCH_FIELDS dynamically
  // 2. For each operation:
  //    a. Validate op structure
  //    b. If update: filter patch fields + validate spec quality
  //    c. Call updateTask + check for terminal status
  //    d. Build result object
  //    e. If delete: call deleteTask + build result
  // 3. Return aggregated results
}
```

**Impact:**  
- 80+ lines handling both update and delete with nested validation
- Spec quality validation happens inline with field filtering, making it hard to test the validation in isolation
- Filtering logic (GENERAL_PATCH_FIELDS) duplicated from sprint-local.ts
- Result object construction happens in 4 different places (update success, update error, delete success, delete error)

**Recommendation:**  
Extract:
1. **`validateOperation()`** — Check op structure, return { valid: bool, error?: string }
2. **`processUpdate()`** — Filter fields + validate spec → returns { ok, error?, result? }
3. **`processDelete()`** — Delete + return { ok, error? }
4. **`buildResult()`** — Consistent result object factory

Then:
```typescript
safeHandle('sprint:batchUpdate', async (_e, operations) => {
  const results = []
  for (const op of operations) {
    const validation = validateOperation(op)
    if (!validation.valid) {
      results.push({ id: op.id, op: op.op, ok: false, error: validation.error })
      continue
    }
    
    let outcome
    if (op.op === 'update') {
      outcome = await processUpdate(op.id, op.patch)
    } else {
      outcome = await processDelete(op.id)
    }
    results.push(buildResult(op.id, op.op, outcome))
  }
  return { results }
})
```

**Effort:** S  
**Confidence:** Medium

---

## Summary

**Total God Functions Found:** 8  
**Critical (Severity: High):** 4  
**Medium (Severity: Medium):** 4  

### Quick Wins (Effort: S)
- **F-t1-godFunc-6** (onTaskTerminal) — Extract metric recording + cleanup scheduling
- **F-t1-godFunc-7** (poll/createSprintPrPoller) — Extract notifyTerminal helper
- **F-t1-godFunc-8** (sprint:batchUpdate) — Extract validators + processors

### Impactful Mid-Size Refactors (Effort: M)
- **F-t1-godFunc-1** (resolveSuccess) — Extract commit preparation + transition + merge
- **F-t1-godFunc-2** (finalizeAgentRun) — Extract exit classification + handlers
- **F-t1-godFunc-3** (setupWorktree) — Extract lock/disk/git operations separately
- **F-t1-godFunc-4** (_processQueuedTask) — Extract validation, repo lookup, worktree setup as separate steps
- **F-t1-godFunc-5** (buildAgentPrompt / buildPipelinePrompt) — Refactor to composable section builders

### Common Patterns Found
1. **Nested error handling** — Multiple try-catch blocks with duplicate callbacks → Extract callback + error handling into helper
2. **Mixed abstraction levels** — High-level orchestration + low-level system I/O in same function → Separate concerns into sub-functions
3. **Duplication across similar paths** — resolveSuccess's success vs retry vs error cases; poll's merged vs closed → Extract common pattern
4. **Long parameter lists** → Some functions pass 8+ parameters because they're doing too much; smaller functions naturally have fewer deps
5. **String building via concatenation** — prompt-composer builds 1000+ char strings by appending sections → Use composable builders

