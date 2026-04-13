# Architectural Engineer — Team Gamma (Full Pass) — BDE Audit 2026-04-07

## Summary

BDE has matured rapidly: a real repository pattern, a typed IPC channel map, a single `safeHandle()` wrapper, a centralised SQLite migration history, and a unified `TaskTerminalService` show genuine architectural intent. But the cross-cutting infrastructure has not kept up with the velocity of feature work. The IPC surface has crossed ~144 typed channels with no domain quarantine; the migration history is paying for two reversals (Supabase round-trip) and 35 in-place table rewrites; the data layer has three nominally-separate access points (sprint-queries, sprint-service, sprint-task-repository) that are all routinely imported in parallel; the TaskTerminalService is wired through four module-level setters from `index.ts` instead of being injected; and the architecture doc is months out of date in ways that will actively mislead a new contributor. None of this is on fire, but it is the kind of debt that compounds quickly over the next 6 months.

## Findings

### [CRITICAL] Repository pattern is bypassed almost everywhere it should be used

- **Category:** Inconsistent Pattern / Coupling
- **Location:** `src/main/data/sprint-task-repository.ts:1`, `src/main/handlers/sprint-local.ts:25-46`, plus 45 other files
- **Observation:** `ISprintTaskRepository` exists and CLAUDE.md says "Agent manager data access: always through `ISprintTaskRepository`, never direct sprint-queries imports." Reality: 45 files in `src/main` import from `sprint-queries` directly, including `index.ts:48`, `pr-poller`, `dashboard-handlers`, `review.ts`, `workbench.ts`, `agent-history.ts`, and even `sprint-local.ts` which simultaneously imports from `sprint-queries`, `sprint-service`, AND constructs a `createSprintTaskRepository()` (line 46). The repository injection is only honoured by the `agent-manager` constructor — everywhere else takes the shortest path.
- **Why it matters:** The whole reason for the abstraction (testability, single writer discipline, future swap-out) is undermined. New contributors will model their code on existing handlers, which means new code will also bypass the repository, and the pattern decays into a documentation lie.
- **Recommendation:** Either (a) commit to the repository pattern by deleting `sprint-queries`'s public exports and routing everything through `sprint-service` + repository, OR (b) admit defeat, delete `sprint-task-repository.ts`, and update CLAUDE.md. The current half-state is the worst of both worlds.

### [CRITICAL] Three overlapping data-access layers for sprint tasks

- **Category:** Coupling / Onboarding Risk
- **Location:** `src/main/data/sprint-queries.ts` (1157 lines), `src/main/services/sprint-service.ts`, `src/main/data/sprint-task-repository.ts`
- **Observation:** A single sprint task can be read/written via (1) `sprint-queries.ts` directly, (2) `sprint-service.ts` (which wraps queries with notification side-effects), (3) `ISprintTaskRepository` (which delegates to queries but skips the service wrapper). `sprint-local.ts` imports from all three in the same file. The "single writer" promise relies on developers picking the right one, with no compiler enforcement.
- **Why it matters:** Bypassing `sprint-service` skips `notifySprintMutation()` and audit-trail side-effects. Bypassing the repository skips the swap-point. There is no way to look at a function call and know which invariants it preserves.
- **Recommendation:** Collapse to two layers: a private `sprint-queries` (not exported from package boundary) and a public `sprint-service` that is the only entry point. The repository interface should _be_ the service, not a third sibling.

### [CRITICAL] `index.ts` wires `TaskTerminalService` through four module-level setters

- **Category:** Coupling / Fragility
- **Location:** `src/main/index.ts:146-149`, `src/main/handlers/sprint-local.ts:77`, `src/main/handlers/git-handlers.ts:138`, `src/main/handlers/review.ts:29`, `src/main/sprint-pr-poller.ts:110`
- **Observation:** Four separate modules export a `setOnStatusTerminal(fn)` mutator and `index.ts` calls all four with the same callback at startup. Each handler module holds a mutable nullable `_onStatusTerminal` and silently no-ops if the wiring is missed. This is the canonical service-locator anti-pattern with zero compile-time safety.
- **Why it matters:** A new handler that needs terminal-resolution gets added with its own setter, multiplying the wiring. Forgetting one call silently breaks dependency resolution (the very thing CLAUDE.md flags as needing care). Tests must remember to call the setter or get a no-op. There is no single seam to swap out for testing.
- **Recommendation:** Make `registerXxxHandlers(deps)` take a deps object containing `onStatusTerminal`. Pass it explicitly. Delete the four module-level mutables. This is ~40 lines of mechanical change with a large readability win.

### [MAJOR] IPC surface is ~144 channels with no domain quarantine

- **Category:** IPC Topology / Onboarding Risk
- **Location:** `src/shared/ipc-channels.ts` (888 lines, 26 domain interfaces composed via intersection)
- **Observation:** 26 domain interfaces flattened into one `IpcChannelMap`. Sprint alone exposes 21 channels (`sprint:list`, `sprint:create`, `sprint:update`, `sprint:retry`, `sprint:batchUpdate`, `sprint:exportTasks`, `sprint:failureBreakdown`, `sprint:getSuccessRateBySpecType`, `sprint:burndown`, …). Some channels overlap conceptually (e.g. `sprint:update` vs `sprint:batchUpdate` vs `sprint:unblockTask` vs `sprint:retry` — all just patches with side-effects). `agents:promoteToReview` lives next to `review:createPr`. Window/playground/tearoff channels are split across `WindowChannels`, `PlaygroundChannels`, `TearoffChannels` even though they all touch BrowserWindow.
- **Why it matters:** A new contributor cannot grok the surface in one sitting. Channel naming follows no convention (sometimes `domain:verb`, sometimes `domain:verbNoun`, sometimes `verb:noun`). Renderer code reaches for the lowest-friction channel rather than the right one — leading to features that drift away from the "single writer" model.
- **Recommendation:** Audit channels by usage; collapse `sprint:*` patch variants into one with explicit operation types; document a naming convention; physically split `ipc-channels.ts` into one file per domain with a barrel re-export, so the topology is browseable.

### [MAJOR] Database migration discipline has visible scar tissue

- **Category:** Fragility
- **Location:** `src/main/db.ts:89-887`
- **Observation:** 35 migrations. v6 creates `sprint_tasks`, v12 drops it ("tasks now live in Supabase"), v15 recreates it ("migrating back from Supabase to local SQLite"). v9, v10, v17, v20 all do full table rewrites just to alter a CHECK constraint — and each rewrite hand-lists every column, which is fragile against schema drift. v18/v19 add and immediately remove the `useNativeSystem` setting. CLAUDE.md says current version is v34, code is at v35. The `supabase-import.ts` still runs at startup as a one-time fire-and-forget despite the round-trip being history.
- **Why it matters:** Each table-rewrite migration is an opportunity to lose columns silently (v9 only carries forward an explicit set; v10 uses `SELECT *` which is safer but inconsistent). New `ALTER TABLE` migrations interleaved with full rewrites mean the schema-of-record is implicit in 35 stacked deltas, not a single canonical DDL.
- **Recommendation:** (1) Add a "schema dump" generator test that re-runs all migrations on a fresh DB and snapshots the result — fail CI if the snapshot drifts unexpectedly. (2) Extract a helper for "rewrite table with new CHECK" so all four cases share one code path. (3) Delete `supabase-import.ts` and the v18/v19 dead settings as planned. (4) Keep CLAUDE.md's migration version in sync (currently lagging by 1).

### [MAJOR] Logger is named-but-unstructured; console + file double-write everywhere

- **Category:** Cross-cutting Concern
- **Location:** `src/main/logger.ts:67-83`
- **Observation:** Every `createLogger(name)` call writes to BOTH `console.*` and the file. This means production builds spam stdout on every log line, and the file format is plain text with no structured fields (no level filtering, no JSON, no agent-id correlation). Meanwhile, 33 `console.*` calls remain in `src/main` outside the logger (db.ts, env-utils.ts, settings-queries.ts, agent-event-mapper.ts, etc.). Some modules use `createLogger`, some don't, and there is no lint rule preventing raw console use.
- **Why it matters:** Production debugging across cross-cutting concerns (which span agent-manager, pr-poller, sprint-pr-poller, terminal-service, review handler) requires `grep`-and-pray. Field-level filtering ("show me everything for task abc123") is impossible without structured logs. The double-write also means the log file's "rotation at 10MB" doesn't reflect actual disk pressure once the user's terminal scrollback is involved.
- **Recommendation:** (1) Add an ESLint rule banning `console.*` in `src/main/**` outside `logger.ts`. (2) Make file output JSON-lines with `{ts, level, name, msg, ...context}` so a single `task_id` field can be injected and grep'd. (3) Gate console output on `is.dev` so production stops double-writing.

### [MAJOR] 27 Zustand stores with no enforced boundaries

- **Category:** Coupling / Onboarding Risk
- **Location:** `src/renderer/src/stores/` (27 `.ts` files)
- **Observation:** CLAUDE.md says "Max one Zustand store per domain concern." Reality: `sprintTasks`, `sprintEvents`, `sprintUI`, `taskGroups`, `taskWorkbench`, `pendingReview`, `codeReview`, `prConflicts` — eight stores all touching the task/review concern. Cross-store reads happen via `useXxxStore.getState()` calls in stores' subscribers (e.g. `theme.ts:136`, `pendingReview.ts:96`), bypassing React's reactivity and creating implicit ordering dependencies between store init.
- **Why it matters:** State that conceptually belongs together is split across files; updates that should be atomic require coordinating multiple store mutations; the optimistic-update protocol (`pendingUpdates` in `sprintTasks.ts`) only protects one of the eight task-related stores.
- **Recommendation:** Audit which stores can merge. Document a clear rule: if two stores have any cross-`getState()` calls, they should be one store with slices. The Zustand slice pattern handles the "max one store per domain" goal without forcing a god-store.

### [MAJOR] Handlers have ballooned past their original scope

- **Category:** Fragility / Onboarding Risk
- **Location:** `src/main/handlers/review.ts` (816 lines), `sprint-local.ts` (678 lines), `workbench.ts` (446 lines), `git-handlers.ts` (279 lines), `ide-fs-handlers.ts` (328 lines)
- **Observation:** The "handlers are thin IPC shims" model has eroded. `review.ts` is now 816 lines and contains business logic (rebase, merge strategy selection, freshness checks, summary generation). `sprint-local.ts` re-exports from `sprint-service`, dependency-helpers, dependency-index, workflow-engine, and listens for terminal callbacks — it's effectively a sprint domain facade pretending to be a handler module.
- **Why it matters:** The architecture doc still calls these "10 modules of IPC handlers"; new contributors expect glue code, find domain logic, and add more domain logic. Tests of handler files become tests of business logic with IPC mocks bolted on.
- **Recommendation:** Move all non-IPC logic out of `review.ts` and `sprint-local.ts` into `services/`. Handlers should be ≤150 lines, do argument validation, call a service, and return. Enforce with a soft size budget in CI.

### [MAJOR] `index.ts` whenReady() is a 200-line god function

- **Category:** Fragility / Onboarding Risk
- **Location:** `src/main/index.ts:114-330`
- **Observation:** Startup wires DB, claude-settings, backups, supabase import, db watcher, plugin loader, terminal service, four PR/event/task/diff prune intervals, agent manager, status server, 22 handler registrations, CSP setup, and window creation — all in one `whenReady` body. Failure in any one path is silently swallowed (`.catch(() => {})` on lines 120, 128). There is no startup contract — order matters but isn't documented.
- **Why it matters:** Adding a new feature means appending another `registerFooHandlers()` and another `setInterval` to a 200-line block where ordering is implicit. A startup error in any line that doesn't have a `try/catch` will fail the whole app silently.
- **Recommendation:** Extract `bootstrap.ts` with phases: `setupDb()`, `setupServices()`, `setupHandlers(deps)`, `startWindow()`. Each phase logs its start/end and surfaces errors. Replace the four near-identical `setInterval` prune blocks with a single `registerPeriodicTask(name, intervalMs, fn)` helper.

### [MAJOR] Polling is centralised in name only

- **Category:** Performance / Inconsistent Pattern
- **Location:** `src/renderer/src/lib/constants.ts` (referenced), `useBackoffInterval`, `useDashboardPolling`, `useVisibilityAwareInterval`, `logPoller.ts`, plus raw `setInterval` in 5+ component files
- **Observation:** CLAUDE.md mandates `useBackoffInterval` for new polling, but components like `AgentCard.tsx`, `ConsoleHeader.tsx`, `AgentMonitor.tsx`, `ElapsedTime.tsx` use raw `setInterval`. Two parallel hook abstractions exist (`useBackoffInterval` vs `useVisibilityAwareInterval` vs `useDashboardPolling`) with no clear guidance on which to pick. PR poller and sprint PR poller both run in main with separate intervals; the two main-process pollers + N renderer polls + the file-watcher all hit the same `sprint_tasks` rows.
- **Why it matters:** Battery drain on idle, redundant fetches, and (worse) the renderer can race the file watcher and main pollers, producing UI flicker. Optimistic updates protect only the renderer side.
- **Recommendation:** Pick one polling primitive (`useBackoffInterval`) and lint-ban raw `setInterval` in components. Consider a single "main → renderer push" channel for sprint task changes that supersedes polling entirely; the file watcher and pollers already produce the events.

### [MAJOR] Architecture documentation is months stale and actively misleading

- **Category:** Onboarding Risk
- **Location:** `docs/architecture.md`
- **Observation:** Doc says "7 views" — there are 9. Doc lists "10 handler modules" — there are 23. Doc says current schema includes only 4 tables — there are now agent_events, task_changes, review_comments, webhooks, task_groups, sprints. Doc says task lifecycle is `backlog → queued → active → done` — `blocked` and `review` exist. Doc mentions `OpenClaw Gateway` as an external dependency on port 18789 — no longer present. Doc references `local-agents.ts` for spawning, which has been replaced by the agent-manager + SDK adapter.
- **Why it matters:** A new contributor reading `docs/architecture.md` will write code against an architecture that no longer exists, then file PRs that get bounced. CLAUDE.md is up to date but architecture.md is the doc someone reads first when onboarding.
- **Recommendation:** Either delete `docs/architecture.md` entirely (CLAUDE.md is already comprehensive), or regenerate it from current code as part of this audit's remediation. Add a CI check that fails if `migrations.length` ≠ a number cited in CLAUDE.md/architecture.md.

### [MAJOR] No explicit IPC error contract — handlers throw, channels report `void`

- **Category:** Inconsistent Pattern / Cross-cutting Concern
- **Location:** `src/main/ipc-utils.ts:11-26`, all handler files
- **Observation:** `safeHandle` logs errors and re-throws. The renderer calls `await window.api.foo(x)` and either gets a result or a thrown promise rejection — but most channel result types claim to return `{ ok: boolean; error?: string }` (e.g. `agent:steer`, `agent:kill`, `groups:delete`, `webhook:delete`, `agent-manager:checkpoint`) while others return `void` and rely on throws. Some return `{ success: boolean }`. There is no single error envelope.
- **Why it matters:** Renderer error handling is inconsistent — some call sites check `.ok`, some try/catch, some do both, some neither. Toast/error UX depends entirely on which channel was unlucky.
- **Recommendation:** Pick one model (probably `Result<T>` envelope to avoid exception-based control flow over IPC) and migrate. Or pick "always throw" and remove all `{ok, error}` shapes. The current mix is the worst case.

### [MINOR] Test coverage gap: cross-cutting wiring is unverified

- **Category:** Test Gap
- **Location:** `src/main/index.ts:138-149`
- **Observation:** No test verifies that `setOnStatusTerminal`, `setGitHandlersOnStatusTerminal`, `setOnTaskTerminal`, `setReviewOnStatusTerminal` are all called by `index.ts`. If a refactor adds a fifth setter and forgets one call site, tests will pass and dependency resolution will silently break for that path.
- **Why it matters:** This wiring is the single most fragile architectural seam in the app and is exactly what the test suite ought to pin down.
- **Recommendation:** Add an integration test that imports `index.ts` machinery (or a `bootstrap.ts` after extraction) and asserts that all four callbacks are wired to the same function reference.

### [MINOR] `safeHandle` swallows context — logs `[channel] unhandled error: ${err}` with no args

- **Category:** Cross-cutting Concern
- **Location:** `src/main/ipc-utils.ts:22`
- **Observation:** When an IPC handler throws, the only logged context is the channel name and the error string. The args that triggered the error are dropped. Stack trace is lost in `${err}` interpolation.
- **Why it matters:** Production errors require the developer to reproduce locally with the exact arg shape — but the args are gone.
- **Recommendation:** Log a short JSON of args (with PII filtering) and use `err instanceof Error ? err.stack : String(err)`.

### [MINOR] `SpawnLocalAgent` and `agents:promoteToReview` violate the agent/review boundary

- **Category:** Coupling
- **Location:** `src/shared/ipc-channels.ts:215-218`
- **Observation:** `agents:promoteToReview` is in `AgentChannels` but its job is to create a sprint task in `review` status. Now an agent-domain channel writes to the sprint table, bypassing `sprint-service` and `sprint-task-repository`. This is a microcosm of the larger boundary erosion.
- **Why it matters:** Each such cross-domain channel is one more place where the "single writer" rule is broken without anyone noticing in code review.
- **Recommendation:** Move to `SprintChannels` as `sprint:promoteAgentToReview` and route through the service layer.

### [MINOR] DB file watcher + multiple pollers + main-process services all read the same hot rows

- **Category:** Performance
- **Location:** `src/main/bootstrap.ts` (file watcher), `pr-poller.ts`, `sprint-pr-poller.ts`, agent-manager drain loop, multiple renderer polls
- **Observation:** A single `sprint_tasks` row in `active` status will be touched by: the agent manager drain loop (30s), the sprint PR poller (60s), the renderer's `POLL_SPRINT_ACTIVE_MS` (30s), the dashboard poller (60s), and any open Task Pipeline view. Each external write triggers `fs.watch` → debounce → broadcast → renderer reload. With 50+ tasks the read amplification is significant for a desktop app.
- **Why it matters:** Not a problem today, will be a problem at the user load BDE is being designed for.
- **Recommendation:** Move toward a single source of truth in main: a `SprintTaskBroker` that polls/watches once and pushes diffs to the renderer. Renderer polls become subscriptions.

### [MINOR] `bootstrap.ts` (referenced from `index.ts:5`) sits next to `index.ts` but doesn't own bootstrap

- **Category:** Onboarding Risk
- **Location:** `src/main/index.ts:5` (`startDbWatcher, buildConnectSrc`)
- **Observation:** A file named `bootstrap.ts` exists, but only exports the DB watcher and CSP helper. The actual bootstrap logic is in `index.ts:114-330`. Naming suggests something different from reality.
- **Why it matters:** Onboarding contributors will look in `bootstrap.ts` for bootstrap and find half a dozen unrelated helpers.
- **Recommendation:** Rename to `db-watcher.ts` + `csp.ts` OR move the actual startup phases into `bootstrap.ts`.

### [MINOR] `sprint-queries.ts` is 1157 lines and is the de facto domain god module

- **Category:** Fragility
- **Location:** `src/main/data/sprint-queries.ts`
- **Observation:** Single file with all read+write paths, status transition logic, JSON column serialization, query builders, and exported constants like `UPDATE_ALLOWLIST`. Imported by 45 files. Any change risks breaking many call sites.
- **Why it matters:** The "data layer" is one file; merging concurrent branches that touch it is painful.
- **Recommendation:** Split by concern: `sprint-reads.ts`, `sprint-writes.ts`, `sprint-status-transitions.ts`, `sprint-pr.ts`. Re-export from a barrel.

### [MINOR] No central registry of background intervals — leaks at shutdown if anything is added incorrectly

- **Category:** Fragility
- **Location:** `src/main/index.ts:124, 160, 204, 217`
- **Observation:** Four `setInterval` blocks in `whenReady` each manually paired with an `app.on('will-quit', () => clearInterval(x))`. If a new interval is added without the cleanup, Electron warns about pending timers but the app still quits. There is no central tracker.
- **Why it matters:** Leaks are easy to add, hard to notice.
- **Recommendation:** Add a `registerInterval(name, fn, ms)` helper that handles both registration and shutdown via a single `intervals` array. Same for `app.on('will-quit')` cleanups generally — there are 6+ in `index.ts`.
