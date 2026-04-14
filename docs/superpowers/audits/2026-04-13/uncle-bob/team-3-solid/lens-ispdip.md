# ISP + DIP Audit: Team 3 SOLID
**Date:** 2026-04-13  
**Auditor:** Claude Code  
**Scope:** Interface Segregation Principle (ISP) and Dependency Inversion Principle (DIP) violations

---

## F-t3-ispdip-1: Fat Preload Bridge Exposes Entire Platform API
**Severity:** Critical  
**Category:** ISP  
**Location:** `src/preload/index.ts:27-542`  
**Evidence:**
```typescript
const api = {
  readClipboardImage: () => ...,
  getRepoPaths: () => ...,
  openExternal: (url: string) => ...,
  settings: { get, set, getJson, setJson, delete, saveProfile, ... },
  claudeConfig: { get, setPermissions },
  webhooks: { list, create, update, delete, test },
  github: { fetch, isConfigured },
  gitStatus, gitDiff, gitStage, gitUnstage, gitCommit, gitPush, gitBranches, ...,
  sprint: { list, create, createWorkflow, claimTask, update, ... [15+ methods] },
  groups: { create, list, get, update, delete, ... [8+ methods] },
  agentManager: { status, kill, getMetrics, reloadConfig, checkpoint },
  terminal: { create, write, resize, kill, onData, onExit },
  review: { getDiff, getCommits, createPr, shipIt, ... [12+ methods] },
  workbench: { generateSpec, checkSpec, chatStream, ... },
  dashboard: { completionsPerHour, recentEvents, dailySuccessRate },
  // ... 30+ top-level methods and 15+ namespaced groups
}
```
**Impact:** Every renderer component depends on the entire 557-line API surface, even if it only needs 1-2 methods. Changes to unrelated APIs ripple to all consumers. Testing requires mocking the entire bridge. Cognitive load when importing `window.api`.
**Recommendation:** Segregate the API into focused facades:
- `window.api.sprint` — sprint task operations only
- `window.api.git` — git operations only  
- `window.api.terminal` — terminal operations only  
- `window.api.review` — code review operations only  
- `window.api.config` — settings/config operations only

Keep only truly global, frequently-used methods at the top level (e.g., `openExternal`). Components importing `window.api.sprint` should NOT be coupled to `window.api.review`.
**Effort:** L  
**Confidence:** High  

---

## F-t3-ispdip-2: Sprint Handler Directly Imports and Calls `getDb()` Instead of Receiving It
**Severity:** High  
**Category:** DIP  
**Location:** `src/main/handlers/sprint-local.ts:1-2`  
**Evidence:**
```typescript
import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'  // <-- Direct module-level import
```
And later uses it indirectly through services. The handler should NOT import concrete `getDb`; the dependency wiring happens in `index.ts`.
**Impact:** Handler is tightly coupled to the db module. Cannot test with a mock database. If db initialization changes, handler breaks. High-level handler logic depends on low-level db details.
**Recommendation:** Remove `import { getDb }`. If the handler needs raw db access, it should receive a `Database` instance injected via `HandlerDeps`. Currently the handler gets `repo: ISprintTaskRepository` which is correct, but the orphaned `getDb` import suggests incomplete DIP refactoring.
**Effort:** S  
**Confidence:** High  

---

## F-t3-ispdip-3: Sprint Batch Handlers Read Settings Directly Instead of Receiving Configuration
**Severity:** High  
**Category:** DIP  
**Location:** `src/main/handlers/sprint-batch-handlers.ts:12`  
**Evidence:**
```typescript
export function registerSprintBatchHandlers(deps: BatchHandlersDeps): void {
  // ... later ...
}
// Inside handler:
const maxCostUsd = await getSettingJson<number>('agentManager.maxCostUsd')
```
The handler calls `getSettingJson` directly instead of receiving the value via dependency injection.
**Impact:** Handler couples to the settings module implementation. Configuration becomes implicit and scattered across handler code. Hard to inject test values without mocking the entire settings module. Violates control inversion—handler pulls config instead of receiving it.
**Recommendation:** Add settings values to `BatchHandlersDeps`:
```typescript
export interface BatchHandlersDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  repo?: ISprintTaskRepository
  maxCostUsd?: number  // Injected from index.ts
  maxRuntimeMs?: number
}
```
Callers in `index.ts` read settings once and pass them down.
**Effort:** S  
**Confidence:** High  

---

## F-t3-ispdip-4: Sprint Mutations Creates Repository Singleton at Module Level
**Severity:** High  
**Category:** DIP  
**Location:** `src/main/services/sprint-mutations.ts:23`  
**Evidence:**
```typescript
const repo: ISprintTaskRepository = createSprintTaskRepository()

export function getTask(id: string): SprintTask | null {
  return repo.getTask(id)
}
// ... all other exported functions use this singleton
```
The module instantiates its own repository instead of receiving it. This is a hidden dependency.
**Impact:** Cannot swap the repository implementation for testing (e.g., in-memory mock). All code calling `sprint-mutations` functions gets the same global repository. If the repository needs context (e.g., per-request database connection), it's impossible to provide. Functions hide their dependency—callers don't know they depend on a repository.
**Recommendation:** Export functions that accept a repository parameter OR make the repository injectable at initialization:
```typescript
let repo: ISprintTaskRepository

export function initSprintMutations(r: ISprintTaskRepository) {
  repo = r
}

export function getTask(id: string): SprintTask | null {
  if (!repo) throw new Error('Sprint mutations not initialized')
  return repo.getTask(id)
}
```
Or prefer the first approach for clarity: pass repo as first argument to each function.
**Effort:** M  
**Confidence:** High  

---

## F-t3-ispdip-5: Agent Manager Directly Reads Settings Instead of Receiving Configuration
**Severity:** High  
**Category:** DIP  
**Location:** `src/main/agent-manager/index.ts:34, 736-764`  
**Evidence:**
```typescript
import { getSetting, getSettingJson } from '../settings'

// In reloadConfig():
const newMaxConcurrent = getSettingJson<number>('agentManager.maxConcurrent')
const newMaxRuntimeMs = getSettingJson<number>('agentManager.maxRuntimeMs')
const newDefaultModel = getSetting('agentManager.defaultModel')
const newWorktreeBase = getSetting('agentManager.worktreeBase')
```
The agent manager has `config: AgentManagerConfig` injected in the constructor, but in `reloadConfig()` it reads from the settings module directly instead of receiving updated config.
**Impact:** Agent manager is coupled to the settings module API. In tests, cannot provide test settings without mocking. The settings file becomes a hidden dependency that's not obvious from the constructor signature. Splitting reads across constructor and method obscures the actual dependencies.
**Recommendation:** Provide a callback to re-read settings instead of importing directly:
```typescript
export interface AgentManagerConfig {
  maxConcurrent: number
  // ...
  onConfigReload?: () => Partial<AgentManagerConfig>
}

reloadConfig(): { updated: string[]; requiresRestart: string[] } {
  const newSettings = this.config.onConfigReload?.()
  if (!newSettings) return { updated: [], requiresRestart: [] }
  // Apply newSettings to this.config
}
```
Or pass a settings accessor: `readSetting: (key: string) => string | null` in the deps.
**Effort:** M  
**Confidence:** High  

---

## F-t3-ispdip-6: Fat `ISprintTaskRepository` Interface Violates Interface Segregation
**Severity:** Medium  
**Category:** ISP  
**Location:** `src/main/data/sprint-task-repository.ts:36-95`  
**Evidence:**
```typescript
export interface IAgentTaskRepository {
  getTask(id: string): SprintTask | null
  updateTask(id: string, patch: Record<string, unknown>): SprintTask | null
  getQueuedTasks(limit: number): SprintTask[]
  // ... 6 more methods
}

export interface ISprintPollerRepository {
  markTaskDoneByPrNumber(prNumber: number): string[]
  markTaskCancelledByPrNumber(prNumber: number): string[]
  listTasksWithOpenPrs(): SprintTask[]
  // ... 1 more method
}

export interface IDashboardRepository {
  listTasks(status?: string): SprintTask[]
  listTasksRecent(): SprintTask[]
  // ... 8 more methods
}

export interface ISprintTaskRepository
  extends IAgentTaskRepository, ISprintPollerRepository, IDashboardRepository {}
```
A client needing only `getQueuedTasks` (agent manager) must depend on 20+ methods it doesn't use.
**Impact:** Clients cannot express "I only need agent operations" — they import the fat interface. Changes to dashboard queries ripple to agent manager code, even though it's unrelated. Interface documentation doesn't clarify what each client needs.
**Recommendation:** Keep the segregated interfaces (`IAgentTaskRepository`, `ISprintPollerRepository`, `IDashboardRepository`) but have callers depend on the specific interface they need:
- Agent manager receives `IAgentTaskRepository`  
- PR poller receives `ISprintPollerRepository`  
- Dashboard handlers receive `IDashboardRepository`

Do NOT create `ISprintTaskRepository` that unions all three. If composition is needed in a single call site, that's a hint that the interfaces are not properly segregated.
**Effort:** M  
**Confidence:** High  

---

## F-t3-ispdip-7: Handler Registration Couples to Concrete Repository Factory
**Severity:** Medium  
**Category:** DIP  
**Location:** `src/main/handlers/sprint-local.ts:48-49`  
**Evidence:**
```typescript
export function registerSprintLocalHandlers(deps: SprintLocalDeps, repo?: ISprintTaskRepository): void {
  const effectiveRepo = repo ?? createSprintTaskRepository()  // <-- Falls back to concrete factory
```
If the caller doesn't pass a repo, the handler creates its own. This is a backdoor dependency.
**Impact:** In production, handlers use the factory (fine). In tests, if a test forgets to pass a mock repo, the handler silently creates a real one, defeating test isolation. The optional parameter creates two code paths.
**Recommendation:** Make the repo parameter required and always pass it from `index.ts`:
```typescript
export function registerSprintLocalHandlers(
  deps: SprintLocalDeps,
  repo: ISprintTaskRepository
): void {
  // repo is now always provided
}

// In index.ts:
const repo = createSprintTaskRepository()
registerSprintLocalHandlers(terminalDeps, repo)
```
**Effort:** S  
**Confidence:** High  

---

## F-t3-ispdip-8: Agent Manager Completion Module Dynamically Imports Settings
**Severity:** Medium  
**Category:** DIP  
**Location:** `src/main/agent-manager/completion.ts:114-115, 203-204`  
**Evidence:**
```typescript
const { getSettingJson } = await import('../settings')
const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')

// Later:
const { getSettingJson } = await import('../settings')
const rules = getSettingJson<AutoReviewRule[]>('autoReview.rules')
```
The module dynamically imports settings instead of receiving values via parameters.
**Impact:** Hidden dependency—callers don't see that completion logic needs settings. Async imports inside functions are unusual and suggest incomplete DIP. Hard to test because you can't provide mock settings without module mocking.
**Recommendation:** Pass settings as parameters to the completion functions or accept a settings reader interface:
```typescript
interface SettingsReader {
  getJson<T>(key: string): T | null
}

export async function getReposForCompletion(settingsReader: SettingsReader): Promise<...> {
  const repos = settingsReader.getJson<...>('repos')
  // ...
}
```
**Effort:** M  
**Confidence:** Medium  

---

## F-t3-ispdip-9: Zustand Store `sprintTasks` Hides Dependency on `window.api`
**Severity:** Medium  
**Category:** DIP  
**Location:** `src/renderer/src/stores/sprintTasks.ts:62-65`  
**Evidence:**
```typescript
loadData: async (): Promise<void> => {
  set({ loadError: null, loading: true })
  try {
    const result = (await window.api.sprint.list()) as SprintTask[]
```
The store directly calls `window.api` instead of receiving it via a parameter or context.
**Impact:** Store is coupled to the global `window.api` object. Cannot test without a real window object. If the API changes shape, the store breaks. The dependency is implicit.
**Recommendation:** Inject the API client:
```typescript
export interface CreateSprintTasksStoreParams {
  apiClient: typeof window.api
  logger?: Logger
}

export const useSprintTasks = (params: CreateSprintTasksStoreParams) =>
  create<SprintTasksState>((set, get) => ({
    loadData: async () => {
      const result = await params.apiClient.sprint.list()
      // ...
    }
  }))

// In app initialization:
const sprintTasksStore = useSprintTasks({ apiClient: window.api })
```
**Effort:** M  
**Confidence:** Medium  

---

## F-t3-ispdip-10: Preload API Bundles Unrelated Concerns (Settings + Webhooks + GitHub)
**Severity:** Medium  
**Category:** ISP  
**Location:** `src/preload/index.ts:43-77, 63-77`  
**Evidence:**
```typescript
settings: {
  get, set, getJson, setJson, delete,
  saveProfile, loadProfile, applyProfile, listProfiles, deleteProfile
},
claudeConfig: { get, setPermissions },
webhooks: {
  list, create, update, delete, test
},
github: { fetch, isConfigured }
```
Settings, webhooks, and GitHub API are bundled together under `api` without logical grouping. A component fetching GitHub issues shouldn't implicitly couple to webhook operations.
**Impact:** Fine-grained coupling in renderer code. Any component using `window.api.github` also drags in knowledge of `window.api.webhooks`. Cognitive load when developers reason about dependencies.
**Recommendation:** Logically group related operations:
```typescript
const api = {
  git: { status, diff, stage, commit, push, branches, checkout, detectRemote, fetch, pull },
  github: { fetch, isConfigured },
  sprint: { list, create, claimTask, update, ... },
  review: { getDiff, getCommits, createPr, shipIt, ... },
  config: {
    settings: { get, set, getJson, setJson, delete, saveProfile, loadProfile, ... },
    webhooks: { list, create, update, delete, test },
    claudeConfig: { get, setPermissions }
  },
  // ...
}
```
Or expose narrower facades for high-level concerns.
**Effort:** L  
**Confidence:** Medium  

---

## Summary

| Finding | Category | Severity | Effort |
|---------|----------|----------|--------|
| F-t3-ispdip-1: Fat Preload Bridge | ISP | Critical | L |
| F-t3-ispdip-2: Handler Imports getDb | DIP | High | S |
| F-t3-ispdip-3: Batch Handlers Read Settings | DIP | High | S |
| F-t3-ispdip-4: Sprint Mutations Singleton | DIP | High | M |
| F-t3-ispdip-5: Agent Manager Settings Coupling | DIP | High | M |
| F-t3-ispdip-6: Fat ISprintTaskRepository | ISP | Medium | M |
| F-t3-ispdip-7: Handler Falls Back to Factory | DIP | Medium | S |
| F-t3-ispdip-8: Dynamic Settings Import | DIP | Medium | M |
| F-t3-ispdip-9: Zustand Hides API Dependency | DIP | Medium | M |
| F-t3-ispdip-10: Preload API Mixes Concerns | ISP | Medium | L |

**Key Patterns:**

1. **High-level code reaching down to low-level modules:** Handlers import `getDb` and `getSetting` directly instead of receiving them.
2. **Hidden module-level dependencies:** Singleton repositories and settings readers created at import time.
3. **Fat interfaces masking segregation:** `ISprintTaskRepository` combines 20+ methods; clients shouldn't depend on all of them.
4. **Preload bridge as a god object:** 557 lines bundling platform capabilities with no clear client boundaries.

**Recommended Quick Wins (High Impact, Low Effort):**
- Remove orphaned `getDb` import from `sprint-local.ts` (F-t3-ispdip-2)
- Make `repo` parameter required in handler registration (F-t3-ispdip-7)
- Add configuration values to `BatchHandlersDeps` (F-t3-ispdip-3)

**Strategic Improvements (Reduce Coupling Over Time):**
- Segregate `ISprintTaskRepository` into focused role interfaces (F-t3-ispdip-6)
- Refactor `sprint-mutations.ts` to accept injected repository (F-t3-ispdip-4)
- Create focused facades for preload API (F-t3-ispdip-1, F-t3-ispdip-10)
