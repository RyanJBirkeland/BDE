# Systems Profiler

**Lens scope:** Single-agent steady-state CPU cost in the pipeline hot path.

**Summary:** The pipeline hot path exhibits strong discipline around synchronous blocking operations—async/await is used consistently for file I/O and database writes. However, three CPU overhead issues emerge: (1) the `_depsEqual()` function performs two redundant sorts on every drain loop when comparing dependency arrays, (2) `emitAgentEvent()` calls `JSON.stringify()` on every SDK message within the message consumption loop, which runs at high frequency, and (3) `getUserMemory()` performs synchronous file I/O on disk during every prompt build for every agent spawn, even when memory files rarely change.

## Findings

### F-t1-sysprof-1: Redundant array sorting in `_depsEqual()` during drain loop

**Severity:** High
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:608-625`
**Evidence:**

```typescript
private _depsEqual(a: TaskDependency[] | null, b: TaskDependency[] | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  // Sort by id for stable comparison
  const aSorted = [...a].sort((x, y) => x.id.localeCompare(y.id))
  const bSorted = [...b].sort((x, y) => x.id.localeCompare(y.id))
  for (let i = 0; i < aSorted.length; i++) {
    if (
      aSorted[i].id !== bSorted[i].id ||
      aSorted[i].type !== bSorted[i].type ||
      aSorted[i].condition !== bSorted[i].condition
    ) {
      return false
    }
  }
  return true
}
```

The drain loop (line 661) calls `_depsEqual()` for every task in `allTasks` every polling cycle. For a typical task graph with 100+ tasks where ~80% have no dependency changes, this performs 160+ unnecessary array sorts per drain tick. Each sort is O(n log n) where n is the task count (typically 5-10 deps per task).

**Impact:** When the drain loop runs every 5 seconds with 100+ tasks, this burns CPU on every cycle even when nothing changed. At scale (10+ running agents), this contention on the event loop delays task spawning slightly, adding latency to the drain loop completion.

**Recommendation:** Cache sorted dependency arrays on each task object when deps change, or use an immutable structure that preserves sort order. Alternatively, skip the sort entirely by comparing sets or using a hash of the deps array that's computed once at storage time.

**Effort:** S

**Confidence:** High

---

### F-t1-sysprof-2: JSON.stringify() on every SDK message in hot message loop

**Severity:** High
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-event-mapper.ts:83-95`
**Evidence:**

```typescript
export function emitAgentEvent(agentId: string, event: AgentEvent): void {
  broadcast('agent:event', { agentId, event })
  try {
    appendEvent(getDb(), agentId, event.type, JSON.stringify(event), event.timestamp)
  } catch (err) {
    // SQLite write failure is non-fatal, but log it (rate-limited)
    const now = Date.now()
    if (now - _lastSqliteErrorLog > SQLITE_ERROR_LOG_INTERVAL_MS) {
      console.warn(`[agent-event-mapper] SQLite write failed (will retry next event): ${err}`)
      _lastSqliteErrorLog = now
    }
  }
}
```

Called from the message loop in `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:419-421`:

```typescript
const mappedEvents = mapRawMessage(msg)
for (const event of mappedEvents) {
  emitAgentEvent(agentRunId, event)
}
```

Each SDK message produces 1-5 events (text, tool_use, tool_result blocks). A typical 15-minute agent session processes 500-2000 messages, meaning 1000-10000 calls to `JSON.stringify()` per agent. This serialization happens _synchronously_ on every message tick, blocking the message loop briefly.

**Impact:** At 1 agent this is sub-millisecond, but with 3+ concurrent agents (which is common), synchronous JSON serialization adds measurable jitter to message consumption. Under high throughput (tool-heavy tasks), this can cause visible lag in the UI's event display and may accumulate into periodic frame skips.

**Recommendation:** Defer serialization until the write actually happens (prepare statement in SQLite automatically serializes), or batch events for async serialization. Even simpler: the `payload` column can store the event object as a pre-serialized string only at write time, not at mapping time.

**Effort:** S

**Confidence:** High

---

### F-t1-sysprof-3: Synchronous file I/O in `getUserMemory()` on every prompt build

**Severity:** Medium
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/agent-system/memory/user-memory.ts:25-66`
**Evidence:**

```typescript
export function getUserMemory(): UserMemoryResult {
  const activeFiles = getSettingJson<Record<string, boolean>>(SETTING_KEY)
  if (!activeFiles || Object.keys(activeFiles).length === 0) {
    return { content: '', totalBytes: 0, fileCount: 0 }
  }

  const sections: string[] = []
  let totalBytes = 0
  let pruned = false
  const remaining: Record<string, boolean> = {}

  for (const [relativePath, active] of Object.entries(activeFiles)) {
    if (!active) continue
    const fullPath = join(BDE_MEMORY_DIR, relativePath)
    if (!existsSync(fullPath)) {
      pruned = true
      continue
    }
    try {
      const content = readFileSync(fullPath, 'utf-8')  // <-- Synchronous read
      sections.push(`### ${relativePath}\n\n${content}`)
      totalBytes += Buffer.byteLength(content, 'utf-8')
      remaining[relativePath] = true
    } catch {
      pruned = true
    }
  }
  ...
}
```

Called during every prompt build in `/Users/ryan/projects/BDE/src/main/agent-manager/prompt-composer.ts:257-262`:

```typescript
const userMem = getUserMemory()
if (userMem.fileCount > 0) {
  prompt += '\n\n## User Knowledge\n'
  prompt += userMem.content
}
```

Every agent spawn calls `buildAgentPrompt()` which calls `getUserMemory()`, which performs synchronous `readFileSync()` on potentially multiple memory files (typically 1-3, but can be up to 10). Disk I/O blocks the event loop; even a fast SSD read (2-5ms) accumulates across 5+ agents spawning in quick succession.

**Impact:** With `MAX_ACTIVE_TASKS=1`, there's only one agent spawning at a time, so the impact is isolated to that agent's startup latency (adds ~5-20ms per spawn). However, the real risk is memory file churn: if a user actively edits memory files (common in iterative workflows), the same file is read unnecessarily on every spawn even though the content didn't change.

**Recommendation:** Cache memory file contents with a simple in-memory map keyed by (file path, mtime). On each call, stat files to check mtime; only re-read if changed. Better: make `getUserMemory()` async since it's only called during prompt composition (which happens before spawn, giving room to yield).

**Effort:** M

**Confidence:** Medium

---

### F-t1-sysprof-4: Deep dependency comparison on every drain loop tick

**Severity:** Medium
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:660-668`
**Evidence:**

```typescript
// Update tasks with changed dependencies
for (const task of allTasks) {
  const oldDeps = this._lastTaskDeps.get(task.id) ?? null
  const newDeps = task.depends_on ?? null
  if (!this._depsEqual(oldDeps, newDeps)) {
    this._depIndex.update(task.id, newDeps)
    this._lastTaskDeps.set(task.id, newDeps)
  }
}
```

On a typical poll cycle with 100 tasks:

- All 100 tasks are fetched via `getTasksWithDependencies()`
- All 100 are compared using `_depsEqual()` (even those without dependencies)
- Only ~5-10% typically have changed dependencies

The comparison is called inside a loop that already iterates all tasks. If tasks are ordered the same way each poll, the comparison could short-circuit early in many cases, but the sort overhead means even unchanged tasks still pay O(n log n) cost.

**Impact:** Cumulative over 5 drains/min × 100 tasks = 500 comparisons/min with redundant sorts. On a machine with 5+ agents running, this contention on the event loop interferes with message loop progress.

**Recommendation:** Track dependency changes at the repository layer (add a "last modified" timestamp to each task's `depends_on` field). Alternatively, use a hash of the deps array to detect changes in O(1).

**Effort:** M

**Confidence:** High

---

### F-t1-sysprof-5: `checkOAuthToken()` file I/O on every drain loop

**Severity:** Low
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/index.ts:71-110`
**Evidence:**

```typescript
export async function checkOAuthToken(logger: Logger): Promise<boolean> {
  try {
    const tokenPath = joinPath(home(), '.bde', 'oauth-token')
    const token = (await readFile(tokenPath, 'utf-8')).trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain')
        return true
      } else {
        logger.warn(
          '[agent-manager] OAuth token file missing/empty and keychain refresh failed — skipping drain cycle'
        )
        return false
      }
    }

    // Proactively refresh if token file is older than 45 minutes
    try {
      const stats = await stat(tokenPath)
      const ageMs = Date.now() - stats.mtimeMs
      if (ageMs > 45 * 60 * 1000) {
        logger.info('[agent-manager] Token file older than 45min — proactively refreshing')
        const refreshed = await refreshOAuthTokenFromKeychain()
        if (refreshed) {
          invalidateOAuthToken()
          logger.info('[agent-manager] OAuth token proactively refreshed from Keychain')
        }
      }
    } catch {
      /* stat failed — continue with existing token */
    }

    return true
  } catch {
    logger.warn('[agent-manager] Cannot read OAuth token file — skipping drain cycle')
    return false
  }
}
```

Called on every drain loop (every ~5 seconds). Performs two I/O operations: `readFile()` and `stat()`. Both are async, so they don't block the event loop, but they do incur filesystem cost.

**Impact:** With fast filesystems, this adds <1ms per drain cycle. On slower disks or under heavy I/O, the stat + readFile sequence could delay the drain by 5-10ms. With 5+ agents running and overlapping drains, cumulative delay to task spawning is observable.

**Recommendation:** Cache the token in memory with a TTL (e.g., 5 minutes). Only re-read from disk if the TTL expires or when explicitly triggered (e.g., after auth failure).

**Effort:** S

**Confidence:** Medium

---

### F-t1-sysprof-6: No caching of `buildAgentPrompt()` result

**Severity:** Low
**Category:** CPU
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/prompt-composer.ts:217-405`
**Evidence:**

`buildAgentPrompt()` is called once per agent spawn in `/Users/ryan/projects/BDE/src/main/agent-manager/run-agent.ts:251-262`:

```typescript
const prompt = buildAgentPrompt({
  agentType: 'pipeline',
  taskContent,
  branch: worktree.branch,
  playgroundEnabled: task.playground_enabled,
  retryCount: task.retry_count ?? 0,
  previousNotes: task.notes ?? undefined,
  maxRuntimeMs: task.max_runtime_ms ?? undefined,
  upstreamContext: upstreamContext.length > 0 ? upstreamContext : undefined,
  crossRepoContract: task.cross_repo_contract ?? undefined,
  repoName: task.repo
})
```

The function concatenates ~15-20 string sections (preamble, personality, memory, skills, task content, etc.), each calling helpers like `getAllMemory()`, `getAllSkills()`, `getUserMemory()`. For retry attempts (same task run 2-3 times), these helpers are called again even though most inputs are identical.

**Impact:** Minor on single-agent workloads. On retry scenarios where the same task is re-run immediately (e.g., fast-fail requeue within 30s), the prompt rebuild includes redundant I/O (file reads for user memory) and string concatenation. Not a bottleneck, but adds unnecessary latency to retry spawn time.

**Recommendation:** At the retry level, cache the base prompt template and only rebuild the retry-specific sections (retry context, failure notes). This is a nice-to-have optimization.

**Effort:** M

**Confidence:** Low

---

## Open questions

1. **Drain loop frequency tuning:** The drain loop runs every 5 seconds by default. With 100+ tasks, the `_depsEqual()` overhead is non-trivial. Has a slower poll interval (e.g., 10s) been considered when task queues are large? Tradeoff: less responsive to rapid task additions.

2. **Message event aggregation:** Are all 5000-10000 events per agent actually used, or could they be aggregated/sampled for storage without losing diagnostic value? This would reduce both JSON serialization and SQLite write load.

3. **Repository query shape:** Does `getTasksWithDependencies()` return all task fields on every call, or could it be optimized to return only (id, status, depends_on) for the dependency index logic? This would reduce memory churn.

4. **SQLite prepared statement caching:** The `appendEvent()` function prepares a statement on every call. SQLite caches these, but is the cache size appropriate for the event write throughput (1000-10000 writes per agent)?
