# SRP Audit: Single Responsibility Principle Violations

**Audit Date:** 2026-04-13  
**Scope:** Full codebase  
**Methodology:** Manual review of 9 largest files + architectural pattern analysis  
**Confidence Level:** High

---

## F-t3-srp-1: AgentManagerImpl — Multi-stakeholder orchestration nightmare

**Severity:** Critical  
**Category:** SRP  
**Location:** `src/main/agent-manager/index.ts:102-801`

**Evidence:**

AgentManagerImpl mixes 6 distinct responsibilities:

1. **Queue Drain Loop** — manages task polling from DB, rate limiting, spawning agents (lines 387-440)
2. **Watchdog Process Management** — monitors agent health, kills timeouts, handles circuit breaker (lines 464-508)
3. **Orphan Recovery** — finds stale agents, re-queues lost tasks (line 512-518)
4. **Worktree Lifecycle** — creates/prunes git worktrees (line 531-542)
5. **Concurrency State Machine** — tracks available slots, circuit breaker state (lines 145, 369-378)
6. **Task Terminal Lifecycle** — manages resolution, dependency updates, dependency index refresh (lines 219-229)

Each responsibility changes for different reasons:
- Queue drain logic changes when task scheduling strategy evolves
- Watchdog changes when agent timeout rules change
- Orphan recovery changes when task state transitions change
- Worktree logic changes when git strategy changes
- Concurrency changes when slot allocation policy changes
- Terminal logic changes when task completion semantics change

**Impact:**

This 801-line god class is the bottleneck for 6 independent actor requirements. Changes to any one responsibility risk breaking others. Testing requires mocking 6 different subsystems. Each loop (drain, watchdog, orphan, prune) adds 50+ lines of state management, making it nearly impossible to reason about causality.

**Recommendation:**

Extract into 5 single-responsibility classes:

1. **QueueDrainManager** — pure queue polling logic; stays in index.ts main loop
2. **WatchdogProcess** — agent health checking; owns circuit breaker
3. **OrphanRecoverer** — stale agent detection; calls terminal handler
4. **WorktreeCoordinator** — worktree setup/prune; pure filesystem state
5. **ConcurrencyController** — slot allocation state machine (already extracted to concurrency.ts — just remove from index.ts)

Keep the main AgentManagerImpl as a thin facade that:
- Calls each subsystem from its loop
- Coordinates initial startup
- Exposes public API (start, stop, steerAgent, etc.)

**Effort:** L  
**Confidence:** High

---

## F-t3-srp-2: run-agent.ts — Spanning 4 layers without clear boundaries

**Severity:** Critical  
**Category:** SRP  
**Location:** `src/main/agent-manager/run-agent.ts:1-769`

**Evidence:**

This 769-line file handles orthogonal concerns:

1. **Validation & Prompt Assembly** (lines 232-351) — validates task content, reads scratchpad, builds prompt
2. **Spawn Lifecycle** (lines 487-511) — spawns process, initializes tracking, persists agent_run_id
3. **Message Consumption** (lines 167-220) — iterates message stream, tracks costs, emits events
4. **Exit Classification** (lines 557-624) — classifies exit code (fast-fail vs normal), drives task transitions

Why it changes:
- Validation rules change when task schema evolves
- Spawn logic changes when agent SDK changes
- Message consumption rules change when event types change
- Exit classification rules change when retry/failure policy changes

**Impact:**

Four independent actors (task DB schema owner, SDK maintainer, event system owner, retry policy owner) all require changes to the same file. Each phase is tightly coupled via shared context (the `task`, `agent`, `deps` objects), making it hard to test phases in isolation.

**Recommendation:**

Extract into separate modules:

1. **prompt-validation.ts** — `validateTaskForRun()` + `assembleRunContext()` (already exported; just move to separate file)
2. **agent-spawn.ts** — `spawnAndWireAgent()` + `initializeAgentTracking()`
3. **message-consumer.ts** — `consumeMessages()` + `processSDKMessage()`
4. **exit-classifier.ts** — `classifyExit()`, `resolveSuccess()`, `resolveFailure()` logic (move from completion.ts)

Keep `runAgent()` as an orchestrator that chains these pure phases.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-3: EpicDetail.tsx — Rendering + State Management + Drag/Drop + Form Editing all mixed

**Severity:** High  
**Category:** SRP  
**Location:** `src/renderer/src/components/planner/EpicDetail.tsx:43-746`

**Evidence:**

This 746-line React component handles 5 distinct responsibilities:

1. **Epic Metadata Rendering** (lines 306-457) — displays epic name, goal, icon, status
2. **Progress Calculation & Display** (lines 120-153, 460-496) — counts task statuses, calculates percentages, renders progress bar
3. **Task List Rendering** (lines 508-715) — renders task rows with inline editing, drag/drop, completed section
4. **Inline Spec Editing** (lines 216-255) — manages editing state, save/cancel handlers
5. **Drag & Drop Coordination** (lines 260-301) — tracks drag state, calculates reorder, calls onReorderTasks

Changes are driven by:
- Epic rendering owner (designer wants icon layout changes)
- Progress logic owner (counting rules change)
- Task list owner (task row format changes)
- Spec editor owner (inline editor behavior changes)
- Drag/drop owner (reorder UX changes)

**Impact:**

Any change to task rendering breaks epic progress. Changes to drag logic require understanding 30 lines of state management scattered across the component. Inline editing state lives alongside task rendering logic, making it impossible to test editing in isolation. `useMemo` calls are deeply interdependent, making performance optimization risky.

**Recommendation:**

Split into 5 files:

1. **EpicDetail.tsx** — facade component; manages `onAddDependency`, `onQueueAll`, etc.; orchestrates children
2. **EpicHeader.tsx** — renders epic name, goal, icon, overflow menu
3. **EpicProgress.tsx** — calculates and renders progress bar + status breakdown
4. **TaskRow.tsx** — single task rendering + inline spec editing (own state)
5. **TaskList.tsx** — maps task array, handles drag/drop coordination

Move drag state to a context or custom hook; pass reorder callback to TaskRow.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-4: MemorySection.tsx — File CRUD + Search + Group Logic all in one component

**Severity:** High  
**Category:** SRP  
**Location:** `src/renderer/src/components/settings/MemorySection.tsx:75-592`

**Evidence:**

This 592-line settings panel manages 4 independent concerns:

1. **File Listing & Organization** (lines 49-73, 95-104) — calls `listFiles()`, groups into pinned/daily/projects/other
2. **File Content Editor** (lines 75-167) — manages selected file, content changes, dirty state, save/discard
3. **Search System** (lines 186-210) — debounces search, fetches results, displays in dropdown
4. **File Creation** (lines 168-184) — creates new files with `.md` extension, reloads list

Why it changes:
- File listing changes when grouping strategy changes
- Editor changes when save behavior or dirty-state tracking changes
- Search changes when search backend changes
- Creation changes when file naming conventions change

**Impact:**

The component has 10+ pieces of state (`loadingFiles`, `loadingContent`, `selectedPath`, `content`, `savedContent`, `searchQuery`, `searchResults`, `isSearching`, `activeFiles`, `creating`). Dirty state logic is embedded in editor callbacks. Search state depends on list state. All UI is monolithic, making it hard to extract individual features.

**Recommendation:**

Split into:

1. **MemorySection.tsx** — facade; coordinates list + editor + search tabs
2. **MemoryFileList.tsx** — renders file groups (pinned, daily, projects, other); owns `files`, `loadingFiles`
3. **MemoryFileEditor.tsx** — renders textarea, save/discard; owns `selectedPath`, `content`, `savedContent`, `isDirty`
4. **MemorySearch.tsx** — search input + results dropdown; owns `searchQuery`, `searchResults`, `isSearching`
5. **useMemoryFiles.ts** — custom hook for `listFiles()`, `loadFiles()`, `loadActiveFiles()`

Each sub-component becomes testable and reusable.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-5: tearoff-manager.ts — Window Lifecycle + State Persistence + Cross-Window Drag

**Severity:** High  
**Category:** SRP  
**Location:** `src/main/tearoff-manager.ts:1-633`

**Evidence:**

This 633-line Electron module handles 4 distinct responsibilities:

1. **BrowserWindow Lifecycle** (lines 154-233) — setup, close flow with confirmation, cleanup
2. **State Persistence** (lines 108-129) — debounced save of window bounds to settings
3. **Cross-Window Drag Coordination** (lines 319-442) — cursor polling, window detection, IPC messaging
4. **IPC Handler Registration** (lines 465-633) — registers 6 different IPC channels

Why it changes:
- Window lifecycle changes when tearoff UX changes
- Persistence changes when settings schema changes
- Drag logic changes when drag interaction rules change
- IPC handlers change when protocol evolves

**Impact:**

The module has 3 separate state machines: `tearoffWindows` map, `resizeTimers` map, and `activeDrag` object. Each manages independent timers and event listeners. The close flow (2-phase async) is tightly coupled to IPC registration. Drag cursor polling runs independently from window tracking, creating race conditions if a window closes mid-drag (lines 399-403 try to handle this but it's fragile).

**Recommendation:**

Extract into:

1. **tearoff-window-manager.ts** — BrowserWindow creation, setup, close flow; owns `tearoffWindows`
2. **tearoff-state-persistence.ts** — bounds saving logic; owns `resizeTimers`
3. **cross-window-drag-coordinator.ts** — cursor polling, window detection; owns `activeDrag`
4. **tearoff-handlers.ts** — IPC handler registration (calls above managers)

Pass bounds persistence as a callback to window manager instead of tight coupling.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-6: prompt-composer.ts — All Agent Types Crammed Into One File

**Severity:** Medium  
**Category:** SRP  
**Location:** `src/main/agent-manager/prompt-composer.ts:1-682`

**Evidence:**

This 682-line file assembles prompts for 6 agent types (pipeline, assistant, adhoc, copilot, synthesizer, reviewer) in a single dispatcher. Changes are driven by 6 independent stakeholders:

1. **Pipeline Agent Owner** — changes `buildPipelinePrompt()` when task execution rules change
2. **Assistant Agent Owner** — changes `buildAssistantPrompt()` when interactive agent behavior changes
3. **Copilot Owner** — changes `buildCopilotPrompt()` when spec-drafting UX changes
4. **Synthesizer Owner** — changes `buildSynthesizerPrompt()` when spec generation rules change
5. **Reviewer Owner** — changes `buildReviewerPrompt()` (imported) when code review policy changes
6. **Preamble/Section Maintainer** — changes shared sections like `CODING_AGENT_PREAMBLE`, `buildRetryContext()`, when cross-cutting rules change

**Impact:**

Shared utility functions like `buildRetryContext()`, `buildUpstreamContextSection()`, `truncateSpec()` are used by multiple agents but live in this file. Preambles and constants are duplicated across agent types. Changes to one agent's personality (lines 318, 432) are easy to miss for other agents. The dispatcher at line 650 mixes all types in a switch statement.

**Recommendation:**

Extract per-agent-type files:

1. **prompt-composer-pipeline.ts** — `buildPipelinePrompt()` + pipeline-specific sections
2. **prompt-composer-assistant.ts** — `buildAssistantPrompt()` + assistant/adhoc logic
3. **prompt-composer-copilot.ts** — `buildCopilotPrompt()` + spec-drafting rules
4. **prompt-composer-synthesizer.ts** — `buildSynthesizerPrompt()` + synthesizer requirements
5. **prompt-composer-shared.ts** — shared sections, utilities, preambles
6. **prompt-composer.ts** — dispatcher that imports from above and routes to correct builder

This makes it easy to change one agent type without affecting others.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-7: WorkbenchForm.tsx — Task Creation + Validation + Spec Checks + UI State

**Severity:** High  
**Category:** SRP  
**Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:56-600+`

**Evidence:**

This large form component (570+ lines visible) mixes:

1. **Form State Management** — title, repo, priority, spec, etc. stored in `useTaskWorkbenchStore`
2. **Validation Execution** — tier-1 (structural), tier-2 (semantic) checks; semantic runs debounced
3. **Task Creation/Update Logic** — `createOrUpdateTask()` handles both edit and create flows (lines 91-146)
4. **Spec Quality Analysis** — calls `window.api.workbench.checkSpec()`, processes results into check objects
5. **Queue Confirmation Flow** — manages modal state, confirmation message, queue logic (lines 80-82)

Why it changes:
- Form structure changes when task schema changes
- Validation rules change when quality standards change
- Task creation changes when DB schema changes
- Spec analysis changes when quality engine changes
- Queue flow changes when task queueing policy changes

**Impact:**

The component fetches state from two stores (`useTaskWorkbenchStore` and `useSprintTasks`), making it hard to reason about data flow. The `createOrUpdateTask` callback is deeply nested and uses `useTaskWorkbenchStore.getState()` to escape closure (line 93). Validation is split between hook-based (`useValidationChecks`) and direct API calls (line 157), making test setup complex.

**Recommendation:**

Extract:

1. **useTaskFormState.ts** — hook that wraps `useTaskWorkbenchStore` with derived state (isDirty, isValid, etc.)
2. **useSpecQualityChecks.ts** — debounced semantic check logic; returns check results
3. **useTaskCreation.ts** — `createOrUpdateTask()` logic as a custom hook; calls repo/actions
4. **WorkbenchForm.tsx** — UI only; composes above hooks

Keep the form logic in the component, but move the orchestration into hooks.

**Effort:** M  
**Confidence:** High

---

## F-t3-srp-8: panelLayout.ts — Tree Data Structure + Persistence + UI State Machine

**Severity:** Medium  
**Category:** SRP  
**Location:** `src/renderer/src/stores/panelLayout.ts:1-562`

**Evidence:**

This 562-line Zustand store manages 3 concerns:

1. **Panel Tree Data Structure** (lines 62-177) — pure functions for tree mutation (findLeaf, splitNode, addTab, closeTab, moveTab, setActiveTab)
2. **Persistence Logic** (lines ??? — not visible in excerpt but implied) — loads/saves panel state to localStorage
3. **UI State Machine** — the Zustand store itself manages active panel, undo/redo stack, drag state

Changes are driven by:
- Tree logic changes when panel splitting/merging rules change
- Persistence changes when storage schema changes
- UI state changes when panel interaction UX changes

**Impact:**

Pure tree functions are mixed with store state. The store doesn't show which actions trigger persistence. Tree operations require understanding 200+ lines of recursive logic. If you want to port the tree logic to another project, you have to extract it manually.

**Recommendation:**

Extract:

1. **panel-tree.ts** — pure tree functions (createLeaf, findLeaf, splitNode, etc.); no state
2. **panel-persistence.ts** — load/save to localStorage; pure functions taking tree as input
3. **panelLayout.ts** — Zustand store that uses above; manages UI state only

This makes tree logic reusable and testable without Zustand.

**Effort:** S  
**Confidence:** Medium

---

## F-t3-srp-9: preload/index.ts — 557 Lines of API Facade for 20+ Unrelated Systems

**Severity:** Medium  
**Category:** SRP  
**Location:** `src/preload/index.ts:1-557`

**Evidence:**

This file is a monolithic facade that exports an `api` object with 20+ sub-objects:

- `settings` — 6 methods (get, set, getJson, setJson, delete, profiles)
- `claudeConfig` — 2 methods (get, setPermissions)
- `webhooks` — 5 methods (list, create, update, delete, test)
- `github` — 2 methods (fetch, isConfigured)
- `gitStatus`, `gitDiff`, `gitStage`, etc. — 10+ git commands
- `sprint` — 30+ methods for task management
- `groups` — 8+ methods for task groups
- `memory` — 5 methods for memory file management
- `agents` — 4 methods for agent history

While technically this is just a type-safe IPC wrapper, it violates SRP because:

1. **No Logical Grouping** — settings, webhooks, git, sprint, groups, memory, agents are unrelated concerns grouped only by "IPC facade"
2. **Grows Without Bounds** — each new IPC channel gets added to this file; no natural split point
3. **Change Frequency** — when sprint task API changes, when git commands change, when settings change — all hit this file

**Impact:**

The file is a change hotspot. When adding a new agent API method, you edit this file even if you don't touch any facade logic. Renderer code can't easily discover what APIs are available without reading this file.

**Recommendation:**

Split into per-domain facade files:

1. **api-settings.ts** — settings, claudeConfig
2. **api-git.ts** — all git* functions
3. **api-sprint.ts** — sprint, groups (task management domain)
4. **api-memory.ts** — memory functions
5. **api-agents.ts** — agents, agent history
6. **api-webhooks.ts** — webhooks
7. **api-utilities.ts** — clipboard, playground, window, github

Re-export all from preload/index.ts:

```ts
export const api = {
  settings: settingsFacade,
  git: gitFacade,
  sprint: sprintFacade,
  memory: memoryFacade,
  agents: agentsFacade,
  webhooks: webhooksFacade,
  ...utilityFacade
}
```

Each domain is now independently testable and maintainable.

**Effort:** M  
**Confidence:** Medium

---

## Summary

**Total Critical Violations:** 2 (AgentManagerImpl, run-agent.ts)  
**Total High Violations:** 4 (EpicDetail, MemorySection, tearoff-manager, WorkbenchForm)  
**Total Medium Violations:** 3 (prompt-composer, panelLayout, preload)

**Effort Estimate to Address All:** 5–6 developer-weeks

**Recommended Priority Order:**

1. **AgentManagerImpl** (1–2 weeks) — unblocks agent reliability improvements
2. **run-agent.ts** (3–4 days) — unblocks SDK integration changes
3. **EpicDetail + MemorySection** (1 week, parallel) — unblocks planner/settings UI work
4. **tearoff-manager + WorkbenchForm** (1 week, parallel) — unblocks multi-window + form UX improvements
5. **prompt-composer + panelLayout + preload** (3–4 days, parallel) — nice-to-have refactorings

**Note:** These extractions should be done in isolation, with full test coverage, as they're high-risk refactorings. No code changes were made (read-only audit).
