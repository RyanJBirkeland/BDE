# CLAUDE.md — BDE

@../../ARCHITECTURE.md
@docs/BDE_FEATURES.md

Electron desktop app (electron-vite + React + TypeScript) — the Birkeland Development Environment.

## THE Standard — Clean Code & Clean Architecture (RULE, NOT GUIDELINE)

> "Code should read like well-written prose." — Robert C. Martin

**This is the single most important rule in this codebase.** Every function, file, and name is held to this standard. We are not everywhere at this standard yet — but every commit must move toward it, never away. Violations are bugs, not style nits.

**The test:** if you need a comment to explain *what* a function or variable does, it fails. Rename it, split it, or restructure it until it speaks for itself. Comments are reserved for *why* — the non-obvious business reason.

**The rules (from `~/projects/ARCHITECTURE.md` §11 — read it):**
- Functions do one thing. "And" in the description = split the function.
- Names are vocabulary. Wrong name → wrong abstraction. No abbreviations.
- Files are chapters. One subject per file. Max ~500 LOC.
- Stepdown Rule: each function reads at one level of abstraction below the one above it.
- Boy Scout Rule: every commit leaves the code cleaner than it was found. Required, not optional.

**Clean Architecture is equally non-negotiable:** IPC handlers are thin wrappers — they delegate to services. Business logic lives in use cases and services, not in handlers or stores. See `~/projects/ARCHITECTURE.md` for the full dependency rule.

---

## Build & Test

**Node ≥22.12.0 required.** `@electron/rebuild` v4 needs it, and the native-module rebuild pipeline (`postinstall`, `predev`, `package`, `posttest:main`) silently fails on older Node versions. `package.json` still declares `^20.19.0 || >=22.12.0` for engine compatibility, but BDE development requires the 22.12+ branch.

**Electron version pin.** The `electron-rebuild` invocations hardcode `-v 39.8.6` to match the `electron` devDependency locked in `package-lock.json`. When bumping Electron, update all four script sites in `package.json` (`postinstall`, `predev`, `package`, `posttest:main`).

```bash
npm install          # Install dependencies
npm run dev          # Dev server with HMR
npm run build        # Type-check + production build (must pass before PR)
npm run typecheck    # TypeScript type checking (also runs in CI)
npm test             # Unit tests via vitest (must pass before PR)
npm run test:main    # Main process tests (separate vitest config)
npm run test:coverage # Unit tests + coverage threshold enforcement (used in CI)
npm run test:e2e     # E2E tests via Playwright (requires built app)
npm run lint         # ESLint
npm run format       # Prettier
```

## CI

GitHub Actions runs on every push to `main` and every PR targeting `main`:

- `npm run lint` — must pass
- `npm run typecheck` — must pass
- `npm run test:coverage` — must pass (coverage thresholds enforced in vitest config — don't hardcode them elsewhere)
- `npm run test:main` — must pass (main process integration tests)

All checks are required before merge.

**MANDATORY: Before EVERY commit, ALL of these must pass:**

```bash
npm run typecheck   # Zero errors required
npm test            # All tests must pass
npm run lint        # Zero errors required (warnings OK)
```

**Also mandatory before every commit:**
- Update `docs/modules/` for every source file you touched — see [§ Module Documentation](#module-documentation-mandatory-pre-commit) below.

Do NOT commit with failing checks or missing module docs. Fix issues first. If you cannot fix a failure, do NOT commit — report the issue.

## Module Documentation (MANDATORY pre-commit)

Before every commit, update `docs/modules/` for every source file you created or modified:

1. **Minimum:** ensure the module has a row in its layer `index.md`. Add one if missing.
2. **If you changed exports or observable behavior:** update or create the individual `<module>.md` detail file and link it from the index row.

**Layer → doc path:**

| If you touched... | Update... |
|---|---|
| `src/main/services/*` | `docs/modules/services/index.md` |
| `src/main/handlers/*` | `docs/modules/handlers/index.md` |
| `src/main/data/*` | `docs/modules/data/index.md` |
| `src/main/agent-manager/*` | `docs/modules/agent-manager/index.md` |
| `src/renderer/src/components/**` | `docs/modules/components/index.md` (Group column = component subdirectory name) |
| `src/renderer/src/views/*` | `docs/modules/views/index.md` |
| `src/renderer/src/stores/*` | `docs/modules/stores/index.md` |
| `src/renderer/src/hooks/*` | `docs/modules/hooks/index.md` |
| `src/shared/*` | `docs/modules/shared/index.md` |
| `src/main/lib/*` | `docs/modules/lib/main/index.md` |
| `src/renderer/src/lib/*` | `docs/modules/lib/renderer/index.md` |

**Module detail file template** (create at `docs/modules/<layer>/<module>.md`):

```markdown
# <module-name>

**Layer:** <layer>
**Source:** `<relative-path-from-repo-root>`

## Purpose
One or two sentences.

## Public API
- `exportedThing` — what it does
(For React components: list the default export + any named types/hooks/sub-components)

## Key Dependencies
- `dependency.ts` — why it's used
```

Omit implementation details, private functions, and anything already clear from source comments. Keep it to what a caller needs to know. **File renamed?** Update the index row. **File deleted?** Remove the index row.

## Pre-Push Hook

Every `git push` runs `typecheck + test + test:main + lint` via husky before the push is accepted. Full suite takes ~60s. Parallel pipeline-agent pushes serialize behind this hook — if N agents push at the same time, each hook runs sequentially. Account for this when estimating total wall time for multi-agent epics.

## Branch Conventions

- `feat/` — New features (e.g. `feat/git-client`)
- `fix/` — Bug fixes (e.g. `fix/rpc-layer`)
- `chore/` — Maintenance, docs, refactors (e.g. `chore/audit`)

## Commit Messages

Format: `{type}: {description}`

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance / docs

## Key File Locations

- Task terminal resolution service: `src/main/services/task-terminal-service.ts` (unified `onStatusTerminal` — all terminal paths converge here)
- Sprint task dependency management: `src/main/handlers/sprint-local.ts` (auto-blocking on create/transition)
- Dependency resolution after completion: `src/main/lib/resolve-dependents.ts`
- Shared sanitization: `src/shared/sanitize-depends-on.ts` (task deps), `src/shared/sanitize-epic-depends-on.ts` (epic deps, T-44). Apply on every hydration of `depends_on` JSON columns.
- Agent auto-commit: `src/main/agent-manager/completion.ts` (uses `git add -A` to capture new files; `.gitignore` excludes node_modules etc.). Failure classification in `src/main/agent-manager/failure-classifier.ts`; auto-merge policy evaluation in `src/main/agent-manager/auto-merge-policy.ts`
- Workbench operational checks: `src/main/services/operational-checks-service.ts` — `runOperationalChecks()` + individual check fns; `workbench:checkOperational` handler is a thin wrapper
- Review path validators: `src/main/lib/review-paths.ts` — `validateGitRef`, `validateWorktreePath`, `validateFilePath`, `getWorktreeBase`; import from here, don't redefine inline
- Auto-review service: `src/main/services/auto-review-service.ts` — rule evaluation for `review:checkAutoReview`; handler is a thin wrapper
- WIP limit policy: `src/renderer/src/lib/wip-policy.ts` — `canLaunchTask(activeCount, maxConcurrent)`; business rule lives here, not inline in the store
- Agent event mapping/emission: `src/main/agent-event-mapper.ts` (shared by adhoc + pipeline agents)
- Worktree management: `src/main/agent-manager/worktree.ts`
- Shutdown/lifecycle: `src/main/agent-manager/index.ts`
- Repository interface: `src/main/data/sprint-task-repository.ts` (ISprintTaskRepository + factory)
- Audit trail: `src/main/data/task-changes.ts` (field-level change tracking in SQLite)
- Shared logger: `src/main/logger.ts` (createLogger → `~/.bde/bde.log`)
- Polling hook: `src/renderer/src/hooks/useBackoffInterval.ts` (backoff + jitter)
- Prompt composer: `src/main/lib/prompt-composer.ts` — `buildAgentPrompt()` dispatcher for all agent types. All spawn paths must use this instead of inline prompt assembly. Per-agent builders still live in `src/main/agent-manager/` (`prompt-pipeline.ts`, `prompt-assistant.ts`, `prompt-copilot.ts`, `prompt-synthesizer.ts`); shared section builders in `prompt-sections.ts`. User-controlled content is wrapped in XML boundary tags (`<user_spec>`, `<upstream_spec>`, `<failure_notes>`, etc.) to prevent prompt injection — always follow this pattern when adding new interpolation sites.
- Prompt truncation constants: `src/main/agent-manager/prompt-constants.ts` — `PROMPT_TRUNCATION` object with `TASK_SPEC_CHARS` (8000), `UPSTREAM_SPEC_CHARS` (2000), `UPSTREAM_DIFF_CHARS` (2000). Import from here — never scatter magic numbers.
- Reviewer prompt builders: `src/main/agent-manager/prompt-composer-reviewer.ts` — `buildStructuredReviewPrompt()` (JSON schema output), `buildInteractiveReviewPrompt()` (conversational), and `buildReviewerPrompt()` backward-compat dispatcher.
- Shared SDK streaming: `src/main/sdk-streaming.ts` — extracted `runSdkStreaming()` utility used by workbench and synthesizer. Don't duplicate this inline.
- Roving tab index hook: `src/renderer/src/hooks/useRovingTabIndex.ts` — shared keyboard tab navigation (arrow keys, Home/End)
- Diff file selection hook: `src/renderer/src/hooks/useDiffSelection.ts` — diff file selection state management
- IDE keyboard hook: `src/renderer/src/hooks/useIDEKeyboard.ts` — extracted IDE keyboard shortcuts
- Pipeline sub-components: `src/renderer/src/components/sprint/PipelineHeader.tsx`, `PipelineOverlays.tsx`, `TaskDetailActionButtons.tsx` — extracted from SprintPipeline/TaskDetailDrawer
- Collapsible block: `src/renderer/src/components/agents/CollapsibleBlock.tsx` — shared collapsible pattern for agent console
- Diff components: `src/renderer/src/components/diff/PlainDiffContent.tsx` (non-virtualized diff), `DiffFileList.tsx` (diff file sidebar)
- Format utilities: `src/renderer/src/lib/format.ts` — `formatDuration()` and `formatDurationMs()` consolidated here
- Textarea prompt modal: `src/renderer/src/components/ui/TextareaPromptModal.tsx` — multi-line input modal (used by Code Review revision requests)
- Modal primitive: `src/renderer/src/components/ui/Modal.tsx` — shared shell for centered dialogs (backdrop, focus trap via `useFocusTrap`, portal to `document.body`, ESC + backdrop-click dismissal, size presets `sm`/`md`/`lg`/`fullscreen`). Use this for any new modal — don't roll a fresh backdrop/focus-trap. `ConfirmModal` and `TaskWorkbenchModal` already wrap it; `PromptModal`, `TextareaPromptModal`, `CreateEpicModal`, `FeatureGuideModal`, and `ShortcutsOverlay` are pending migration.
- Pipeline agent worktrees: `~/.bde/worktrees/Users-ryanbirkeland-Projects-git-repos-BDE/<32-char-taskId>/` (derived from `agentManager.worktreeBase` setting, which defaults to `~/.bde/worktrees` — users who override this in Settings get their configured path instead)
- ADR — store separation: `docs/architecture-decisions/costdata-agenthistory-separation.md`
- Main process shared libs: `src/main/lib/async-utils.ts` (`sleep`, `execFileAsync`) · `src/main/lib/patch-validation.ts` (`validateAndFilterPatch`) — don't reimplement these inline
- Renderer shared libs: `src/renderer/src/lib/createDebouncedPersister.ts` — debounced localStorage/settings writes, used by 5 stores
- Repo search service: `src/main/services/repo-search-service.ts` — `searchRepo()` + `parseGrepOutput()`, used by `workbench:researchRepo` handler
- Dependency index refresh: `src/main/agent-manager/dependency-refresher.ts` — `refreshDependencyIndex()`, `computeDepsFingerprint()`
- Terminal status handler: `src/main/agent-manager/terminal-handler.ts` — `handleTaskTerminal()` (metrics + dep resolution + cleanup timer)
- MCP server: `src/main/mcp-server/` — opt-in local MCP server for external agents; toggle via `mcp.enabled` setting. Token in `~/.bde/mcp-token`.

## PR Rules

1. Branch from `main`, PR back to `main` — no direct pushes to `main`
2. **Self-heal**: `npm run build` and `npm test` must both pass before opening a PR
3. Keep PRs focused — one feature or fix per PR
4. **UX PRs must include screenshots or ASCII art** of every changed UI surface in the PR body. Use ASCII art as fallback if the app can't be rendered. This is required — no exceptions.

### Ship It CLI equivalent (manual merge pattern)

For merging an agent branch to main from the command line (instead of via Code Review Station's Ship It button):

```bash
git fetch origin main
git rebase origin/main           # critical: local main must match origin
git cherry-pick origin/agent/<branch>
git push origin main             # pre-push hook runs the full suite
git push origin --delete agent/<branch>
git worktree remove ~/.bde/worktrees/Users-ryanbirkeland-Projects-git-repos-BDE/<taskId> --force
```

The rebase step is mandatory — local main can diverge from origin if another session pushed in between. Skipping it causes the same bug the in-app Ship It fix was built to prevent.

## Dependency Policy

- **No new npm packages without explicit approval.** Evaluate whether the functionality can be achieved with existing dependencies or standard Node.js APIs before proposing a new package.
- When a new dependency is justified, prefer packages that are: small, well-maintained, tree-shakeable, and have no transitive dependencies.

## Code Quality

See **THE Standard** section at the top of this file. Everything below is BDE-specific enforcement on top of that baseline.

- **Clean Code (mandatory):** functions do one thing, names are vocabulary not labels, no magic numbers, files are chapters. If you need a comment to explain *what*, rewrite until you don't.
- **Clean Architecture (mandatory):** respect process boundaries (main/preload/renderer), keep IPC surface minimal, shared types in `src/shared/`. Handlers delegate — they contain no business logic.
- All IPC handlers must use the `safeHandle()` wrapper for error logging. Pass an optional `parseArgs` validator (T-7) to runtime-check inbound payloads — required for any channel that accepts user-controlled JSON.
- **Boundary validators.** Don't write raw JSON into SQLite columns without a matching validator on read. Current validators: `mapRowToTask` in `sprint-task-mapper.ts` (T-2), `parseWebhookEvents` in `webhook-queries.ts` (T-47), `agent:history` row shape in `agent-handlers.ts` (T-4), `sanitizeDependsOn` in `sprint-task-mapper.ts` (T-61), `sanitizeEpicDependsOn` in `task-group-queries.ts` (T-44). Mirror this pattern when adding new JSON columns.
- Prefer `execFile`/`execFileAsync` (argument arrays) over `execSync` (string interpolation) to prevent shell injection.
- **SQLite multi-statement SQL gotcha**: the repo's security hook pattern-matches shell-style invocations on Edit operations and will block a `db` call that takes a backtick-literal argument on the same line. Workaround: assign the SQL to a `const sql = ` variable first, then pass the variable to the `db` method on the next line. See any multi-statement migration in `src/main/db.ts` for the pattern.
- **bootstrap.test.ts gotcha**: every module imported by `bootstrap.ts` needs a matching `vi.mock(...)` in `bootstrap.test.ts` — a missing mock causes ALL tests in the file to fail with "not a function" errors, not just the assertions that use it.

## Conflict-Prone Files

These files are edited frequently across branches. Take extra care when modifying:

- `src/renderer/src/App.tsx` — main app shell, keyboard shortcuts, view routing
- `src/main/index.ts` — all IPC handler registrations
- `src/preload/index.ts` — preload bridge API surface

## Architecture Notes

- **Data layer**: SQLite at `~/.bde/bde.db` (WAL mode, schema in `src/main/db.ts`). Migrations live in `src/main/migrations/` as separate versioned files, loaded via `loader.ts`. Add new migrations with `version: last + 1`. Check the actual current version with `sqlite3 ~/.bde/bde.db "PRAGMA user_version"` rather than trusting any number in docs (they drift). Backup via `VACUUM INTO` to `bde.db.backup` runs on startup + every 24h. for all local tables: `agent_runs`, `settings`, `cost_events`, `agent_events`, `task_changes`, `sprint_tasks`. Sprint tasks live in local SQLite. `src/main/data/sprint-queries.ts` is now a barrel re-export — logic lives in focused modules: `sprint-task-crud.ts` (CRUD), `sprint-queue-ops.ts` (claim/release/WIP), `sprint-pr-ops.ts` (PR lifecycle), `sprint-agent-queries.ts` (health/dependency queries), `sprint-task-mapper.ts` (row mapping), `sprint-task-types.ts` (types/allowlists), `sprint-maintenance.ts` (snapshot pruning). Import from `sprint-queries.ts` for backward compat or directly from the focused module. On first launch, `importSprintTasksFromSupabase()` runs as a one-time fire-and-forget migration if credentials are present; it is a no-op once the table has rows. (Scheduled for removal before public release — no new users will hit this path.) Audit trail stored in `task_changes` table — field-level diffs logged on every `updateTask()` call.
- **Repository pattern**: `src/main/data/sprint-task-repository.ts` defines `ISprintTaskRepository` interface. Agent manager receives the repository via constructor injection (`createAgentManager(config, repo, logger)`). Concrete implementation delegates to sprint-queries. IPC handlers (sprint-local.ts) import sprint-queries directly — they're thin enough not to need the abstraction. The composition root (`index.ts`) routes all data access through the `repo` instance; the only remaining `sprint-queries` import there is `setSprintQueriesLogger` (logging infrastructure, not a data bypass). `task-validation.ts` and `bootstrap.ts` use injected callbacks and do not import sprint-queries directly. Row mapping validates `id`/`status`/`priority`/`repo`/`title` and sanitizes `depends_on` via `sanitizeDependsOn` (T-2, T-61) — malformed DB rows throw at the boundary rather than propagating.
- **SprintTask view types**: `src/shared/types/task-types.ts` exports four `Pick<SprintTask,...>` aliases for consumers that don't need all 43 fields: `SprintTaskCore` (11 universal fields), `SprintTaskSpec` (Core + spec/definition fields), `SprintTaskExecution` (Core + agent runtime fields), `SprintTaskPR` (Core + PR/review fields). `SprintTask` satisfies all four structurally. Use the narrowest type that covers your needs. `ISprintPollerRepository.listTasksWithOpenPrs()` already returns `SprintTaskPR[]`. Future narrowing: prefer narrower view types when editing functions that take `SprintTask`.
- **AgentManager**: `src/main/agent-manager/` — in-process task orchestration. Drain loop watches for queued tasks, spawns agents in git worktrees via SDK, monitors with watchdogs, handles completion (transition to `review` status, preserve worktree, retry logic). All data access goes through `ISprintTaskRepository` (injected). Core agent lifecycle in `run-agent.ts` with explicit `RunAgentDeps` interface. Per-task `max_runtime_ms` overrides the global 1-hour watchdog limit.
- **AuthGuard**: `src/main/auth-guard.ts` — validates Claude Code subscription token. NOT called in the drain loop (Keychain access hangs in Electron). Auth is validated by the SDK at spawn time instead. Users must run `claude login` to authenticate.
- **Task dependencies**: `src/main/services/dependency-service.ts` (in-memory reverse index, cycle detection), `src/main/agent-manager/resolve-dependents.ts` (blocked→queued transitions). Tasks can declare `depends_on: TaskDependency[]` with `hard` (block on failure) or `soft` (unblock regardless) edges. `blocked` status = unsatisfied hard deps. Resolution triggered from all terminal status paths.
- **PR poller**: `src/main/pr-poller.ts` — polls open PRs from all configured repos every 60s, fetches check runs, broadcasts `pr:listUpdated` to renderer. Separate from sprint PR poller.
- **Sprint PR poller**: `src/main/sprint-pr-poller.ts` — runs every 60s in main process (not renderer-dependent), polls PR status for tasks with `pr_status='open'`. Auto-marks tasks done (merged) or cancelled (closed).
- **State**: Zustand stores in `src/renderer/src/stores/`
- **IPC**: 29 handler modules in `src/main/handlers/`, registered in `src/main/index.ts`, preload bridge in `src/preload/index.ts`. ~138 typed channels defined across domain-grouped modules in `src/shared/ipc-channels/` (re-exported via `ipc-channels.ts` shim for backward compatibility).
- **Agent spawning**: `src/main/agent-manager/sdk-adapter.ts` spawns agents via `@anthropic-ai/claude-agent-sdk` (with CLI fallback). OAuth token read from `~/.bde/oauth-token` at startup — Keychain access hangs in Electron's main process, so the file-based approach is required. SDK options policy: `settingSources: []` for all agent types (pipeline, adhoc, review) so agents only see explicit prompt context, not Claude Code's own settings files; pipeline SDK calls additionally include `['user', 'local']` via `spawnViaSdk`. `maxTurns: 20` enforced for pipeline agents. `maxBudgetUsd` defaults: `2.0` for pipeline, `5.0` ceiling for adhoc.
- **Native agent system**: `src/main/agent-system/` — custom BDE-specific agent infrastructure (personality, memory, skills) replaces third-party plugin scripts. Unconditional since migration v019 removed the `agentManager.useNativeSystem` toggle. Agents receive tailored personalities (pipeline = concise/action-oriented, assistant = conversational/proactive), BDE conventions (IPC patterns, testing standards, architecture rules), and interactive skills (system introspection, task orchestration, code patterns). Skills only injected for assistant/adhoc agents, not pipeline. Prompt assembly via `prompt-composer.ts` `buildAgentPrompt()` function. See `docs/agent-system-guide.md` for architecture, usage, and migration guide.
- **DB sync**: File watcher on `bde.db` pushes `sprint:externalChange` IPC events to renderer (500ms debounce)
- **Design tokens**: `src/renderer/src/assets/tokens.css` — use these instead of hardcoded values. Neon theme tokens in CSS custom properties (`neon.css`, `neon-shell.css`, `agents-neon.css`).
- **Neon components**: `src/renderer/src/components/neon/` (11 primitives: NeonCard, StatCounter, NeonBadge, GlassPanel, ActivityFeed, NeonProgress, PipelineFlow, SankeyPipeline, MiniChart, StatusBar, NeonTooltip). Used by Dashboard + Agents views. Glass morphism, glow effects, terminal aesthetic.
- **Component organization**: Additional component subdirectories include `help/` (help UI), `planner/` (task planning components), `onboarding/` (first-launch onboarding flow), `agents/`, `code-review/`, `dashboard/`, `diff/`, `git-tree/`, `ide/`, `panels/`, `settings/`, `sprint/`, `task-workbench/`, `terminal/`, and `ui/` (shared primitives).
- **MiniChart accent**: `MiniChart` uses `data[0].accent` for the entire line color. Per-point `accent` values on `ChartBar[]` are ignored — don't cycle colors thinking they'll render differently.
- **Agent events**: `src/main/agent-event-mapper.ts` — shared `mapRawMessage()` (SDK wire protocol → `AgentEvent[]`) + `emitAgentEvent()` (broadcast + SQLite persist). Used by both `adhoc-agent.ts` (user-spawned) and `run-agent.ts` (pipeline agents).
- **Agent events cap**: `src/renderer/src/stores/agentEvents.ts` caps at 2000 events per agent (oldest evicted). Both `init()` subscriber and `loadHistory()` enforce the cap.
- **Panel system**: `src/renderer/src/stores/panelLayout.ts` — recursive PanelNode tree (leaf/split), `src/renderer/src/components/panels/` — PanelRenderer, PanelLeaf, PanelTabBar, PanelDropOverlay. Layout persists to `panel.layout` setting. Views rendered inside panels; drag-and-drop docking with 5-zone hit testing.
- **Views**: 8 views in `src/renderer/src/views/` — Dashboard (⌘1), Agents (⌘2), IDE (⌘3, default), Task Pipeline (⌘4), Code Review (⌘5), Source Control (⌘6), Settings (⌘7), Task Planner (⌘8). Task Pipeline = execution monitoring (vertical pipeline flow); Task Planner = multi-task workflow planning. Task creation/editing is not a view — it lives in `TaskWorkbenchModal`, a centered modal mounted at app root and opened from the Pipeline (Edit) and Planner (Add/Edit) via `useTaskWorkbenchModalStore`. View metadata (labels, icons, shortcuts) is defined in a single `VIEW_REGISTRY` object in `src/renderer/src/lib/view-registry.ts` — add new views there, not in `panelLayout.ts` or `App.tsx`. `VIEW_LABELS` / `VIEW_SHORTCUT_MAP` are derived re-exports from the registry.
- **Task Planner**: `src/renderer/src/views/PlannerView.tsx` — multi-task workflow planning view. Distinct from the Task Workbench modal (single-task spec drafting). Accessed via ⌘8.
- **IDE**: `src/renderer/src/views/IDEView.tsx` + `src/renderer/src/components/ide/` (9 components). Monaco editor + file explorer sidebar + integrated terminal. `ideStore` in `src/renderer/src/stores/ide.ts`. File I/O via `ide-fs-handlers.ts` (path-scoped to opened root, atomic writes, binary detection). State persisted to `ide.state` setting with 2s debounce.
- **Code Review**: `src/renderer/src/views/CodeReviewView.tsx` + `src/renderer/src/components/code-review/` (ReviewQueue, ReviewDetail, ReviewActions, ChangesTab, CommitsTab, ConversationTab). `codeReview` Zustand store. Agent completion stops at `review` status with worktree preserved. User reviews diffs/commits, then merges locally, creates PR, requests revision, or discards. Task statuses include `review` between `active` and `done`. Replaces the previous PR Station components.
- **Source Control**: `src/renderer/src/views/GitTreeView.tsx` + `src/renderer/src/components/git-tree/` (5 components: GitFileRow, FileTreeSection, CommitBox, BranchSelector, InlineDiffDrawer). `gitTree` Zustand store in `src/renderer/src/stores/gitTree.ts`. Uses existing git IPC channels (`git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit`, `git:push`, `git:branches`). Polls at `POLL_GIT_STATUS_INTERVAL` (30s). Store tracks `commitLoading`/`pushLoading`/`lastError` for operation feedback; CommitBox shows loading spinners, GitTreeView renders persistent error banner with Retry/Dismiss.
- **Dashboard**: `src/renderer/src/views/DashboardView.tsx` + `src/renderer/src/components/dashboard/` (StatusRail, CenterColumn, ActivitySection, FiresStrip, LoadAverageChart, MorningBriefing, SuccessRateChart, ThroughputChart). Aggregates data from `sprintTasks`, `costData` stores and PR list IPC. Default landing view. Polls every 60s via `useBackoffInterval` (with jitter + exponential backoff on errors).
- **Logging**: `src/main/logger.ts` — `createLogger(name)` writes to `~/.bde/bde.log` with `[LEVEL] [module]` format + ISO timestamps. Rotates at 10MB (renames to `.old`, keeps 1 generation). Checks rotation on creation + every 1000 writes. Sprint-queries uses injectable logger via `setSprintQueriesLogger()`. **For debugging, prefer `~/.bde/bde.log` — the live log for all main-process modules. `~/.bde/agent-manager.log` may exist but can be stale from prior builds; don't trust it as a source of current behavior.**
- **Optimistic updates**: `src/renderer/src/stores/sprintTasks.ts` — field-level tracking via `pendingUpdates: Record<string, { ts: number; fields: string[] }>`. On poll merge, only pending fields are preserved from local state; all other fields come from server. 2-second TTL. Full reload on failure (safest revert).
- **Task Pipeline**: `src/renderer/src/components/sprint/SprintPipeline.tsx` — three-zone layout (PipelineBacklog | PipelineStage×5 | TaskDetailDrawer). Uses `partitionSprintTasks()` for stage mapping. Neon CSS in `sprint-pipeline-neon.css`. Task creation lives in the `TaskWorkbenchModal`, opened via `useTaskWorkbenchModalStore.openForCreate()`; clicking Edit on a task calls `openForEdit(task)` (no view jump).
- **Task Workbench**: `src/renderer/src/components/task-workbench/` — form + AI copilot + readiness checks. Hosted in `TaskWorkbenchModal` (the canonical add/edit surface, mounted at app root). Modal shell (backdrop, focus trap, dismissal) is the shared `Modal` primitive in `components/ui/Modal.tsx`. Copilot uses Agent SDK streaming via `workbench:chatStream` IPC. Neon CSS in `task-workbench-neon.css` (`.wb-*` BEM classes).
- **`consumeMessages` result**: `run-agent.ts` `consumeMessages()` returns `{ exitCode, lastAgentOutput, streamError?, pendingPlaygroundPaths }` — check `streamError` to detect mid-stream failures; `pendingPlaygroundPaths` are awaited by `runAgent` before worktree cleanup (ordering guarantee). Stream failures emit a structured `agent:error` event with "Stream interrupted:" prefix — don't add a second emit in `runAgent`. Watchdog early-return calls `flushAgentEventBatcher()` before transitioning status to prevent SQLite event loss. Playground I/O uses `Promise.race`-based `withTimeout<T>` in `playground-handler.ts` (5s timeout) — don't revert to AbortController flag-checking.
- **Sprint UI stores (split)**: `sprintUI.ts` (drawers + generatingIds + display mode), `sprintSelection.ts` (selectedTaskId, selectedTaskIds, drawerOpen, specPanelOpen), `sprintFilters.ts` (statusFilter, repoFilter, tagFilter, searchQuery). Don't add state to `sprintUI.ts` — put it in the right focused store. `selectIsGenerating(taskId)` in sprintUI; `selectIsTaskSelected(taskId)` in sprintSelection.
- **Review actions**: `useReviewActions.ts` is a thin composition hook. Single-task actions (shipIt, mergeLocally, createPr, requestRevision, rebase, discard) in `useSingleTaskReviewActions.ts`; batch actions in `useBatchReviewActions.ts`.
- **Computed selectors (not stored state)**: `activeTaskCount` → use `selectActiveTaskCount` from `sprintTasks` store; `latestEvents` → use `selectLatestEvent(taskId)` from `sprintEvents` store
- **Failure pattern matching**: `classifyFailureReason` in `src/main/agent-manager/failure-classifier.ts` uses `FAILURE_PATTERNS` array — add entries there to handle new SDK/git error messages; don't add more if-chains
- **Preload broadcast pattern**: New main→renderer event channels should use `onBroadcast<T>(channel)` factory in `src/preload/index.ts` — avoids boilerplate subscription wiring
- **MCP server**: `src/main/mcp-server/` — Streamable HTTP on `127.0.0.1:<port>` (default 18792). All mutations route through `sprint-service` / `EpicGroupService`.
- **Full architecture**: See `docs/architecture.md`

## Packaging

```bash
npm run build:mac    # Build unsigned macOS arm64 DMG → release/BDE-*.dmg
npm run package      # Alias for build:mac
```

- **Prerequisites for users**: Claude Code CLI installed + `claude login`, `git`, `gh` CLI
- **Unsigned**: `identity: null` in electron-builder.yml — users right-click → Open to bypass Gatekeeper
- **Onboarding**: App shows auth check screen on first launch with checks for CLI, token, git, repos (optional). Optional checks warn but don't block. Auto-skips for returning users with valid token.

## Key Conventions

- TypeScript strict mode
- Zustand for all client state
- `lucide-react` for icons
- `react-resizable-panels` for panel layouts (`orientation` prop, not `direction`)
- ARIA accessibility: landmarks (`<main>`, `<nav>`), dialog semantics (`role="dialog"`, `aria-modal`), tab patterns (`role="tablist"`/`role="tab"`), live regions on ToastContainer. Maintain these when adding new UI.
- Max one Zustand store per domain concern
- Polling intervals centralized in `src/renderer/src/lib/constants.ts`
- Use `useBackoffInterval` (not raw `setInterval`) for new polling — provides jitter + backoff
- New main-process modules: use `createLogger(name)` from `src/main/logger.ts` — not raw `console.*`
- Agent manager data access: should go through `ISprintTaskRepository` when possible; some paths still use sprint-queries directly (being addressed incrementally)
- WIP limit: `agentManager.maxConcurrent` setting (code default `2`). Enforced at the drain loop, not in the UI. Values >3 on a typical laptop can oversaturate CPU — each pipeline agent spawns its own vitest workers during verification. The Settings → Agent Manager UI shows a live warning above the safe threshold.
- **`sprint_tasks.repo` must be lowercase** to match settings convention (`repos: [{ name: 'bde', ... }]`). Historical rows with uppercase `'BDE'` are normalized by migration v38; new inserts (manual SQL or IPC) must use lowercase. `getRepoConfig` is case-insensitive as a safety net but don't rely on it.
- Task dependency validation runs before creation — no create-then-rollback patterns
- Audit trail is automatic — `updateTask()` records field-level diffs to `task_changes` table
- Optimistic updates track fields, not just task IDs — only pending fields preserved on poll merge
- Status transitions validated by `isValidTransition()` in `src/shared/task-state-machine.ts`, currently enforced at the data layer in `updateTask()` (note: this mixes business policy with data access; future refactoring may move validation to a service layer). After T-89 the signature is narrowed to the `TaskStatus` union — callers holding unvalidated strings must narrow via `isTaskStatus()` first.
- Pipeline agent prompts include retry context, time limits, idle warnings, and scope enforcement — see `prompt-composer.ts`
- Spec templates with required sections in `src/shared/constants.ts` — Bug Fix, Feature, Refactor, Test Coverage
- Data-mutating migrations (any `UPDATE`/`DELETE` or CHECK-constraint change) require a dedicated test in `src/main/migrations/__tests__/vNNN.test.ts` modeled on `v049.test.ts` / `v038.test.ts`. The aggregate `runMigrations` smoke test proves the chain completes but not that each individual migration handles a partially-applied prior state.
- When re-queueing a task, use `resetTaskForRetry(id)` (or the `sprint:retry` IPC / `tasks.update` MCP tool). Raw `UPDATE sprint_tasks SET status='queued'` leaves stale `completed_at`, `failure_reason`, `retry_count`, etc. from the prior run — the UI shows half-terminal rows and the retry counter can immediately re-trip fast-fail.

## Pipeline Agent Spec Guidelines

When creating sprint tasks for pipeline agents:

- **Keep specs under 500 words.** Full plan files (1000+ lines) cause 100% timeout. Per-task specs (200-400 words) complete in 15-30 min.
- **Include exact file paths.** Agents waste 15-20% of tokens on file exploration without them.
- **Include `## How to Test` section.** Agents skip tests or write wrong patterns without guidance.
- **Include `## Files to Change` section.** List every file the agent should modify.
- **Avoid exploration language.** "Explore," "investigate," "find issues" cause agents to thrash. Use explicit instructions.
- **One feature per task.** Agents given multi-feature specs attempt everything and timeout.
- **Agents create test task artifacts.** Running `npm test` in worktrees creates "Test task" records in `~/.bde/bde.db`. These are cleaned on app startup.
- **Task linkage is derived from the branch name, not the commit subject.** BDE generates each pipeline agent's branch as `agent/t-<id>-<slug>-<hash>` — the completion guard (`assertBranchTipMatches` in `resolve-success-phases.ts`) extracts the task id from the branch name via `extractTaskIdFromBranch`. Agents follow the standard commit-message convention (`{type}({scope}): {what} — {why}`) and do not need to mention the task id in the subject. The guard retains a commit-message fallback for non-standard branch names.

### Direct SQL queue pattern (bypass IPC)

For batch operations or pre-authored specs already on disk, insert directly:

```sql
INSERT INTO sprint_tasks (title, status, repo, spec, spec_type, priority, needs_review, playground_enabled)
VALUES (?, 'queued', 'bde', ?, 'feature', 1, 1, 0)
```

Bypasses the IPC readiness check (semantic + structural). Only use when the spec has been hand-validated. The drain loop picks up queued tasks within 30s. See `docs/superpowers/audits/2026-04-07/epic-*-tasks/` for example specs used this way, and `docs/superpowers/audits/2026-04-07/` for the Python queueing scripts (`/tmp/queue_epic*.py` pattern).
