# Clean Architecture Refactoring Spec

**Date:** 2026-03-20
**Source:** Clean Architecture Audit (docs/clean-architecture-audit-2026-03-20.md)
**Goal:** Fix all audit findings across 3 tiers — type safety, structural splits, and architectural improvements.

---

## Tier 1: Quick Wins (High Impact, Low Effort)

### 1.1 Move AgentEvent types to shared/

**Problem:** `AgentEvent`, `AgentEventType`, `AgentSpawnOptions`, `AgentHandle`, `AgentProvider` are defined in `src/main/agents/types.ts`. This causes 8 dependency-direction violations where shared/, preload/, and renderer/ import from main/.

**Fix:**

- Move all types from `src/main/agents/types.ts` to `src/shared/types.ts`
- Delete `src/main/agents/types.ts` (or keep as re-export barrel)
- Update all 8+ imports across: `src/shared/ipc-channels.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, renderer stores/components, `src/main/agent-manager/agent-manager.ts`, `src/main/agents/event-bus.ts`, etc.

### 1.2 Type AgentManagerDeps contract

**Problem:** `AgentManagerDeps.updateTask` and `handleCompletion` use `Record<string, unknown>` — erasing type safety near dynamic SQL.

**Fix:**

- Define `TaskUpdate` type with fields from `UPDATE_ALLOWLIST` + `error`, `started_at`, `completed_at`
- Type `handleCompletion` to accept `CompletionContext` (already defined in completion-handler.ts) instead of `Record<string, unknown>`
- Update `emitEvent` from `(agentId: string, event: unknown)` to `(agentId: string, event: AgentEvent)`

### 1.3 Extract raw SQL from index.ts into data layer

**Problem:** `src/main/index.ts:150-181` contains two inline `db.prepare()` lambdas that duplicate the SQL update pattern from `data/sprint-queries.ts` and bypass the UPDATE_ALLOWLIST.

**Fix:**

- Add `getQueuedTasks(db)` function to `data/sprint-queries.ts`
- Use existing `updateTask(db, id, patch)` from `data/sprint-queries.ts` (which enforces the allowlist) in the AgentManager dep wiring
- Remove inline SQL from index.ts

### 1.4 Fix `replacLeafWithSplit` typo

**Problem:** Function named `replacLeafWithSplit` (missing 'e') in `panelLayout.ts:244`, called from 4 locations.

**Fix:** Rename to `replaceLeafWithSplit` in all locations within the file.

### 1.5 Extract MAX_BUFFER constant in git.ts

**Problem:** `10 * 1024 * 1024` repeated 8 times in git.ts. `fs.ts` defines `MAX_READ_BYTES` for the same value.

**Fix:** Define `const MAX_BUFFER = 10 * 1024 * 1024` at top of git.ts, replace all 8 occurrences.

### 1.6 Remove duplicate `isKnownAgentPid`

**Problem:** `isAgentInteractive` and `isKnownAgentPid` in local-agents.ts are identical functions.

**Fix:** Delete `isKnownAgentPid`, keep `isAgentInteractive`. Update any callers.

---

## Tier 2: Structural Splits (High Impact, Medium Effort)

### 2.1 Split git.ts into focused modules

**Problem:** git.ts has 4 concerns: local git CLI ops, GitHub REST PR status polling, conflict detection, and repo path lookup.

**Fix:**

- Keep `src/main/git.ts` for local git operations (status, diff, stage, unstage, commit, push, branches, checkout)
- Extract `src/main/github-pr-status.ts` for `fetchPrStatusRest`, `pollPrStatuses`, `PrStatusInput`, `PrStatusResult`
- Extract `src/main/github-conflict-check.ts` for `checkConflictFiles`, `ConflictFilesInput`, `ConflictFilesResult`
- `getRepoPaths` stays as a 1-line re-export in git.ts (or move callers to import from paths.ts directly)
- Update all imports in handlers, pollers, etc.

### 2.2 Split local-agents.ts into focused modules

**Problem:** local-agents.ts has 6 concerns: spawning, event consumption, log tailing, log cleanup, PID tracking, cost extraction.

**Fix:**

- Keep `src/main/local-agents.ts` for: spawn, kill, steer, sendTo, PID maps, and the re-exports from agent-scanner
- Extract `src/main/agent-cost-parser.ts` for `extractAgentCost`, `AgentCost`, `updateAgentRunCost`
- Extract `src/main/agent-log-manager.ts` for `tailAgentLog`, `cleanupOldLogs`, `TailLogArgs`, `TailLogResult`
- `consumeEvents` stays in local-agents.ts (tightly coupled to spawn lifecycle and PID maps)
- Update imports in handlers/agent-handlers.ts and wherever cost/log functions are used

### 2.3 Inject deps into sprint-pr-poller.ts

**Problem:** Imports from handler layer (`handlers/sprint-local`) — wrong dependency direction. Module-level state makes it untestable.

**Fix:**

- Define `SprintPrPollerDeps` interface:
  ```ts
  interface SprintPrPollerDeps {
    listTasksWithOpenPrs: () => SprintTask[]
    pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
    markTaskDoneByPrNumber: (prNumber: number) => void
    markTaskCancelledByPrNumber: (prNumber: number) => void
    updateTaskMergeableState: (prNumber: number, state: string | null) => void
  }
  ```
- `createSprintPrPoller(deps)` factory returns `{ start(), stop() }`
- Wire deps in `index.ts` using sprint-local wrappers (which already delegate to data layer)
- Old `startSprintPrPoller`/`stopSprintPrPoller` become the factory-created instance

### 2.4 Inject broadcast into event-bus.ts

**Problem:** event-bus.ts imports `broadcast` from `../broadcast` — permanently coupling the event bus to Electron's BrowserWindow.

**Fix:**

- Add `notify?: (channel: string, data: unknown) => void` to `createEventBus` options
- Default to `broadcast` when not provided (backwards compat)
- In tests, pass `notify: vi.fn()` to decouple from Electron

### 2.5 Inject VCS abstraction into completion-handler.ts

**Problem:** `pushBranchAndOpenPr` hardcodes `execFileAsync('git'/'gh')` — inconsistent with AgentManager's DI.

**Fix:**

- Define `VcsOps` interface:
  ```ts
  interface VcsOps {
    pushBranch: (cwd: string, branch: string) => Promise<void>
    createPr: (
      cwd: string,
      ghRepo: string,
      branch: string
    ) => Promise<{ prUrl: string | null; prNumber: number | null }>
    getActualBranch: (cwd: string) => Promise<string>
    removeWorktree: (repoPath: string, worktreePath: string) => Promise<void>
  }
  ```
- `handleAgentCompletion` takes `vcs: VcsOps` parameter (or add to CompletionContext)
- Default implementation wraps the existing `execFileAsync` calls
- Wire in index.ts when constructing the AgentManager deps

---

## Tier 3: Architectural (Structural)

### 3.1 Segregate IpcChannelMap by domain

**Problem:** Monolithic `IpcChannelMap` with ~50 entries — all consumers pull the entire map.

**Fix:**

- Split into domain maps: `SettingsChannels`, `GitChannels`, `PrChannels`, `AgentChannels`, `SprintChannels`, `CostChannels`, `MemoryChannels`, `FsChannels`, `TerminalChannels`, `AuthChannels`, `AgentManagerChannels`, `TemplateChannels`, `WindowChannels`
- Compose: `type IpcChannelMap = SettingsChannels & GitChannels & PrChannels & ...`
- Backward compatible — `IpcChannelMap` stays as the union type
- Each domain map is independently importable

### 3.2 Extract bootstrap module from index.ts

**Problem:** `app.whenReady()` in index.ts has 5 distinct responsibilities.

**Fix:**

- Extract `src/main/bootstrap.ts` with:
  - `bootstrapDatabase()` — getDb() + startDbWatcher()
  - `bootstrapPollers()` — startPrPoller() + startSprintPrPoller()
  - `bootstrapHandlers()` — all registerXHandlers() calls
  - `bootstrapAgentManager()` — SdkProvider, EventBus, AgentManager construction
  - `bootstrapCsp()` — session.defaultSession.webRequest.onHeadersReceived
- index.ts becomes pure orchestration: call bootstrap functions in order

### 3.3 Convert UnifiedAgent to discriminated union

**Problem:** `UnifiedAgent` carries optional fields from both `local` and `history` sources.

**Fix:**

- Define:
  ```ts
  interface UnifiedAgentBase {
    id: string
    label: string
    status: UnifiedAgentStatus
    model: string
    updatedAt: number
    startedAt: number
  }
  interface LocalAgent extends UnifiedAgentBase {
    source: 'local'
    pid: number
    canSteer: boolean
    canKill: boolean
    isBlocked?: boolean
    task?: string
  }
  interface HistoryAgent extends UnifiedAgentBase {
    source: 'history'
    historyId: string
    sessionKey?: string
  }
  type UnifiedAgent = LocalAgent | HistoryAgent
  ```
- Update consumers to use discriminated union narrowing instead of optional checks

### 3.4 Add CredentialStore abstraction for auth-guard

**Problem:** `auth-guard.ts` hardcodes macOS `security` command. Can't unit test without OS mocking. Can't port to Linux.

**Fix:**

- Define:
  ```ts
  interface CredentialStore {
    readToken(): Promise<KeychainPayload | null>
    detectCli(): boolean
  }
  ```
- `MacOSCredentialStore` implements it with existing `security` + `existsSync` logic
- `checkAuthStatus(store: CredentialStore)` accepts the abstraction
- `ensureSubscriptionAuth(store?: CredentialStore)` defaults to MacOS implementation
- Tests can pass a mock CredentialStore

---

## Execution Order

1. **Tier 1** (all items) — independent of each other, can be done in parallel
2. **Tier 2.1 + 2.2** (file splits) — must happen before 2.3 since sprint-pr-poller imports from git.ts
3. **Tier 2.3 + 2.4 + 2.5** (DI patterns)
4. **Tier 3** (architectural) — builds on clean foundations from Tier 1+2

## Verification

After each tier: `npm run typecheck && npm test && npm run test:main`
