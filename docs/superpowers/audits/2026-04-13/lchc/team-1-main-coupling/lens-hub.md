# Team 1 Main Process Hub Module Analysis
**Date:** 2026-04-13  
**Auditor:** Claude Code (Hub Module Detector)  
**Scope:** `src/main/` coupling through accidental hub modules

---

## Executive Summary

The main process exhibits **moderate coupling risk** centered on three critical hub modules:

1. **`logger.ts`** — 72 direct imports (highest fan-in)
2. **`db.ts`** — 36 direct imports (database access singleton)
3. **`sprint-queries.ts`** — Legitimate facade but re-exported by 30+ callers through repo abstraction

The data layer (`src/main/data/`) shows healthy **refactoring patterns** (repository abstraction, barrel files with clear purpose) but suffers from **cross-cutting volatility** — many handlers and services reach directly into data modules for transactional operations without a stable service boundary. The agent-manager is the largest consumer, with tight coupling to data access spread across multiple modules.

**Severity:** Medium overall. No single module is a breaking change bomb, but volatility in `sprint-queries.ts` and its underlying modules (CRUD, queue, agent-queries) creates ripple risk for feature work.

---

## Finding Details

## F-t1-hub-1: logger.ts — Unavoidable Infrastructure Hub

**Severity:** Medium  
**Category:** Stable Abstraction  
**Location:** `src/main/logger.ts:1-90`  
**Evidence:**  
- Import fan-in: **72 files** across handlers, services, agent-manager, data, bootstrap
- Exports: `createLogger(name)`, `logError(logger, msg, err)`, `Logger` interface
- Change frequency: **Stable** — the interface has not changed since inception; additions are non-breaking
- Scope: Global logging infrastructure; no domain logic

**Impact:**  
Low. Logger is a utility abstraction with stable interface. High fan-in is expected and healthy. Changes here (new log levels, transport) affect all modules, but interface stability mitigates risk.

**Recommendation:**  
Keep as-is. This is a correct hub — stable, focused on a single concern (structured logging), and provides inversion of control (caller supplies name, caller determines use).

**Effort:** N/A  
**Confidence:** High

---

## F-t1-hub-2: db.ts — Singleton Gateway Hub (Stable but Tight)

**Severity:** Medium  
**Category:** Stable Abstraction  
**Location:** `src/main/db.ts:1-100`  
**Evidence:**  
- Import fan-in: **36 direct imports**
- Exports: `getDb()` singleton, `closeDb()`, `backupDatabase()`, migrations array
- Change frequency: **Very stable** — singleton pattern, migrations are append-only
- Scope: Database connection lifecycle, migration orchestration
- Key consumers: data layer (agent-queries, sprint-queries, event-queries, task-changes), handlers, agent-manager, bootstrap

**Impact:**  
Moderate. Singleton is stable but creates implicit coupling — all data modules depend on global `_db` reference. If `getDb()` signature changes (e.g., to accept schema name), all 36 callers must adapt. Migration failures cascade globally.

**Recommendation:**  
1. Keep singleton pattern (justified for SQLite connection management)
2. Add type-safe schema validation at `getDb()` callsites (prevents schema drift)
3. Document migration strategy clearly — migrations are append-only by design

**Effort:** S  
**Confidence:** High

---

## F-t1-hub-3: Data Layer Facade Through sprint-queries.ts — Accidental Aggregator

**Severity:** High  
**Category:** Barrel Re-export + Volatile Hub  
**Location:** `src/main/data/sprint-queries.ts:1-67`  
**Evidence:**  
- **Purpose:** Intentional facade/barrel (re-exports from 7 focused modules: CRUD, queue, PR ops, agent queries, maintenance, reporting, mapper)
- **Import fan-in:** Directly imported by 30+ files (through `createSprintTaskRepository()` factory or direct imports)
- **Exports:** 60+ named exports covering heterogeneous operations:
  - CRUD: `getTask`, `updateTask`, `createTask`, `deleteTask`
  - Queue: `claimTask`, `releaseTask`, `getQueuedTasks`, `getActiveTaskCount`
  - PR lifecycle: `markTaskDoneByPrNumber`, `listTasksWithOpenPrs`
  - Agent health: `getQueueStats`, `getOrphanedTasks`, `getHealthCheckTasks`
  - Reporting: `getDailySuccessRate`, `getFailureReasonBreakdown`
  - Maintenance: `pruneOldDiffSnapshots`
  - Mapper/Logger utilities
- **Volatility:** **HIGH** — underlying modules (sprint-task-crud.ts, sprint-queue-ops.ts, sprint-agent-queries.ts) change frequently for:
  - Agent lifecycle refactoring (e.g., claim/release semantics)
  - Queue operation tuning
  - Index optimization
- **Files most affected:** agent-manager/run-agent.ts, agent-manager/index.ts, handlers/sprint-local.ts (5 imports each)

**Impact:**  
**Moderate to High coupling risk** due to:
1. Volatility mismatch — the barrel re-exports stable operations (CRUD, get methods) alongside volatile operations (queue claim/release, agent health checks)
2. No semantic grouping — consumers importing both "create task" and "mark done by PR number" have no natural cohesion
3. Refactoring velocity — feature work on queue semantics (e.g., blocking policy changes) forces re-exports to change shape
4. Transactional coupling — handlers import multiple related operations expecting atomicity (e.g., `claimTask` + `updateTask`), but the facade doesn't guarantee transactional safety

**Recommendation:**  
1. **Split into three focused facades:**
   - `sprint-task-queries.ts` (CRUD + list): stable, rarely changes
   - `sprint-queue-queries.ts` (claim/release/stats): volatile, isolated
   - `sprint-reporting-queries.ts` (health checks, reporting): medium stability
2. **Refactor handlers to use `ISprintTaskRepository` interface** (already done in sprint-service.ts, agent-manager) — this is the correct abstraction, but direct imports of sprint-queries in handlers should be eliminated
3. **Document transactional operations** — operations like `claimTask` + field update require explicit transaction guards in caller, not in the data layer

**Effort:** M  
**Confidence:** High

---

## F-t1-hub-4: agent-manager/index.ts — Pipeline Hub Masking Dependency Volcano

**Severity:** High  
**Category:** Hub Module + Volatile Hub  
**Location:** `src/main/agent-manager/index.ts:1-350` (partial view)  
**Evidence:**  
- **Fan-in:** 12 imports (agent-handlers, handlers/workbench, handlers/agent-manager-handlers, tests)
- **Fan-out:** Extremely high — imports from:
  - `./dependency-refresher`, `./terminal-handler`, `./concurrency`, `./watchdog`, `./worktree`, `./orphan-recovery`
  - `./run-agent`, `./task-mapper`, `./circuit-breaker`, `./oauth-checker`, `./watchdog-handler`
  - `../services/dependency-service`, `../services/epic-dependency-service`
  - `../data/sprint-task-repository`, `../settings`, `../paths`, `../logger`, `../agent-event-mapper`
  - Plus 10+ internal sub-modules
- **Exports:** Single `createAgentManager()` factory and `AgentManager` interface; implementation is a 500-line class with 20+ methods
- **Volatility:** **VERY HIGH** — active refactoring of:
  - Concurrency control (slots, backpressure)
  - Dependency resolution (fingerprint caching)
  - Watchdog verdicts and recovery policies
  - Agent spawning and termination

**Impact:**  
**High coupling risk** because:
1. **Facade masking complexity** — single export hides 30+ internal modules and orchestration state
2. **Transitive coupling** — callers depend on AgentManager but must understand internal wiring (concurrency, dependency refresh, metrics) to reason about behavior
3. **Refactoring velocity** — changes to concurrency semantics or watchdog policy ripple through internal modules; external callers can't isolate impact
4. **Testing burden** — tight internal coupling makes unit testing individual agent-manager functions difficult without mocking the entire pipeline

**Recommendation:**  
1. **Split AgentManager into two interfaces:**
   - `AgentManagerControl` (start, stop, steerAgent, killAgent, getStatus)
   - `AgentManagerInternals` (runAgentDeps, metrics, concurrency state) — keep internal only
2. **Extract explicit dependency service** — move dependency-refresher state into a separate service injectable into AgentManager, not internal
3. **Decouple watchdog from main class** — watchdog verdict handling should be a pluggable callback, not tightly coupled logic

**Effort:** L  
**Confidence:** Medium (refactoring scope is large; recommendation assumes no behavioral changes needed)

---

## F-t1-hub-5: handlers/registry.ts — Handler Fan-in Point (Intentional but Validate)

**Severity:** Low  
**Category:** Intentional Facade  
**Location:** `src/main/handlers/registry.ts:1-110`  
**Evidence:**  
- **Import fan-in:** 1 (from index.ts only) — **intentionally designed as single-source-of-truth**
- **Exports:** `registerAllHandlers(deps)` factory function
- **Sub-imports:** 24 handler registration functions
- **Volatility:** **Low** — handlers are stable; new handlers are additions, not refactors

**Impact:**  
Minimal. This is a correct hub — centralized registration point explicitly designed to decouple handler modules from bootstrap logic. Single import site prevents circular dependencies.

**Recommendation:**  
No changes needed. This is a well-designed abstraction. Maintain as central registry for all handler registration.

**Effort:** N/A  
**Confidence:** High

---

## F-t1-hub-6: Data Layer Transitive Coupling — Handlers Reaching Past Repository

**Severity:** Medium  
**Category:** Accidental Aggregator  
**Location:** Multiple handlers: `handlers/sprint-local.ts`, `handlers/agent-handlers.ts`, `handlers/sprint-batch-handlers.ts`  
**Evidence:**  
- **Symptoms:**
  - `handlers/sprint-local.ts` imports 5 separate data modules: sprint-service, agent-queries, task-group-queries, sprint-maintenance-facade, UPDATE_ALLOWLIST from sprint-maintenance-facade
  - `handlers/sprint-batch-handlers.ts` imports both `sprint-task-repository` and directly imports from data/
  - `handlers/agent-handlers.ts` imports `agent-queries` directly, even though agent-manager has its own repository
- **Root cause:** handlers bypass the repository abstraction (ISprintTaskRepository) for specialized operations (getHealthCheckTasks, getAgentLogInfo) not available through the interface
- **Volatility:** Data module changes (schema, performance) affect handlers directly without going through service layer

**Impact:**  
**Moderate coupling risk** because:
1. Handlers are IPC-facing (high volatility) — they handle user requests, which often change
2. Direct imports of data modules mean schema changes leak into handlers
3. Difficult to mock or stub for testing handlers independently

**Recommendation:**  
1. **Extend ISprintTaskRepository** to include `getHealthCheckTasks()`, `getAgentLogInfo()` — these are legitimate data access operations that handlers need
2. **Create a dedicated AgentHistoryRepository** interface for agent-handlers instead of importing agent-history module directly
3. **Refactor sprint-local to use only repository abstraction** — avoid direct imports of sprint-task-types, UPDATE_ALLOWLIST; move those to repository methods

**Effort:** M  
**Confidence:** High

---

## F-t1-hub-7: Agent Event Emitter — Dual Write Pattern Coupling

**Severity:** Medium  
**Category:** Volatile Hub  
**Location:** `src/main/agent-event-mapper.ts:1-173`  
**Evidence:**  
- **Imports:** Only 4 files directly (run-agent.ts, adhoc-agent.ts, agent-manager/index.ts, adhoc-agent.ts)
- **But:** This module orchestrates **two critical paths:**
  - Batch write to SQLite via `insertEventBatch()`
  - Broadcast via IPC to renderer
- **Volatility:** **Medium** — batch size, flush interval, and error handling tuned frequently
- **Change vectors:**
  - Event schema changes (new event types)
  - Batch size tuning (performance)
  - SQLite write failure recovery
- **Coupling:** Both run-agent and adhoc-agent depend on this module for event persistence and renderer notifications — if it fails, agents lose visibility

**Impact:**  
**Moderate risk** because:
1. **Dual write coupling** — SQLite and IPC must stay in sync; failures in one path can create data loss
2. **Rate limiting** — batch flushes on interval or size can cause event lag; tuning affects perceived responsiveness
3. **Error recovery** — circuit breaker logic is custom (MAX_CONSECUTIVE_FAILURES, event drop cap) — if incorrect, events silently disappear

**Recommendation:**  
1. **Separate concerns:**
   - Create `agent-event-persister.ts` for SQLite write logic (async, can fail)
   - Keep `agent-event-emitter.ts` for immediate broadcast (sync, should not fail)
2. **Add metrics:** track batch flush latency, failure count, event drop rate — expose via metrics collector (already exists in agent-manager)
3. **Document batch behavior:** clarify that events are durable to SQLite but broadcast is best-effort (not guaranteed if flush fails)

**Effort:** M  
**Confidence:** Medium (requires understanding of event semantics; ensure no breaking changes to event schema)

---

## F-t1-hub-8: Settings Module — Global Configuration Hub

**Severity:** Low  
**Category:** Stable Abstraction  
**Location:** `src/main/settings.ts` and `src/main/data/settings-queries.ts`  
**Evidence:**  
- **Import fan-in:** 47 files (getSetting, getSettingJson)
- **Exports:** `getSetting(key)`, `getSettingJson(key)` — key-value getters
- **Change frequency:** **Very stable** — interface unchanged; new settings are additions
- **Scope:** Read-only access to settings store; no domain logic

**Impact:**  
Low. Like logger, this is a justified hub. High fan-in is acceptable for a stable, focused utility. Settings are rarely changed at runtime.

**Recommendation:**  
No changes needed. This is a healthy hub module — focused, stable, expected high fan-in.

**Effort:** N/A  
**Confidence:** High

---

## Cross-Cutting Patterns & Risks

### 1. Data Module Volatility Spiral
**Risk:** `sprint-task-crud.ts`, `sprint-queue-ops.ts`, `sprint-agent-queries.ts` change frequently (task claim semantics, queue state machine, orphan recovery). Each change potentially affects:
- Handlers that import `sprint-queries` barrel
- Services that delegate to repository
- Agent-manager that reads/writes task state
- Tests that mock data modules

**Mitigation:** Enforce strict backwards compatibility in sprint-queries exports. New operations should be additive, not shape-changing.

### 2. Agent-Manager as Black Box
**Risk:** Agent-manager couples 10+ internal modules (dependency-refresher, watchdog, circuit-breaker, etc.) into a single facade. Callers can't reason about failure modes or performance without reading internal code.

**Mitigation:** Extract key internal services (dependency index, metrics, circuit breaker state) into explicit, injectable interfaces. Allow callers to reason about behavior without source code archaeology.

### 3. Handler-to-Data Layer Boundary Violations
**Risk:** Handlers reach past repository abstraction into data modules directly, creating hidden coupling to schema changes. Repository abstraction exists but is selectively bypassed.

**Mitigation:** Audit all handler imports — any import of `/data/` modules (except sprint-task-repository.ts) should be justified or refactored into repository methods.

---

## Summary Table

| Finding | Module | Severity | Category | Fan-in | Change Risk | Recommendation |
|---------|--------|----------|----------|--------|-------------|-----------------|
| F-t1-hub-1 | logger.ts | Medium | Stable Hub | 72 | Low | Keep; exemplar of good hub |
| F-t1-hub-2 | db.ts | Medium | Stable Hub | 36 | Low | Document migration strategy |
| F-t1-hub-3 | sprint-queries.ts | High | Volatile Barrel | 30+ | High | Split into 3 focused facades |
| F-t1-hub-4 | agent-manager/index.ts | High | Volatile Hub | 12 | Very High | Extract internal services |
| F-t1-hub-5 | handlers/registry.ts | Low | Intentional | 1 | Low | Keep; good design |
| F-t1-hub-6 | handlers → data | Medium | Boundary Violation | N/A | Medium | Extend repository interface |
| F-t1-hub-7 | agent-event-mapper.ts | Medium | Volatile | 4 | Medium | Separate persistence & broadcast |
| F-t1-hub-8 | settings.ts | Low | Stable Hub | 47 | Low | Keep; exemplar of good hub |

---

## Recommendations Priority

### Immediate (P1 — Risk Reduction)
1. **F-t1-hub-3:** Split sprint-queries.ts into focused facades (reduces ripple risk in feature work)
2. **F-t1-hub-6:** Extend repository interface to eliminate handler bypass imports (protects handlers from schema volatility)

### Short-term (P2 — Clarity)
3. **F-t1-hub-4:** Extract agent-manager internal services into injectable interfaces (improves testability, reduces coupling)
4. **F-t1-hub-7:** Separate agent event persister from broadcaster (clarifies failure semantics)

### Ongoing (P3 — Maintenance)
5. Document sprint-queries volatility in CLAUDE.md; flag refactorings for team awareness
6. Add metrics to agent-event-mapper (watch for drop rates, flush latency)
7. Add backwards-compatibility checks to sprint-queries exports in pre-commit hooks

---

## Acknowledgments

- **Baseline issues noted:** sdk-adapter.ts and adhoc-agent.ts are in flux (SDK options fix) — coupling found in these modules should be re-audited after stabilization
- **Repository abstraction credit:** ISprintTaskRepository is a well-designed facade; recommend extending rather than bypassing
- **Agent-manager refactoring credit:** concurrency, dependency-refresher, and watchdog are complex but cohesive; recommend extraction as injectable services rather than split

