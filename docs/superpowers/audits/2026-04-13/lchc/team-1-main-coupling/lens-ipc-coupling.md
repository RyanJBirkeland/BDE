# IPC Boundary Audit: Main Process Coupling
**Date:** 2026-04-13  
**Audit Type:** lensed audit — IPC channel coupling analysis  
**Scope:** Renderer ↔ Main process IPC surface area  
**Tool:** IPC boundary auditor

---

## Executive Summary

The BDE Electron app defines **179 total IPC channels** (161 request/response + 18 broadcasts) organized across 9 domain-grouped modules. The organization is **sound by domain** — channels are well-categorized (sprint, git, review, etc.). However, there are **5 structural coupling issues** that create either redundant abstraction layers, fine-grained CRUD channels that could be consolidated, or bidirectional request/response loops that leak business logic into the renderer layer.

**Key findings:**
- **Sprint domain:** 20 fine-grained CRUD channels vs. 1 batch mutation channel — inconsistent abstraction levels
- **Review domain:** 15 channels with tight request→response→task-update loops (bidirectional entanglement)
- **Groups domain:** Epic dependency orchestration leaks into renderer via 13 channels with side-effect cascades
- **FS vs Memory:** Two parallel abstractions (14 fs + 6 memory channels) with no clear consumption pattern distinction
- **Workbench:** 7 streaming channels (checkSpec, generateSpec, chatStream, etc.) serving a single UI flow — potential single-request design

All findings are **non-blocking** (no immediate bugs), but they indicate where architectural debt is accumulating.

---

## Detailed Findings

## F-t1-ipc-1: Sprint Domain Has 20 Fine-Grained CRUD Channels — Unused Abstraction Levels
**Severity:** High  
**Category:** Channel Proliferation | Missing Abstraction  
**Location:** `src/shared/ipc-channels/sprint-channels.ts:21-144` (SprintChannels interface)  
**Evidence:**
```
sprint:list          (query all)
sprint:create        (single task)
sprint:update        (single mutation)
sprint:delete        (single mutation)
sprint:claimTask     (narrow action)
sprint:retry         (narrow action)
sprint:unblockTask   (narrow action)
sprint:batchUpdate   (multi-mutation — THE CONSOLIDATION CHANNEL)
sprint:batchImport   (multi-create)
sprint:readLog       (narrow query)
sprint:readSpecFile  (narrow query)
sprint:validateDependencies  (narrow validation)
sprint:generatePrompt         (narrow AI generation)
sprint:getChanges             (audit query)
sprint:failureBreakdown       (analytics query)
sprint:getSuccessRateBySpecType (analytics query)
sprint:healthCheck   (diagnostic)
sprint:exportTasks   (export)
sprint:exportTaskHistory (export)
sprint:createWorkflow (multi-create variant)
```

**Problem:** Most of these 20 channels are **single-task operations with immediate return values**. `sprint:batchUpdate` exists and works, but single mutations (create, update, delete, retry, claim) each have their own channel. This creates cognitive overhead: is this a mutation? Does it take batch args? Can I combine it? The renderer ends up calling multiple channels in sequence for single user actions.

**Impact:** 
- Renderer makes 3-5 IPC calls for operations that could be 1 (e.g., `create → claim → validate` is three roundtrips)
- Main process has 20 handler registrations for 4 underlying operations (CRUD + batch variants)
- No clear signal to new developers whether to add a new fine-grained channel or use batch

**Recommendation:**
1. Consolidate single-task create/update/delete into **domain event channels**: `sprint:mutate(operation: 'create'|'update'|'delete', payload)` → single channel for all mutations
2. Keep `batchUpdate` and `batchImport` as-is (multi-task optimization)
3. Move pure queries (`readLog`, `readSpecFile`, `getChanges`, `validateDependencies`) to a **shared `domain:query` pattern** or leave as specialized channels if they're truly distinct workflows
4. Deprecate single-operation channels in favor of mutation event channel over 2 sprint cycles

**Effort:** M  
**Confidence:** High

---

## F-t1-ipc-2: Review Domain Exhibits Tight Bidirectional Entanglement — Renderer Orchestrates State
**Severity:** High  
**Category:** Bidirectional Entanglement | Missing Abstraction  
**Location:** `src/renderer/src/hooks/useSingleTaskReviewActions.ts` and `src/main/handlers/review.ts`  
**Evidence:**

The review workflow calls review channels in a **request→handle→respond→renderer mutates task** pattern:

```
Renderer:
  1. window.api.review.shipIt({ taskId, strategy })  [WAIT]
     ↓
Main:
  2. Merge locally, push, transition task to done
     ↓
Renderer:
  3. Receives success → calls window.api.sprint.update(taskId, {...})
  
Renderer:
  1. window.api.review.requestRevision({ taskId, feedback })  [WAIT]
     ↓
Main:
  2. Creates revision request, queues task
     ↓
Renderer:
  3. window.api.sprint.update(taskId, { revision_feedback: [...] })
```

This is a **cross-domain orchestration loop**: review operations complete, but the renderer must follow up with sprint updates. The renderer is coordinating state transitions across two domains.

**15 review channels:**
```
review:getDiff, getCommits, getFileDiff    (queries)
review:mergeLocally, shipIt, rebase        (mutations)
review:createPr, requestRevision, discard  (mutations)
review:chatStream, chatAbort               (streaming)
review:generateSummary                     (AI generation)
review:checkAutoReview, checkFreshness     (checks)
review:autoReview                          (mutation w/ auto-decision)
```

Main process should atomically handle `review:shipIt` → task transition to done. But the renderer is expected to follow up with `sprint:update`. This leaks the state machine logic into the renderer.

**Impact:**
- If renderer crashes between review.shipIt and sprint.update, task is in an inconsistent state (done but not transitioned in renderer state)
- Any review operation requires renderer to know about sprint task fields (`revision_feedback`, status transitions, etc.)
- New review actions require coordination logic in both main and renderer

**Recommendation:**
1. **Main process owns review→sprint coordination:** `review:shipIt` should atomically handle the full transition (merge + push + task update). Return `{ success, taskUpdated: SprintTask }` so renderer receives the authoritative state in one response.
2. Fold `review:requestRevision` into a `sprint:updateStatus` call that main process executes, not renderer
3. Create a `review:batch` mutation channel for multi-task review operations (merge, ship, discard) to avoid N separate calls for N tasks
4. Keep query channels (`getDiff`, `getCommits`, `chatStream`) as-is — they have no side effects

**Effort:** M  
**Confidence:** High

---

## F-t1-ipc-3: Groups Domain Cascades Side Effects Through Renderer — Epic Dependency Index Out of Sync
**Severity:** Medium  
**Category:** Bidirectional Entanglement | Missing Abstraction  
**Location:** `src/main/handlers/group-handlers.ts:22-50` (epicIndex management) and group-related channels  
**Evidence:**

Groups define **13 channels** including dependency management:
```
groups:create, update, delete, list, get  (CRUD)
groups:addTask, removeTask, getGroupTasks  (membership)
groups:addDependency, removeDependency, updateDependencyCondition  (epic edges)
groups:queueAll, reorderTasks  (operations)
```

Every mutation calls `rebuildEpicIndex()` which re-queries all groups and rebuilds the in-memory index:

```typescript
// From group-handlers.ts
safeHandle('groups:create', (_e, input) => {
  const group = createGroup(input)
  rebuildEpicIndex()  // REBUILD ENTIRE INDEX
  return group
})

safeHandle('groups:addDependency', (_e, groupId: string, dep: EpicDependency) => {
  const group = addGroupDependency(groupId, dep)
  epicIndex.rebuild(groups)  // REBUILD AGAIN
  return group
})
```

**The problem:** The renderer makes sequential calls like:
1. `groups:addTask(taskId, groupId)` → main rebuilds index
2. `groups:addDependency(groupId, dep)` → main rebuilds index again
3. `groups:queueAll(groupId)` → main rebuilds index a third time

But the **renderer never observes the index state**. It's internal to main process. The renderer is triggering 3 expensive index rebuilds for 1 user action, with no feedback signal to confirm the index is correct.

Additionally, **groups operations have side effects on sprint tasks** (e.g., `groups:queueAll` transitions tasks), but there's no IPC push event to notify the renderer to refresh sprint state. The renderer must poll `sprint:list` manually to see the change.

**Impact:**
- Each group mutation rebuilds the entire epic dependency index (O(n²) where n = group count)
- Renderer doesn't know when index operations complete — can't show loading state
- No broadcast event when group mutations affect sprint tasks — renderer state goes stale
- If main crashes during an index rebuild, index is lost (not persisted)

**Recommendation:**
1. **Defer index rebuilds:** Only rebuild on demand (e.g., when `detectEpicCycle` is called) or on a background interval (e.g., every 30s), not on every mutation
2. **Add a `groups:mutationBatch` channel:** renderer passes all group operations in one call; main executes all, rebuilds index once, broadcasts `groups:updated` event with new state
3. **Broadcast `sprint:mutation` event** when group operations queue/dequeue tasks, so renderer updates sprint state automatically
4. **Persist epic index** to SQLite so it survives process restart (optional, but reduces startup cost)

**Effort:** M  
**Confidence:** Medium

---

## F-t1-ipc-4: Duplicate File System Abstractions — FS and Memory Channels Serve Same Domain
**Severity:** Medium  
**Category:** Missing Abstraction | Channel Proliferation  
**Location:** `src/shared/ipc-channels/fs-channels.ts:6-77`  
**Evidence:**

Two parallel file I/O abstractions:

**FS Channels (14):**
```
fs:openFileDialog, openDirectoryDialog  (dialogs)
fs:readFile, writeFile, readDir, stat   (I/O)
fs:readFileAsText, readFileAsBase64     (typed reads)
fs:createFile, createDir, rename, delete (mutations)
fs:watchDir, unwatchDir                 (watchers)
fs:listFiles                            (listing)
```

**Memory Channels (6):**
```
memory:listFiles, readFile, writeFile   (I/O — mirrors fs)
memory:search                           (specialized)
memory:getActiveFiles, setFileActive    (state tracking)
```

**Problem:** FS and memory serve different backends (filesystem vs. in-memory store), but their public interfaces are almost identical. A renderer component that needs to read a file doesn't know whether to call `fs:readFile` or `memory:readFile` until it knows the backend.

**Evidence of confusion:**
- `fs:readFile`, `fs:readFileAsText`, `fs:readFileAsBase64` — three variants for read with encoding handling
- `memory:readFile` — single variant, assumes UTF-8
- No shared typing — if you add a memory encoding variant, you have to add it to fs too

**Consumption pattern unknown:** No grep for "memory:" channels in renderer (likely used by IDE editor only), so it's unclear whether both abstractions are justified or if they could share a common interface.

**Impact:**
- Developers adding file I/O features must decide which domain to use (or add both)
- Bug fix in one domain doesn't automatically apply to the other
- Tests need to cover both paths separately
- 20 channels where 10-12 might suffice with a unified `file:` domain

**Recommendation:**
1. Audit renderer/main usage: which components use `memory:` vs `fs:`?
2. If both are equally used: consolidate to a single `file:` domain with a `location` parameter: `file:read(path, location: 'disk'|'memory')`
3. If memory is IDE-only: keep separate but rename to `ide-memory:` for clarity, and document the distinction in the channel index comments
4. Unify encoding variants: `file:read(path, format: 'utf8'|'base64'|'binary')`

**Effort:** M  
**Confidence:** Medium

---

## F-t1-ipc-5: Workbench Streams Are Coupled — 7 Channels Serve a Single Create Flow
**Severity:** Low  
**Category:** Missing Abstraction | Channel Proliferation  
**Location:** `src/shared/ipc-channels/system-channels.ts:140-180` (WorkbenchChannels)  
**Evidence:**

Workbench (task creation UI) exposes **7 streaming/mutation channels**:
```
workbench:generateSpec       (AI generation → stream)
workbench:checkSpec          (validation → result)
workbench:checkOperational   (operational checks → result)
workbench:researchRepo       (code search → result)
workbench:chatStream         (AI copilot → stream)
workbench:cancelStream       (cancel any stream)
workbench:extractPlan        (plan parsing → result)
```

All serve a single workflow: **user types a title/notes → AI generates spec → validation checks run → copilot assists → user submits task**. But there's no orchestration channel; the renderer calls each independently:

```typescript
// From WorkbenchCopilot
const { streamId } = await window.api.workbench.chatStream({...})
// Renderer waits for onChatChunk events
// When done:
await window.api.workbench.checkSpec({...})
// Then:
const result = await window.api.workbench.checkOperational({...})
```

**Problem:** Each channel fires separately; the renderer must manage the orchestration state (which checks are running, which completed, which failed). No atomic "create task with full validation" call. If renderer crashes mid-flow, the renderer loses the spec but main process has no trace of the in-flight operation.

**Current design is actually correct for streaming** (copilot needs async chunks), but the non-streaming operations (checkSpec, checkOperational, researchRepo) could be batched into a single `workbench:validate` call.

**Impact:**
- If new validation checks are added, renderer code must change to call them (coupling)
- Each validation runs independently; main process can't optimize (e.g., short-circuit if spec is clearly wrong early)
- Renderer state machine for tracking pending checks is complex

**Recommendation:**
1. Keep `generateSpec` and `chatStream` as separate streaming channels — they're asynchronous and can't be batched
2. **Consolidate non-streaming validation:** `workbench:validate({ spec, title, repo }) → { checks: { structural, semantic, operational }, research: RepoResearchResult }`
3. Create a `workbench:submit` channel for final submission (atomic: validate + create task + return result)
4. If new checks are added, they're absorbed into the `validate` response type, not new channels

**Effort:** S  
**Confidence:** Medium

---

## Baseline vs. Audit

| Metric | Baseline (CLAUDE.md) | Audit Finding |
|--------|----------------------|---------------|
| Total channels defined | ~138 typed channels | **179 channels** (161 req/resp + 18 broadcasts) |
| Highest-count domain | Sprint | **Sprint (20) + Review (15) + Groups (13) + FS (14) + Agent (19)** |
| Fine-grained CRUD | Unknown | **20 sprint channels; could consolidate to 4-6** |
| Bidirectional loops | Unknown | **Review domain exhibits tight orchestration leaks** |
| Handler registration files | Unknown | **29 handler modules in src/main/handlers/** |

The actual count is **higher than CLAUDE.md estimate** (179 vs. ~138), likely due to:
- Agent domain has expanded (19 channels across agent, agents, agent-manager, local prefixes)
- Broadcasting channels not counted in original estimate
- Subcategories (review, groups, planner) counted separately

---

## Summary Table

| Finding | Severity | Category | Recommendation | Effort |
|---------|----------|----------|-----------------|--------|
| F-t1-ipc-1: Sprint CRUD | High | Proliferation | Consolidate to mutation event pattern | M |
| F-t1-ipc-2: Review entanglement | High | Bidirectional | Atomic review→sprint transitions | M |
| F-t1-ipc-3: Groups cascades | Medium | Bidirectional | Batch mutations, defer rebuilds | M |
| F-t1-ipc-4: FS/Memory dupe | Medium | Missing abstraction | Unify file I/O or clarify separation | M |
| F-t1-ipc-5: Workbench coupling | Low | Proliferation | Batch validation channels | S |

---

## Recommendations for Next Steps

1. **Priority 1 (High severity):**
   - Consolidate sprint CRUD channels (F-t1-ipc-1)
   - Make review→sprint transitions atomic (F-t1-ipc-2)

2. **Priority 2 (Medium severity):**
   - Audit group mutation cascades (F-t1-ipc-3)
   - Clarify FS vs. memory abstraction (F-t1-ipc-4)

3. **Priority 3 (Low severity):**
   - Batch workbench validation (F-t1-ipc-5)

4. **Process improvements:**
   - Add a "channel consolidation" template to CLAUDE.md: when adding a new feature, check if an existing batch/mutation channel can absorb it
   - Document the distinction between request/response and broadcast channels in the preload API (currently only in ipc-channels index comments)
   - Add metrics to CI: fail if channel count grows beyond 200 without justification

---

## Out of Scope (Assigned to Other Lenses)

- **Business logic in handlers** → lens-handler-cohesion
- **Dependency direction within main process** → lens-depdir
- **Renderer store design** → Team 3/4 audits
- **Pre-load bridge completeness** → API surface audit

