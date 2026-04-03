# BDE Codebase Audit -- Synthesis Final Report

**Date:** 2026-03-28
**Sources:** 15 audit reports across 5 domain groups (Sprint Tasks, Code Review, Workspace, Shell/Design, Main Process) x 3 personas (AX = Architectural Engineer, SD = Senior Developer, PM = Product Manager)

---

## 1. Executive Summary

BDE is a capable Electron desktop app with solid architectural foundations: typed IPC channels, parameterized SQL, a well-designed recursive panel layout system, clean agent event pipeline, and proper GitHub token isolation. However, the codebase carries significant technical debt from successive UI redesigns -- roughly 5,000+ lines of dead code across legacy SprintCenter components, unused agent stores, and orphaned terminal widgets. Two competing design systems (ui/ BEM + CSS vars vs neon/ inline tokens) coexist with no migration plan, creating styling inconsistency and blocking theme support. Security posture is generally good but has three notable gaps: renderer sandbox disabled, symlink-based path traversal in IDE file operations, and an open GitHub API proxy. Error recovery UX is the weakest dimension: agent failures produce terse internal labels ("Fast-fail exhausted", "Idle timeout") with no actionable guidance, and several views swallow errors silently or show infinite loading states.

---

## 2. Critical Issues (Must Fix)

### Security

| #     | Issue                                                                                                                                                              | Flagged By                              | File(s)                                                      | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ | ------ |
| SEC-1 | **Renderer sandbox disabled** -- compromised renderer gets full Node.js access                                                                                     | main-process-sd C2                      | `src/main/index.ts:60`                                       | L      |
| SEC-2 | **Symlink-based path traversal bypass in IDE** -- `path.resolve()` does not follow symlinks; a symlink inside IDE root allows read/write/delete of arbitrary files | workspace-sd 2.1                        | `src/main/handlers/ide-fs-handlers.ts:15-21`                 | S      |
| SEC-3 | **`github:fetch` IPC is an open proxy** -- renderer can make arbitrary mutating GitHub API calls (DELETE repos, add collaborators) with user's token               | code-review-sd 2.1                      | `src/main/handlers/git-handlers.ts:40-70`                    | M      |
| SEC-4 | **PlaygroundModal iframe allows scripts** -- agent-generated HTML executes JS via `sandbox="allow-scripts"` in Electron renderer                                   | workspace-sd 2.3                        | `src/renderer/src/components/agents/PlaygroundModal.tsx:334` | S      |
| SEC-5 | **CORS `*` on auth-protected localhost API** -- any browser tab can probe Queue API                                                                                | main-process-sd C3                      | `src/main/queue-api/helpers.ts:56`                           | S      |
| SEC-6 | **SQL string interpolation in `backupDatabase()`** -- `VACUUM INTO '${backupPath}'`                                                                                | main-process-ax 3.6, main-process-sd C1 | `src/main/db.ts:31`                                          | S      |

### Architecture

| #      | Issue                                                                                                                                                                                      | Flagged By                                                    | File(s)                                                            | Effort |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| ARCH-1 | **Dual orchestrator duplication** -- SprintCenter and SprintPipeline independently wire identical hooks, polling, and side effects                                                         | sprint-tasks-ax C1                                            | `SprintCenter.tsx`, `SprintPipeline.tsx`                           | M      |
| ARCH-2 | **Repository pattern inconsistently applied** -- IPC handlers and Queue API bypass `ISprintTaskRepository`, creating 3 different task update codepaths with different side effects         | main-process-ax 2.2                                           | `sprint-local.ts`, `task-handlers.ts`, `sprint-service.ts`         | M      |
| ARCH-3 | **Hardcoded `REPO_OPTIONS` in PR Station** -- 7 components import a static 3-repo constant instead of using `useRepoOptions()` hook; any user-configured repo silently fails all API calls | code-review-ax 2.1                                            | `constants.ts`, 7 PR Station components                            | M      |
| ARCH-4 | **Two competing design systems** -- `ui/` (BEM + CSS vars) and `neon/` (inline tokens) coexist with 8 hybrid components mixing both                                                        | shell-design-ax 2.2, 2.3, 3.2, 3.3                            | `ui/*`, `neon/*`, `tokens.ts`, `base.css`, `neon.css`              | L      |
| ARCH-5 | **VIEW_LABELS/VIEW_ICONS duplicated 4x** -- adding a view requires updating 4 files in lockstep; missing entries cause runtime crashes                                                     | shell-design-ax 2.1, shell-design-sd 4.1, shell-design-pm 4.3 | `panelLayout.ts`, `NeonSidebar.tsx`, `OverflowMenu.tsx`, `App.tsx` | S      |
| ARCH-6 | **Fragile `onStatusTerminal` wiring** -- 4 separate setter functions must be called in correct order at startup; easy to miss when adding new terminal-status modules                      | main-process-ax 2.3                                           | `src/main/index.ts:115-124`                                        | M      |

### UX

| #    | Issue                                                                                                                                                                      | Flagged By                                                 | File(s)                                                  | Effort |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ------ |
| UX-1 | **Agent failure notes are not actionable** -- users see "Fast-fail exhausted", "Idle timeout", "Empty prompt" with no recovery guidance                                    | main-process-pm C1                                         | `index.ts`, `run-agent.ts`, `completion.ts`              | S      |
| UX-2 | **Virtualized diff silently disables all commenting** -- large PR diffs become read-only with no indication to user                                                        | code-review-pm 2.1                                         | `DiffViewer.tsx:444`                                     | M      |
| UX-3 | **Pipeline "Edit" button navigates to blank Workbench** -- does not call `loadTask()`, so user sees empty form                                                             | sprint-tasks-pm C3                                         | `SprintPipeline.tsx:276`, `TaskDetailDrawer.tsx:264-267` | S      |
| UX-4 | **Duplicate merge controls with divergent behavior** -- two merge buttons visible simultaneously, one has no confirmation dialog                                           | code-review-ax 3.1, code-review-sd 3.6, code-review-pm 2.2 | `MergeButton.tsx`, `PRStationActions.tsx`                | M      |
| UX-5 | **Keyboard shortcuts fire in contentEditable** -- typing in Monaco editor triggers app shortcuts (`?` toggles overlay, `Cmd+P` opens palette instead of Monaco quick-open) | shell-design-sd 2.1                                        | `App.tsx:177-178`                                        | S      |

---

## 3. Cross-Cutting Themes

### 3.1 Dead Code Everywhere (all 5 groups)

Every domain group found significant dead code. The sprint domain alone has ~3,700 lines of orphaned SprintCenter-era components (sprint-tasks-sd). The workspace domain has 581+ lines of dead agent components plus a 409-line dead unified store (workspace-ax C1, workspace-sd). The main process has 5 dead IPC channels (main-process-ax). This is the result of successive UI redesigns without cleanup passes.

### 3.2 Competing Design Systems (shell-design-ax, shell-design-sd, shell-design-pm + all domain groups)

Every group flagged styling inconsistency. The codebase has: (a) `ui/` BEM components with `--bde-*` CSS vars, (b) `neon/` components with inline `tokens.*` styles, (c) hardcoded `rgba()` values violating the CSS theming rule, and (d) `onMouseEnter`/`onMouseLeave` handlers substituting for CSS `:hover`. Source Control, Dashboard, and most agent components use inline styles exclusively. This blocks light theme support and makes the codebase resistant to design iteration.

### 3.3 Missing Error Feedback (all PM audits)

All five PM audits found silent failures or missing error states:

- PR Station: infinite loading skeleton when GitHub is unreachable (code-review-pm 2.3)
- Agent Manager: terse internal error labels instead of actionable messages (main-process-pm C1)
- Sprint Pipeline: spec validation errors flattened to strings crossing IPC boundary (main-process-pm S3)
- Workspace: phantom slash commands `/approve` and `/files` that silently do nothing (workspace-pm 2.1)
- Shell: `ErrorBoundary` has no retry button -- crashed views require full app reload (shell-design-sd 2.3)

### 3.4 Duplicated Utility Functions (sprint-tasks-ax S3, sprint-tasks-sd 4.1-4.5, workspace-ax M1-M3)

`formatElapsed`, `getDotColor`, `statusBadgeVariant`, `getStatusDisplay`, `priorityVariant`, `PRIORITY_OPTIONS`, `formatDuration`, `formatTime`, and `formatFileSize` are each duplicated 2-4 times across components. At least 9 distinct helper functions need extraction to shared utilities.

### 3.5 `window.confirm()` / `window.prompt()` Usage (sprint-tasks-sd 2.1, sprint-tasks-pm C2, workspace-sd 4.3, workspace-pm 3.4, shell-design-sd 2.2)

Five reports flagged native browser dialogs (`confirm()`, `prompt()`) in an Electron app. These block the renderer thread, break the neon aesthetic, and are inconsistent with the app's own `useConfirm()` hook and `ConfirmModal` component. Found in: SprintDetailPane, CommandPalette, FileSidebar.

### 3.6 Hardcoded `rgba()` Values (code-review-ax 3.6, shell-design-ax 3.6, shell-design-sd 3.5, code-review-pm 3.8)

Multiple reports flagged hardcoded `rgba()` in DashboardView, SidebarItem, OverflowMenu, InlineDiffDrawer, neon-shell.css, and diff-neon.css. These violate the CSS theming rule in CLAUDE.md and will not adapt to light theme.

### 3.7 Inline Styles vs CSS Classes (all groups)

Every domain has components using inline `style={{}}` with `tokens.*` instead of CSS classes, despite CLAUDE.md stating: "Do NOT use inline `tokens.*` styles for neon views -- use CSS classes." Worst offenders: Source Control (entire view), DashboardView, TaskMonitorPanel, SprintTaskRow, all neon primitives, most agent components.

---

## 4. Dead Code Summary

### Sprint & Tasks Domain (~3,700 lines)

| Component                                                                                                                                                                         | Lines      | Source              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------- |
| `SprintCenter.tsx` + subtree (SprintTaskList, SprintDetailPane, KanbanBoard, KanbanColumn, TaskCard, BulkActionBar, SprintTaskRow, TaskTable, AgentStatusChip, TaskEventSubtitle) | ~2,400     | sprint-tasks-sd 5   |
| `NewTicketModal.tsx`                                                                                                                                                              | 436        | sprint-tasks-ax S5  |
| `LogDrawer.tsx`                                                                                                                                                                   | 252        | sprint-tasks-sd 5   |
| `TaskMonitorPanel.tsx`                                                                                                                                                            | 337        | sprint-tasks-sd 5   |
| `SpecDrawer.tsx`                                                                                                                                                                  | 305        | sprint-tasks-sd 5   |
| `PRList.tsx`                                                                                                                                                                      | 194        | sprint-tasks-sd 5   |
| `CircuitPipelineExample.tsx`                                                                                                                                                      | 104        | sprint-tasks-sd 5   |
| `SprintTaskList.example.tsx`                                                                                                                                                      | 150        | sprint-tasks-sd 5   |
| `EventCard.tsx`                                                                                                                                                                   | 371        | sprint-tasks-sd 5   |
| 3 component-level markdown files                                                                                                                                                  | ~50        | sprint-tasks-ax M7  |
| `exitCode` state in LogDrawer + TaskMonitorPanel                                                                                                                                  | dead state | sprint-tasks-sd 3.6 |

Dead CSS in `sprint-neon.css`: estimated 600-800 lines of orphaned selectors.

### Workspace Domain (~1,000+ lines)

| Component                                       | Lines                        | Source                             |
| ----------------------------------------------- | ---------------------------- | ---------------------------------- |
| `AgentTimeline.tsx`                             | 95                           | workspace-ax S5, workspace-sd 5    |
| `TimelineBar.tsx`                               | 114                          | workspace-ax S5, workspace-sd 5    |
| `AgentDetail.tsx`                               | 211                          | workspace-ax C2, workspace-sd 5    |
| `SteerInput.tsx`                                | 103                          | workspace-sd 5                     |
| `HealthBar.tsx`                                 | 70                           | workspace-ax S5, workspace-sd 5    |
| `PaneStatusBar.tsx`                             | 42                           | workspace-ax S5, workspace-sd 5    |
| `EmptyState.tsx` (terminal)                     | 49                           | workspace-ax S5, workspace-sd 5    |
| `useAgentsStore` (unified mega-store)           | 409                          | workspace-ax C1, workspace-sd 3.1  |
| Associated test files (4+)                      | ~600                         | workspace-sd 5                     |
| Terminal `fontSize`/zoom state (never consumed) | dead feature                 | workspace-sd 3.5                   |
| `LaunchpadReview.tsx` "Save as Template" button | dead code behind `{false &&` | workspace-sd 4.6, workspace-pm 2.3 |

### Main Process (~dead IPC channels + handlers)

| Item                                                             | Source                                  |
| ---------------------------------------------------------------- | --------------------------------------- |
| `config:getAgentConfig` -- returns null                          | main-process-ax 3.7                     |
| `config:saveAgentConfig` -- no-op                                | main-process-ax 3.7                     |
| `local:sendToAgent` -- returns error                             | main-process-ax 5                       |
| `local:isInteractive` -- returns false                           | main-process-ax 5                       |
| `agent:killLocal` -- returns error, misplaced in window-handlers | main-process-ax 3.4                     |
| Stale "Supabase proxy" JSDoc in server.ts                        | main-process-ax 4.8, main-process-pm M1 |

### Shell & Design

| Item                                                | Source              |
| --------------------------------------------------- | ------------------- |
| `ui/Tooltip.tsx` (if consolidated to NeonTooltip)   | shell-design-ax 2.2 |
| Duplicate `VIEW_LABELS`/`VIEW_ICONS` across 4 files | shell-design-ax 2.1 |
| `ShortcutsOverlay` inline in App.tsx                | shell-design-ax 3.4 |

### Estimated Total Dead Code: ~5,500-6,500 lines

(Components + tests + associated CSS selectors)

---

## 5. Quick Wins

High-impact, low-effort issues (Effort S) that should be tackled first:

| #   | Issue                                                                                                                                   | Source                                                     | Impact                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| 1   | **Fix symlink path traversal** -- add `fs.realpathSync()` to `validateIdePath()`                                                        | workspace-sd 2.1                                           | Security fix, 3-line change                    |
| 2   | **Fix contentEditable keyboard guard** -- add `isContentEditable` check in App.tsx                                                      | shell-design-sd 2.1                                        | Stops shortcuts firing in Monaco editor        |
| 3   | **Fix SprintTask type re-export** -- import from `shared/types` not SprintCenter                                                        | sprint-tasks-ax C3                                         | Removes artificial coupling, unblocks cleanup  |
| 4   | **Fix Pipeline "Edit" button** -- call `loadTask()` before `setView('task-workbench')`                                                  | sprint-tasks-pm C3                                         | Fixes broken edit workflow                     |
| 5   | **Add retry button to ErrorBoundary**                                                                                                   | shell-design-sd 2.3                                        | Users can recover crashed views without reload |
| 6   | **Validate PR label colors** -- regex check for `label.color` before CSS injection                                                      | code-review-sd 2.2                                         | CSS injection prevention                       |
| 7   | **Replace `window.confirm()`** in SprintDetailPane, CommandPalette, FileSidebar                                                         | sprint-tasks-sd 2.1, shell-design-sd 2.2, workspace-sd 4.3 | Consistent UX, non-blocking                    |
| 8   | **Wire terminal fontSize from store to xterm**                                                                                          | workspace-sd 3.5, workspace-pm 2.2                         | Fixes broken zoom shortcuts                    |
| 9   | **Remove phantom `/approve` and `/files` commands** from autocomplete                                                                   | workspace-pm 2.1                                           | User trust                                     |
| 10  | **Delete 5 dead IPC channels** (config:getAgentConfig, config:saveAgentConfig, local:sendToAgent, local:isInteractive, agent:killLocal) | main-process-ax 3.4, 3.7, 5                                | Reduces surface area                           |
| 11  | **Consolidate VIEW_LABELS/VIEW_ICONS** into single `view-registry.ts`                                                                   | shell-design-ax 2.1                                        | Eliminates 4-file sync landmine                |
| 12  | **Fix `getPrMergeability` abort signal** -- wire signal or remove parameter                                                             | code-review-ax 2.2, code-review-sd 3.4                     | Prevents stale mergeability display            |
| 13  | **Invalidate github-cache after mutations**                                                                                             | code-review-ax 3.4                                         | Prevents stale data after merge/review         |
| 14  | **Improve agent failure notes** -- add actionable recovery guidance                                                                     | main-process-pm C1                                         | Biggest PM-side UX gap                         |

---

## 6. Action Items by Sprint

### Sprint 1: Security + Safety

Focus: Close the critical security gaps and fix data-integrity issues.

- [ ] **SEC-2**: Add `fs.realpathSync()` to IDE path validation (S)
- [ ] **SEC-3**: Implement endpoint/method allowlist for `github:fetch` IPC proxy (M)
- [ ] **SEC-4**: Remove `allow-scripts` from PlaygroundModal iframe sandbox or document accepted risk (S)
- [ ] **SEC-5**: Replace CORS `*` with specific origin or remove (S)
- [ ] **SEC-6**: Validate `backupPath` for SQL metacharacters (S)
- [ ] **SEC-1**: Plan renderer sandbox re-enablement (L -- may span multiple sprints)
- [ ] **main-process-sd C4**: Document SSE token query-string as accepted risk or switch to cookie auth (S)
- [ ] **main-process-sd S1**: Fix worktree lock TOCTOU race with atomic lock acquisition (S)
- [ ] **main-process-sd S7**: Add regex assertion for SQL column allowlist entries (S)
- [ ] **UX-5**: Fix contentEditable keyboard guard (S)
- [ ] **shell-design-sd 2.4**: Validate `viewLink` against View union before `setView()` (S)

### Sprint 2: Dead Code + Cleanup

Focus: Remove accumulated dead code to reduce maintenance surface by ~5,000+ lines.

- [ ] Delete SprintCenter subtree: SprintCenter, SprintTaskList, SprintDetailPane, KanbanBoard, KanbanColumn, TaskCard, BulkActionBar, SprintTaskRow, TaskTable, AgentStatusChip, TaskEventSubtitle, CircuitPipelineExample, SprintTaskList.example (L)
- [ ] Delete NewTicketModal.tsx (S)
- [ ] Delete orphaned sprint components: LogDrawer, TaskMonitorPanel, SpecDrawer, PRList, EventCard + their tests (M)
- [ ] Delete dead agent components: AgentTimeline, TimelineBar, AgentDetail, SteerInput, HealthBar, PaneStatusBar, EmptyState + their tests (M)
- [ ] Delete `useAgentsStore` unified store + tests (S)
- [ ] Remove 5 dead IPC channels and their handler/preload code (S)
- [ ] Remove dead `exitCode` state from LogDrawer/TaskMonitorPanel (S)
- [ ] Remove hidden "Save as Template" button and prop chain (S)
- [ ] Remove "Add Custom" no-op tile from LaunchpadGrid (S)
- [ ] Clean orphaned CSS selectors in `sprint-neon.css` and `agents-neon.css` (M)
- [ ] Remove 3 component-level markdown docs from sprint/ (S)
- [ ] Extract duplicated utilities: `formatElapsed`, `getDotColor`, `statusBadgeVariant`, `getStatusDisplay`, `priorityVariant`, `PRIORITY_OPTIONS`, `formatDuration`, `formatTime`, `formatFileSize` into shared `lib/task-format.ts` and `lib/format-utils.ts` (M)

### Sprint 3: Architecture

Focus: Fix structural issues and consolidate design systems.

- [ ] **ARCH-1**: Extract shared `useSprintOrchestration()` hook from SprintCenter/SprintPipeline (M)
- [ ] **ARCH-2**: Route Queue API and IPC handlers through `sprint-service.ts` for consistent notifications (M)
- [ ] **ARCH-3**: Replace hardcoded `REPO_OPTIONS` with dynamic resolution in PR Station (M)
- [ ] **ARCH-5**: Create `view-registry.ts` as single source for view metadata (S)
- [ ] **ARCH-6**: Replace 4 `setOnStatusTerminal` setters with event bus or centralized service (M)
- [ ] Extract `runSdkStreaming` to shared `sdk-streaming.ts` (main-process-ax 2.1, main-process-sd M1) (S)
- [ ] Extract batch update logic to `sprint-service.ts` (main-process-ax 3.5) (S)
- [ ] Remove re-export chain in `sprint-local.ts` (main-process-ax 3.3) (M)
- [ ] Decompose `DiffViewer.tsx` (703 lines) into FileList, VirtualizedDiffContent, PlainDiffContent (code-review-ax 3.2) (M)
- [ ] Split `WorkbenchForm.tsx` into submission hook, semantic checks hook, and form component (sprint-tasks-ax S2) (M)
- [ ] Extract `usePRDetail` hook from PRStationDetail (code-review-ax 3.3) (M)
- [ ] Fix NeonSidebar Zustand selector anti-pattern (shell-design-sd 3.1) (S)
- [ ] Move `fileContents` from IDEView local state to IDE store (workspace-ax S3, workspace-sd 3.2) (M)
- [ ] Address dual token system: make spacing/radius tokens reference CSS vars (shell-design-ax 3.3) (M)
- [ ] Consolidate tooltip components (shell-design-ax 2.2) (S)
- [ ] Deduplicate MergeButton/PRStationActions merge dropdown (code-review-ax 3.1) (M)

### Sprint 4: UX Polish

Focus: Empty states, error messages, discoverability, and missing workflows.

- [ ] **UX-1**: Rewrite agent failure notes with actionable guidance (S)
- [ ] **UX-2**: Add indicator or fallback when virtualized diff disables commenting (M)
- [ ] **UX-3**: Fix Pipeline "Edit" to load task into Workbench (S)
- [ ] **UX-4**: Consolidate merge controls to single component (M)
- [ ] Add error state for PR Station when GitHub is unreachable (code-review-pm 2.3) (S)
- [ ] Add `beforeunload` flush for pending review localStorage (code-review-sd 3.2) (S)
- [ ] Add pull/fetch to Source Control (code-review-pm 3.3) (M)
- [ ] Add reply-to-comment in diff viewer (code-review-pm 3.1) (M)
- [ ] Dashboard empty state with "Get Started" guidance (shell-design-pm 2.2) (S)
- [ ] Panel system onboarding hints (shell-design-pm 2.1) (M)
- [ ] Add confirmation dialog before `/stop` kills agent (workspace-pm 3.3) (S)
- [ ] Add changed-files summary + PR link to agent completion card (workspace-pm 3.2) (M)
- [ ] Add search/filter to agent console (workspace-pm 3.7) (M)
- [ ] Load sidebar pin configuration on startup (shell-design-pm 2.3) (S)
- [ ] Replace `window.confirm()`/`window.prompt()` in all remaining locations (S)
- [ ] Migrate Source Control to neon CSS (code-review-ax 3.5) (L)
- [ ] Create `dashboard-neon.css` and migrate DashboardView from inline styles (shell-design-ax 3.1) (M)
- [ ] Replace hardcoded `rgba()` values with CSS custom properties across all files (M)
- [ ] Fix orphan recovery and shutdown to set notes explaining task re-queue (main-process-pm C2, C3) (S)

---

## 7. Agreement & Disagreement

### High Confidence (Multiple Personas Agree)

**Dead SprintCenter subtree**: All three sprint-tasks auditors agree SprintCenter and its component tree are dead code that should be removed. AX estimates ~1,200 lines, SD counts ~3,700 lines including associated CSS. PM confirms task creation was moved to Workbench.

**Duplicate merge controls in PR Station**: All three code-review auditors flagged the dual MergeButton/PRStationActions issue. AX focuses on code duplication, SD on the double-merge race condition, PM on the confusing UX of two buttons with different confirmation behavior.

**Inline styles vs CSS classes**: All 15 reports mention this in some form. Universal agreement that Source Control, DashboardView, agent components, and neon primitives should migrate to CSS classes.

**`window.confirm()` usage**: Five reports across three domains independently flagged native browser dialogs. Universal agreement to replace with `useConfirm()` hook.

**Dead agent components**: workspace-ax and workspace-sd independently verified AgentTimeline, TimelineBar, AgentDetail, HealthBar, PaneStatusBar, EmptyState as unused. CLAUDE.md already documents AgentTimeline as dead.

**Hardcoded `rgba()` violations**: Four reports across two domains flag this. Universal agreement these must use CSS custom properties.

**Terminal zoom broken**: workspace-sd 3.5 and workspace-pm 2.2 independently discovered the store state is never consumed by TerminalPane.

**VIEW_LABELS duplication**: shell-design-ax 2.1, shell-design-sd 4.1, and shell-design-pm 4.3 all flag the 4-file duplication risk.

**Duplicate `runSdkStreaming`**: main-process-ax 2.1, main-process-sd M1, and main-process-pm M4 all found the identical implementation in two files.

**Queue API notifications gap**: main-process-ax 3.2 and main-process-sd (via repository pattern analysis) agree that Queue API writes bypass notification channels.

### Disagreements and Different Perspectives

**LogDrawer/TaskMonitorPanel status**: sprint-tasks-ax identifies these as live duplicates needing consolidation. sprint-tasks-sd identifies them as dead code (not imported by any production component). SD's analysis is more accurate -- both are only imported by tests and legacy SprintCenter, making them dead in the production component tree.

**`ChatRenderer` vs `ConsoleLine` priority**: workspace-ax recommends choosing one renderer and deprecating the other. workspace-pm sees both as serving different contexts (terminal output tab uses ChatRenderer, main console uses ConsoleLine) and suggests keeping both but sharing the virtualizer. The pragmatic approach is workspace-ax's recommendation -- determine the canonical renderer.

**Severity of CORS wildcard**: main-process-sd rates this Medium (mitigated by auth), while a strict security lens would rate it higher. Given the localhost-only scope and auth requirement, Medium is reasonable.

**Repository pattern enforcement**: main-process-ax advocates for routing all writes through the repository. The CLAUDE.md explicitly states IPC handlers and Queue API "still import sprint-queries directly -- they're thin enough not to need the abstraction." This is a deliberate architectural decision, though the notification inconsistency it creates (main-process-ax 3.2) is a real problem regardless.

**DashboardView severity**: shell-design-ax treats the inline styles as Significant (style consistency). shell-design-pm treats the empty state as Critical (first-run experience). Both are valid but from different lenses -- for a new user, the empty Dashboard with no guidance is the more impactful issue.

**Onboarding Supabase check**: Only shell-design-pm 3.7 flags this. Since Supabase is optional/legacy and the check is marked "optional" in the UI, this is low priority but the labeling is indeed misleading for new users.
