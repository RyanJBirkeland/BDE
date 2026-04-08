# Data Modeling Critic

**Lens scope:** Schema choices, write amplification, audit-trail bloat, dark write paths.

**Summary:** BDE exhibits significant write amplification in the task audit trail (task_changes), with 40 rows recorded per task update on average and a single status transition (~active→queued) generating over 5,500 changes. The agent_events table grows unbounded with no database-level cap and relies entirely on client-side truncation (2,000 events/agent) that can be lost on refresh. The cost_events table is defined but never written to (dark path), and the dependencies JSON blob (depends_on) should be a relational table given the 106 tasks with dependencies. The file watcher debounces all changes at 500ms without distinguishing between high-frequency external writes and user actions, creating potential for missed updates under burst write conditions.

## Findings

## F-t3-model-1: Explosive Write Amplification in task_changes Audit Trail
**Severity:** High
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:335-409` (updateTask) + `/Users/ryan/projects/BDE/src/main/data/task-changes.ts:19-53` (recordTaskChanges)
**Evidence:** 
- Snapshot shows 20,044 task_changes rows from 525 tasks = 38 rows/task average
- Field-level audit records EVERY field in the patch, even if unchanged. Example: updateTask calls recordTaskChanges with the full oldTask, then iterates all fields in auditPatch (lines 387-393)
- Status changes account for 6,577/20,044 (32.8%) of all changes; claimed_by 6,253 (31.2%); agent_run_id 5,923 (29.6%)
- One recurring transition dominates: active→queued appears 5,584 times (nearly 1/3 of all status changes)
- Each task update with N fields writes N rows to task_changes plus 1 row to sprint_tasks (write amplification ≈ N+1)
**Impact:** 
- A single updateTask call with 3 fields changed = 3 task_changes inserts + 1 update to sprint_tasks
- Over 525 tasks, this creates 20k+ rows for what could be tracked with a simple mutation counter
- Pruning at 30 days (line 173 in index.ts) means audit trail grows ~667 rows/day in steady state, but this doesn't prevent bloat in active sprints
**Recommendation:** 
1. Implement audit-trail filtering: recordTaskChanges should skip recording unchanged fields (compare oldValue == newValue before insert)
2. Consider a mutation journal table instead: record only task_id, timestamp, mutation_type ('update'|'delete'), and a single payload blob, reducing cardinality
3. Alternative: implement time-series bucketing (1 record per task per hour) for trending without per-field granularity
**Effort:** M
**Confidence:** High

---

## F-t3-model-2: Uncapped agent_events Growth Relies on Fragile Client-Side Eviction
**Severity:** High
**Category:** I/O | Memory
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/stores/agentEvents.ts:4,34-43` (MAX_EVENTS_PER_AGENT=2000) vs `/Users/ryan/projects/BDE/src/main/data/event-queries.ts` (pruneOldEvents)
**Evidence:**
- Snapshot: 31,490 agent_events rows from 500 agent_runs = 63 rows/agent_run average
- 500 agents × 2,000 cap = 1M events max in memory if all agents loaded
- Zustand store truncates at 2,000 per agent (line 38), but this only protects renderer memory, not database
- Database has no automatic cap—only manual pruning at 24h intervals (line 159-168 in index.ts) via pruneOldEvents(db, getEventRetentionDays())
- If user never opens a renderer window, events accumulate unbounded in DB; if they refresh the tab mid-session, evicted events are lost (client silently drops history beyond 2k)
- No composite index on (agent_id, timestamp) to accelerate large result sets
**Impact:**
- Active agent running for 1 week logs ~9,100 events (at 63 events/agent_run rate); client shows only 2,000 most recent
- DB continues storing all 9,100 (no trigger-based cap)
- Refresh loss: Zustand store evicts, but database still has rows; user cannot recover history
**Recommendation:**
1. Add database-level trigger or periodic job to cap agent_events per agent_id: `DELETE FROM agent_events WHERE (agent_id, id) NOT IN (SELECT agent_id, id FROM agent_events ORDER BY timestamp DESC LIMIT 2000 BY agent_id)`
2. Alternatively, implement event-level retention policy in migration (e.g., keep only 7 days of events, prune older on write)
3. Make client-side cap durable: on overflow, persist the evicted flag to DB so refresh can notify user of lost history
**Effort:** M
**Confidence:** High

---

## F-t3-model-3: cost_events Table is a Dark Write Path
**Severity:** Medium
**Category:** I/O | Scaling
**Location:** `/Users/ryan/projects/BDE/src/main/db.ts:migration version 4` (table definition) vs codebase (zero writes)
**Evidence:**
- Schema defined (migration v4, db.ts line ~95-100): cost_events table with columns id, source, session_key, model, total_tokens, cost_usd, recorded_at
- Snapshot shows 0 rows in cost_events despite 20k+ changes and 500 agent runs
- Grep of entire codebase returns only test references and table definition—no INSERT statements anywhere in production code
- This indicates the table was planned for cost tracking but the write path was never implemented
**Impact:**
- Dead schema consuming disk space (minimal at 0 rows, but represents unfinished feature debt)
- If cost tracking is needed later, the table exists but queries will return empty, creating silent bugs
- Forces migrations to carry unused table schema
**Recommendation:**
1. If cost tracking is not in scope: drop cost_events table in a new migration to clean up schema debt
2. If cost tracking is planned: implement the write path immediately (likely in agent handlers or cost-handler hooks) with a corresponding feature flag or deprecation timeline
3. Add a comment to handlers documenting why cost tracking is not implemented (e.g., "awaiting token accounting design")
**Effort:** S
**Confidence:** High

---

## F-t3-model-4: depends_on JSON Blob Should Be Relational for Efficient Querying
**Severity:** Medium
**Category:** I/O | Scaling
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:139-145` (sanitizeDependsOn serialization) + `/Users/ryan/projects/BDE/src/main/db.ts:migration v15` (depends_on TEXT column)
**Evidence:**
- 106/525 tasks (20.2%) have depends_on set (snapshot query)
- depends_on stored as JSON string in TEXT column: `[{"id":"task-X","type":"hard"}]` format (inferred from sanitizeDependsOn function)
- Example query paths:
  - `detectCycle()` in sprint-local.ts:284 loads ALL tasks, deserializes depends_on for each, walks the graph in application code
  - Dependency validation in sprint-local.ts:169-179 parses task.depends_on and compares with oldTask.depends_on (string comparison)
- No index on depends_on; filtering requires full table scan and JSON deserialization
- Write amplification: updating a task's depends_on field triggers one task_changes audit row PLUS inline JSON serialization for comparison (lines 138-140 in sprint-queries.ts)
**Impact:**
- Cycle detection is O(N) in-process instead of O(E) with a relational edges table
- Listing tasks with dependencies requires deserializing 525 tasks even if only 106 have deps
- Changing a dependency adds the full JSON blob (potentially 100+ bytes) to task_changes audit trail
**Recommendation:**
1. Create task_dependencies table: (id, from_task_id, to_task_id, dependency_type TEXT CHECK('hard'|'soft'))
2. Migrate existing depends_on JSON to relational rows in a new migration
3. Update detectCycle and dependency validators to query the edges table instead of in-process parsing
4. Add index on (from_task_id, to_task_id) for fast lookups and uniqueness constraints
5. Keep depends_on view in sprint_tasks for backward compatibility (computed from relationships) or deprecate it
**Effort:** L
**Confidence:** Medium

---

## F-t3-model-5: File Watcher Debounce Treats All Changes Equally; No Burst Optimization
**Severity:** Medium
**Category:** I/O
**Location:** `/Users/ryan/projects/BDE/src/main/bootstrap.ts:8-37` (startDbWatcher)
**Evidence:**
- Static DEBOUNCE_MS = 500 (line 8) applies to both database.db and database.db-wal changes
- Watcher watches both dbPath and walPath; any change fires notify(), which restarts the 500ms debounce timer (line 16)
- Under rapid writes (e.g., batch task status updates), each WAL write resets the timer, delaying the sprint:externalChange broadcast until the update burst ends
- No distinction between:
  - External changes (need debounce to coalesce multiple external writes)
  - Own writes (could skip debounce since we already know the new state)
**Impact:**
- If external writer (e.g., sync service) writes 10 batches in 2 seconds, the debounce coalesces them into one notification after 2.5 seconds (burst end + 500ms)
- If own code writes then reads (e.g., updateTask → getTask), the 500ms debounce may cause a stale render if the notification is delayed
- No mechanism to distinguish between internal and external writes
**Recommendation:**
1. Add a write state tracker (e.g., lastOwnWriteTime) that skips debounce for reads within 100ms of own writes
2. Or: implement a "high-frequency" fast path: if more than 5 WAL changes in <100ms, fire notification immediately instead of waiting for quiet period
3. Consider watching only dbPath changes (not WAL), since WAL is an implementation detail of SQLite and coalesced writes will be reflected in db snapshots
**Effort:** M
**Confidence:** Medium

---

## F-t3-model-6: Oversized Spec Column Suggests Denormalization; Should Be Externalized
**Severity:** Low
**Category:** I/O | Memory
**Location:** `/Users/ryan/projects/BDE/src/main/db.ts:migration v15` (spec TEXT column in sprint_tasks)
**Evidence:**
- Snapshot: 510/525 tasks have spec set
- Average spec length: 3,224 bytes; max: 65,882 bytes
- Total spec bytes in sprint_tasks: ~1.6 MB (for 525 tasks)
- Full select of sprint_tasks (used by listTasks, listTasksRecent) includes spec in SELECT * or explicit column lists, pulling all specs into memory even when not needed (e.g., queue stats query only needs id/status but still loads spec)
- Example: listTasksRecent() (line 216) selects * and pulls ~1.6 MB of spec data for a UI that may only show titles
**Impact:**
- Memory footprint of listTasks: ~1.6 MB spec data loaded per call, even for lightweight operations
- Network latency on large result sets (if running on a separate DB server)
- Write amplification: updating spec triggers one task_changes audit row with the full old and new spec (potentially 6KB+ per field change)
**Recommendation:**
1. Keep spec in sprint_tasks for now (common queries need it), but create targeted column lists for read paths that don't need spec
2. Example: `SELECT id, title, repo, status, priority, created_at FROM sprint_tasks WHERE status = ?` for UI queries that don't show spec
3. Monitor memory usage in listTasks; if > 5 MB total, consider moving spec to a separate specs table with lazy loading
**Effort:** S
**Confidence:** Low

---

## F-t3-model-7: Multiple JSON Blobs (revision_feedback, retry_context, partial_diff) Without Cardinality Limits
**Severity:** Low
**Category:** Scaling
**Location:** `/Users/ryan/projects/BDE/src/main/db.ts:migrations v24, v34` (retry_context TEXT, partial_diff TEXT, revision_feedback TEXT)
**Evidence:**
- Snapshot shows 0 rows with partial_diff set; 0 rows with revision_feedback set (query returned empty)
- retry_context not queried in snapshot, but defined as nullable TEXT
- These columns accumulate JSON data without schema validation or limits
- Example: revision_feedback is parsed in sprint-queries.ts line 33-41, but no size limits enforced at insert time
**Impact:**
- If revision_feedback grows to 100+ KB per task, listTasks becomes expensive again
- No migration path if these JSONs need to become relational (e.g., revision_feedback as a separate revisions table)
**Recommendation:**
1. Add runtime validation in serializeField() to enforce JSON blob size limits (e.g., 64 KB max for revision_feedback, 10 KB for retry_context)
2. Document the intended structure of these blobs in migration comments or a schema.md file
3. If these become heavily used, plan for relational splits (e.g., task_revisions table)
**Effort:** S
**Confidence:** Low

---

## Open Questions

1. **Audit Trail Granularity:** Is field-level change tracking (38 rows/task) necessary, or would a coarser mutation log (1 row/update) suffice? This would reduce write amplification by 10-30x.

2. **Agent Events Retention:** What is the retention SLA for agent_events? If it's "last 7 days," implementing a database-level cap would prevent unbounded growth and simplify the client-side logic.

3. **Dependencies Cardinality:** How deep are task dependency graphs? If max depth is <5 and cycles are rare, the in-process detectCycle() is acceptable; if depth >10, relational storage would improve performance and enable better pruning strategies.

4. **Spec Field Usage:** Is spec always needed in list queries, or can it be lazy-loaded? Splitting it would reduce memory overhead by ~3 MB per listTasks call.

5. **Cost Tracking Design:** Is cost_events intended to track token costs per agent run, or per session? Implementation should be clarified before adding the write path.

