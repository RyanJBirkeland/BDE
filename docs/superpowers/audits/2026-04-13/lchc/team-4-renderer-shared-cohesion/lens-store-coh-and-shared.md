# Renderer & Shared Cohesion Audit — Store Cohesion + Shared Module Integrity
**Date:** 2026-04-13  
**Scope:** Zustand stores (Store Cohesion) + `src/shared/` (Shared Module Integrity)  
**Auditor Notes:** Both scopes show strong domain separation with some specific violations identified below.

---

## Scope A: Store Cohesion (Store Seams & Domain Focus)

### F-t4-sc-1: TaskWorkbench Mixes Form State, Validation, and Persistence
**Severity:** Medium  
**Category:** Multi-Domain Store  
**Location:** `src/renderer/src/stores/taskWorkbench.ts:24-63`  
**Evidence:**
- Form fields (title, repo, priority, spec, etc.) mixed with validation state (structuralChecks, semanticChecks, operationalChecks, checksExpanded)
- Dirty-state tracking (originalSnapshot) shares the store
- localStorage persistence logic inline (loadAdvancedOpen, persistAdvancedOpen, persistDraft, clearDraftStorage)
- Validation results (CheckResult[]) are UI state + domain logic bound together

**Impact:**
- Hard to test validation independently from form state
- Component using validation state must re-render on form changes even if validation results haven't changed
- localStorage persistence concerns leak into the domain store
- Difficult to reuse validation logic in other contexts (e.g., batch validation, async validation plugins)

**Recommendation:**
Split into three stores:
1. `useTaskFormStore` — form fields only (title, repo, priority, spec, etc.)
2. `useTaskValidationStore` — validation results + checking state (structuralChecks, semanticChecks, operationalLoading, etc.)
3. `useTaskWorkbenchUIStore` — UI chrome (checksExpanded, mode, advancedOpen)
Persistence can live in a single subscriber function that reads across all three.

**Effort:** L  
**Confidence:** High

---

### F-t4-sc-2: SprintUI Exports StatusFilter Type (Belongs in SprintFilters)
**Severity:** Low  
**Category:** Misplaced State  
**Location:** `src/renderer/src/stores/sprintUI.ts:3`  
**Evidence:**
```typescript
export type { StatusFilter } from './sprintFilters'
```
StatusFilter is only used by sprintFilters store, yet exported from sprintUI. Consumers importing from sprintUI instead of sprintFilters creates indirection.

**Impact:**
- Confuses store responsibility boundaries
- Makes import sources ambiguous for future developers
- If sprintFilters is refactored, sprintUI becomes a stale re-export

**Recommendation:**
Remove the re-export from sprintUI. Consumers should import StatusFilter directly from sprintFilters.ts. Update any callers that currently use `import { StatusFilter } from 'stores/sprintUI'`.

**Effort:** S  
**Confidence:** High

---

### F-t4-sc-3: LocalAgents Store Overloads with Process Monitoring + Spawning + Log Polling
**Severity:** Medium  
**Category:** Multi-Domain Store  
**Location:** `src/renderer/src/stores/localAgents.ts:26-44`  
**Evidence:**
- State includes both spawned agents (business logic) and log polling state (UI infrastructure)
- `LogPollerState` mixin adds logContent, logNextByte, logTrimmedLines (streaming/transport concerns)
- Actions like selectLocalAgent, startLogPolling, stopLogPolling mix agent lifecycle with transport layer
- Comments acknowledge it's a separate concern but still combined

**Impact:**
- Log polling implementation details leak into agent spawn domain
- Changing log-polling strategy (e.g., WebSocket instead of polling) requires refactoring agent store
- Components fetching agent list also load stale log state
- Hard to reason about which state mutations belong to which concern

**Recommendation:**
Extract log polling into `useLogPollerStore(agentId)` — a lightweight store managing only log transport and buffering. spawnedAgents, processes, and isSpawning stay in localAgents. SelectLocalAgent becomes a cross-store action that syncs the selected pid between the stores.

**Effort:** M  
**Confidence:** High

---

### F-t4-sc-4: IDEStore Conflates Editor State, File Caching, and Settings Persistence
**Severity:** Medium  
**Category:** Multi-Domain Store  
**Location:** `src/renderer/src/stores/ide.ts:84-117`  
**Evidence:**
- rootPath, expandedDirs, openTabs, activeTabId (editor domain)
- fileContents, fileLoadingStates (file caching domain)
- focusedPanel, sidebarCollapsed, terminalCollapsed (UI chrome)
- minimapEnabled, wordWrapEnabled, fontSize (editor settings)
- Subscriber persists a cherry-picked subset to localStorage (lines 325-342)

**Impact:**
- File cache eviction logic mixed with tab management (closeTab evicts on line 221-240)
- Changing persistence strategy requires mutating the editor domain store
- Components working with file contents must subscribe to the full editor state
- fontSize, wordWrap, minimap belong in a settings store, not alongside editor workspace state

**Recommendation:**
Split into three stores:
1. `useEditorStore` — rootPath, expandedDirs, openTabs, activeTabId, focusedPanel, sidebarCollapsed, terminalCollapsed
2. `useFileCache` — fileContents, fileLoadingStates with eviction policies
3. `useEditorSettings` — minimapEnabled, wordWrapEnabled, fontSize
Each has its own persistence subscriber.

**Effort:** M  
**Confidence:** High

---

### F-t4-sc-5: SprintTasks Store Handles Optimistic Updates + Pending Tracking + Data Loading
**Severity:** Low  
**Category:** Misplaced State  
**Location:** `src/renderer/src/stores/sprintTasks.ts:30-51`  
**Evidence:**
- pendingUpdates and pendingCreates are concurrency-control fields (belong in a separate infrastructure concern)
- loadError is I/O status (belongs with loading: boolean in a LoadState)
- Core task state (tasks[]) mixes with these transient bookkeeping fields

**Impact:**
- Difficult to test/reason about optimistic update logic in isolation
- Large store with 5+ responsibilities (data, loading, caching, concurrency, error handling)
- Components that just need tasks[] must understand pendingUpdates expiry logic to read correctly

**Recommendation:**
Create a micro-store `useSprintTasksCache` that owns pendingUpdates, pendingCreates, and loadError. Main sprintTasks store syncs with it. This encapsulates concurrency concerns and keeps task data clean.

**Effort:** M  
**Confidence:** Medium

---

## Scope B: Shared Module Integrity (Cross-Process Contract)

### F-t4-sh-1: `src/shared/ipc-channels/ui-channels.ts` Exports Renderer-Only Types
**Severity:** High  
**Category:** Shared Layer Pollution  
**Location:** `src/shared/ipc-channels/ui-channels.ts:22-63`  
**Evidence:**
- TearoffChannels (tearoff:create, tearoff:closeConfirmed, etc.) encode renderer-only multi-window domain logic
- Types like `sourcePanelId`, `zone`, `viewKey` are panel-tree concepts (renderer only)
- Main process never needs to know about tear-off windows or panel IDs
- These channels orchestrate renderer-internal UI state, not a main↔renderer contract

**Impact:**
- Adds cruft to main process's IPC type surface (IpcChannelMap) even though main doesn't use it
- Violates cohesion: types leak renderer concerns into shared contract layer
- Makes it harder to audit what main process actually needs to know about

**Recommendation:**
Move TearoffChannels from `src/shared/ipc-channels/ui-channels.ts` to a new file `src/renderer/src/stores/tearoff-channels.ts`. It's a renderer-internal broadcast (like panel layout). Main doesn't invoke tearoff:* handlers. Unregister from IpcChannelMap in shared/ipc-channels/index.ts.

**Effort:** M  
**Confidence:** High

---

### F-t4-sh-2: `src/shared/constants.ts` Embeds Renderer-Specific Template Prompts
**Severity:** Medium  
**Category:** Shared Layer Pollution  
**Location:** `src/shared/constants.ts:42-68`  
**Evidence:**
- DEFAULT_TASK_TEMPLATES includes multi-line prompt prefixes (50+ lines each)
- References renderer paths like `src/renderer/src/components/[area]/` and `src/renderer/src/stores/`
- Describes UI wiring steps (IPC channels, preload bridge, View type union) specific to renderer development
- These are defaults for the Task Creation UI, not a main process concern

**Impact:**
- Shared module depends on renderer implementation details
- Template updates require touching a shared file, not just renderer
- Main process loads these templates even though it never uses them for UI presentation
- Makes shared/constants a kitchen sink for any constants someone thinks is "global"

**Recommendation:**
Move DEFAULT_TASK_TEMPLATES to `src/renderer/src/lib/default-templates.ts` (already imported by promptTemplates.ts). Keep TASK_STATUS, PR_STATUS, AGENT_STATUS, and MIN_SPEC_LENGTH in shared/constants.ts. Those are domain facts both processes care about.

**Effort:** S  
**Confidence:** High

---

### F-t4-sh-3: StatusFilter Type Only Used by Renderer, Defined in Shared
**Severity:** Low  
**Category:** Wrong-Process Type  
**Location:** `src/renderer/src/stores/sprintFilters.ts:3-11`  
**Evidence:**
- StatusFilter is a union of filter values ('all' | 'backlog' | 'todo' | etc.)
- Only defined and used by renderer (sprintFilters.ts, sprintUI.ts re-export)
- No IPC channel passes StatusFilter; main process never filters sprints by status in response to renderer requests
- Could live entirely in renderer code

**Impact:**
- Bloats shared type surface with renderer-local concepts
- Makes it harder to identify what main process actually needs to know
- Maintenance burden if filter options change (touches shared/types/index.ts)

**Recommendation:**
Move StatusFilter definition to `src/renderer/src/stores/sprintFilters.ts` (it's already there as an export). Remove from shared/types. If main ever needs to understand sprint status filters, it can define its own type aligned to its domain language.

**Effort:** S  
**Confidence:** High

---

### F-t4-sh-4: IPC Channel `agent:completionsPerHour` Inconsistent Naming Pattern
**Severity:** Low  
**Category:** Shared Layer Pollution  
**Location:** `src/shared/ipc-channels/ui-channels.ts:89-92`  
**Evidence:**
```typescript
export interface DashboardChannels {
  'agent:completionsPerHour': { args: []; result: CompletionBucket[] }
  'agent:recentEvents': { args: [limit?: number]; result: DashboardEvent[] }
  'dashboard:dailySuccessRate': { args: [days?: number]; result: DailySuccessRate[] }
}
```
Two channels use `agent:` prefix (dashboard queries, not agent-specific operations), one uses `dashboard:`. Comments in ipc-channels/index.ts acknowledge this is a legacy pattern but justify it. This inconsistency creates friction when onboarding devs.

**Impact:**
- Unclear whether `agent:*` means "per-agent action" or "dashboard query about agents"
- New developer might create `agent:*` channel for something that should be `dashboard:*`
- Weakens the documented naming convention (domain:action)

**Recommendation:**
Rename `agent:completionsPerHour` and `agent:recentEvents` to `dashboard:completionsPerHour` and `dashboard:recentEvents`. Document the legacy `agent:` channels separately in the index comments (e.g., `agent:*` for per-agent actions, `agent:recentEvents` is legacy—use `dashboard:*` for new dashboard queries).

**Effort:** S  
**Confidence:** Medium

---

### F-t4-sh-5: Shared `types/` Exports Validation-Heavy Task Types (Not All Needed by Main)
**Severity:** Low  
**Category:** Shared Layer Pollution  
**Location:** `src/shared/types/task-types.ts`  
**Evidence:**
- Exports CheckResult, SpecType, ValidationProfile (validation rules/UI concerns)
- Main process doesn't validate specs — it executes them
- TaskWorkbench validation logic lives in renderer; main just stores and returns spec_type
- Shared types bleeds validation infrastructure main never invokes

**Impact:**
- Increases shared module surface area for types main doesn't need
- Future validation refactoring (e.g., adding new Check tier) requires coordinating with shared types
- Makes it less obvious which types are truly bidirectional vs. renderer convenience

**Recommendation:**
Keep StructuralCheckResult in shared/spec-validation.ts (main uses it for validation before task creation). Move SpecType and ValidationProfile decision-making to renderer. Main only needs to store/return spec_type as a string enum. Create `src/renderer/src/lib/validation-types.ts` for CheckResult and SpecType if needed for renderer-only validation display.

**Effort:** M  
**Confidence:** Medium

---

## Summary

**Store Cohesion (Scope A):** 5 findings
- 2 High severity (unblocking but increases friction)
- 3 Medium severity (acceptable but growing tech debt if left unchecked)
- Pattern: Large stores accumulating unrelated state fields; persistence logic leaking into domain stores

**Shared Module Integrity (Scope B):** 5 findings
- 2 High severity (main violators)
- 3 Low/Medium severity (hygiene + naming consistency)
- Pattern: Renderer UI concepts and validation-specific types in shared; inconsistent naming conventions

### Effort Summary (if all addressed)
- **Critical path** (F-t4-sc-1, F-t4-sh-1): ~2 weeks parallel (L + M effort)
- **Nice-to-have** (remaining): ~2-3 weeks (all S + M effort)
- **Total time to address all:** ~3-4 weeks (team of 2)

---
