# Service Layer Cohesion Audit — BDE Main Branch
**Date:** 2026-04-13
**Lensed Audit:** Service Cohesion (lens-svc-coh)
**Scope:** `src/main/services/` and `src/main/data/`

---

## F-t2-svc-1: Review Orchestration Domain Fragmentation
**Severity:** High
**Category:** Scattered Business Logic
**Location:** `review-orchestration-service.ts` (224 lines), `review-action-policy.ts` (329 lines), `review-action-executor.ts` (326 lines), `review-merge-service.ts` (227 lines)
**Evidence:** 
- Four separate modules split the review action workflow across policy, execution, merge handling, and orchestration facades
- `review-action-policy.ts` classifies actions into plans (pure logic)
- `review-action-executor.ts` executes those plans with git I/O
- `review-merge-service.ts` handles merge-specific git operations
- `review-orchestration-service.ts` re-exports and composes them
- Together they manage a coherent domain (PR creation, merging, revision requests) but are scattered across four files
**Impact:** 
- Business logic for a single domain (review workflow) is fragmented across 4 files, making it harder to reason about the complete flow
- Callers must import from multiple modules to assemble a full action
- Testing the entire review pipeline requires mocking across four boundaries
**Recommendation:** 
- Create a single `ReviewActionService` that exports `{ classifyAction, executeAction }` internally using the policy/executor split
- Keep policy and executor as private helpers (not exported)
- Reserve the four-file split for unit testing isolation; present a single cohesive interface
**Effort:** M
**Confidence:** High

---

## F-t2-svc-2: Spec Quality Service Validators — Over-Fragmented Architecture
**Severity:** Medium
**Category:** Over-Fragmented
**Location:** `spec-quality/` directory with validators: `banned-phrases-validator.ts`, `file-paths-validator.ts`, `numbered-steps-validator.ts`, `prescriptiveness-validator.ts`, `required-sections-validator.ts`, `size-warnings-validator.ts`
**Evidence:**
- Six separate validator modules, each implementing `ISpecValidator` or `IAsyncSpecValidator`
- `SpecQualityService` dynamically composes them; factory pattern in `index.ts` instantiates them
- Each validator is a single-responsibility object; they are highly focused
- However, callers must import the factory, which then composes six separate files
- Each validator file contains 70–150 lines with minimal code reuse
**Impact:**
- Filesystem navigation overhead: 6 separate files to understand spec validation rules
- Maintenance burden: adding a new validation rule requires a new file (consider: would a `validators.ts` with validator definitions and factory be simpler?)
- Factory coupling: the factory must know about all validators; adding a new one requires updating the factory
**Recommendation:**
- Consolidate validators into a single `validators.ts` module that exports all validator factories
- Keep `SpecQualityService` in `spec-quality-service.ts` unchanged
- Move factory instantiation to `validators.ts` so new validators only need registration in one file
- Reserve separate files if a validator has >200 lines or complex dependencies; currently not justified
**Effort:** S
**Confidence:** Medium

---

## F-t2-svc-3: Workbench Checks Service — Incoherent Responsibility Set
**Severity:** High
**Category:** God Service
**Location:** `workbench-checks-service.ts` (119 lines)
**Evidence:**
- Exports 5 independent check functions: `checkAuth()`, `checkRepoPath()`, `checkGitStatus()`, `checkTaskConflicts()`, `checkAgentSlots()`
- Each checks a different domain: authentication, git status, task conflicts, agent concurrency
- Grouped only by "checks that run before starting a task"
- No shared state, no common helper methods, no callbacks or callbacks passed in
- Single export: `runOperationalChecks()` orchestrates all five; but they are not tightly coupled
**Impact:**
- Low cohesion: each check is independent; the service is a container, not a domain
- Naming suggests tactical (workbench) rather than domain-driven
- Easier to test individually (good), but harder to understand why these five checks are grouped together
**Recommendation:**
- Rename to `OperationalChecksService` for clarity; explicitly signal this is a composite utility, not a domain service
- Alternatively, distribute checks to domain services: `AuthService.checkStatus()`, `GitService.checkStatus()`, `TaskService.checkConflicts()`, `AgentService.checkSlots()`
- If keeping as a utility, document why these five are grouped (e.g., "All checks must pass before launching an agent")
**Effort:** S
**Confidence:** Medium

---

## F-t2-svc-4: Dependency Service — Over-Loaded with Task + Epic Domain Logic
**Severity:** Medium
**Category:** Scattered Business Logic
**Location:** `dependency-service.ts` (307 lines), `epic-dependency-service.ts` (156 lines), `task-terminal-service.ts` (114 lines)
**Evidence:**
- `dependency-service.ts` owns task-level dependency logic: `createDependencyIndex()`, `checkTaskDependencies()`, `computeBlockState()`
- `epic-dependency-service.ts` owns epic-level dependency logic: `createEpicDependencyIndex()`, `areEpicDepsSatisfied()`
- `task-terminal-service.ts` orchestrates terminal status → dependency resolution using both indexes
- Helper functions like `formatBlockedNote()`, `stripBlockedNote()`, `buildBlockedNotes()` for task notes are in `dependency-service.ts`
- `computeBlockState()` composes task + epic checks, bridging the two; couples them at the service layer
**Impact:**
- Dependency resolution logic is split across three files, making the full flow non-obvious
- A change to blocking semantics requires edits across multiple files
- Epic dependency code is a mirror of task dependency code (suggests possible abstraction)
**Recommendation:**
- Keep task and epic dependency indexes separate (they are fundamentally different)
- Move `computeBlockState()` to a new `DependencyResolutionService` that orchestrates the composition
- Alternatively, consolidate task and epic logic into a single unified service with a clear separation of concerns (tasks have `TaskDependencyIndex`, epics have `EpicDependencyIndex`, common logic in helpers)
- Move note formatting helpers to a `task-notes` utility module (they are orthogonal to dependency logic)
**Effort:** M
**Confidence:** High

---

## F-t2-svc-5: Sprint Service — Facade Over-Abstraction and Bidirectional Broadcast Coupling
**Severity:** Medium
**Category:** Scattered Business Logic
**Location:** `sprint-service.ts` (84 lines), `sprint-mutations.ts` (123 lines), `sprint-mutation-broadcaster.ts` (lines unknown)
**Evidence:**
- `sprint-service.ts` is a re-export facade that wraps `sprint-mutations.ts` calls
- Each mutation is wrapped to auto-notify via `broadcaster.notifySprintMutation()`
- `sprint-mutations.ts` imports and delegates to `ISprintTaskRepository` (pure data layer)
- `sprint-mutation-broadcaster.ts` manages subscriptions and broadcasts mutations
- Three-layer pipeline: service wrapper → mutations → repository; then broadcast → listeners
- Called from handlers, agent manager, and other services
**Impact:**
- Bidirectional coupling: services call `updateTask()`, which triggers a broadcast to listeners (which may call other services)
- Difficult to reason about side effects; a simple `updateTask()` call has invisible consequences
- The facade adds a layer; callers could import `sprint-mutations` directly
**Recommendation:**
- Keep `sprint-mutations.ts` as the canonical data layer (no notifications)
- Keep `sprint-mutation-broadcaster.ts` as the notification hub
- Remove the `sprint-service.ts` facade; let callers choose: use `mutations` for pure updates or import `broadcaster` directly if they need notifications
- Document the pattern: "Use `sprint-mutations` for data-only operations; import `notifySprintMutation` directly if you need to broadcast"
**Effort:** M
**Confidence:** Medium

---

## F-t2-svc-6: Review Service Parsing + Execution — Mixed Concerns
**Severity:** Medium
**Category:** Scattered Business Logic
**Location:** `review-service.ts` (270 lines)
**Evidence:**
- Exports parsing logic: `parseReviewResponse()`, `stripFences()`, `extractFirstJsonObject()`, `validateParsedReview()`
- Exports custom errors: `WorktreeMissingError`, `MalformedReviewError`
- Defers to dependencies: `repo: IReviewRepository`, `taskRepo: ISprintTaskRepository`, `logger: Logger`, `resolveWorktreePath()`
- Lines 146–270 not examined (end of file); likely contains review execution logic
- Parsing is a single-purpose utility; execution is domain logic
**Impact:**
- Name suggests "review service" (domain), but it contains parsing boilerplate
- Parsing functions could be reused by other modules (e.g., testing, debugging) but are bundled here
- Hard to test parsing without setting up review dependencies
**Recommendation:**
- Extract parsing to a `review-response-parser.ts` utility module
- Keep `review-service.ts` focused on review execution (invoking the model, handling state, etc.)
- Move `MalformedReviewError` to the parser module
- Callers import the parser separately if they need just parsing: `import { parseReviewResponse } from './review-response-parser'`
**Effort:** S
**Confidence:** High

---

## F-t2-svc-7: Data Layer Query Modules — Appropriate Fragmentation (No Issue)
**Severity:** Low (Positive Finding)
**Category:** Appropriate Design
**Location:** `src/main/data/` directory
**Evidence:**
- `sprint-task-repository.ts`: Facade over task queries (appropriate; separates interface from impl)
- `sprint-queries.ts`, `sprint-maintenance.ts`, `sprint-planning-queries.ts`, `task-group-queries.ts`, `reporting-queries.ts`: Focused query modules
- Each module owns a single concern: base task CRUD, group operations, planning operations, reporting
- `ISprintTaskRepository` composes all of them via the facade pattern
- No leakage of data logic into services
**Impact:** None (good cohesion observed)
**Recommendation:** None; data layer architecture is sound
**Effort:** N/A
**Confidence:** N/A

---

## F-t2-svc-8: Batch Import + CSV Export — Incomplete Abstraction
**Severity:** Low
**Category:** Over-Fragmented
**Location:** `batch-import.ts` (106 lines), `csv-export.ts` (single function)
**Evidence:**
- `batch-import.ts` handles bulk task import
- `csv-export.ts` exports `formatTasksAsCsv()` — a single formatter function
- Both deal with task serialization; one serializes to database, one to CSV
- No shared abstraction for serialization/deserialization
- `csv-export.ts` is one of the smallest modules (likely <50 lines)
**Impact:**
- Low impact; both are simple utilities
- Could be consolidated if CSV export grows (e.g., add JSON export, YAML export)
**Recommendation:**
- Monitor growth; if export formats multiply (JSON, YAML, XML), create a `task-export` module
- For now, acceptable as-is; the single function is self-contained
**Effort:** N/A (defer)
**Confidence:** Low

---

## Summary Table
| Finding | Category | Severity | Effort | Confidence |
|---------|----------|----------|--------|------------|
| F-t2-svc-1 | Scattered Logic | High | M | High |
| F-t2-svc-2 | Over-Fragmented | Medium | S | Medium |
| F-t2-svc-3 | God Service | High | S | Medium |
| F-t2-svc-4 | Scattered Logic | Medium | M | High |
| F-t2-svc-5 | Scattered Logic | Medium | M | Medium |
| F-t2-svc-6 | Scattered Logic | Medium | S | High |
| F-t2-svc-7 | (Positive) | N/A | N/A | N/A |
| F-t2-svc-8 | Over-Fragmented | Low | N/A | Low |

---

## Key Patterns Observed
1. **Review domain fragmentation**: Policy–executor split is good for testing but presented as four separate exports; needs a facade
2. **Over-composition**: Multiple services (Sprint, Dependency, Review) use composition/delegation but don't hide it from callers
3. **Bidirectional coupling**: Mutations → broadcast → listeners creates hidden side effects
4. **Utility bundling**: Workbench checks and CSV export are containers, not domain services
5. **Data layer health**: Query modules are well-structured and appropriately fragmented

---

**Generated:** 2026-04-13
**Auditor:** Claude Code Service Layer Cohesion Inspector
