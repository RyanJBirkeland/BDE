# BDE Quality Audit — Synthesis

**Date:** 2026-04-07
**Scope:** Pre-launch quality + product-completeness audit ("does it work _well_?")
**Method:** 3 teams × 5 personas = 15 independent reports. Findings below are deduped and confidence-scored by how many personas/teams flagged the same issue.

**Total findings across 15 reports:** ~293 (roughly 40 CRITICAL, 130 MAJOR, 120 MINOR).
**High-confidence items** (flagged by 3+ personas or all 3 teams): **18**.

---

## The Bottom Line

BDE is not broken. It is **uneven**. The happy path — draft a spec, queue it, watch an agent work, ship it — is genuinely compelling and the neon aesthetic lands. But when you hold all 15 reports side by side, three patterns dominate:

1. **Naming drift is the single biggest trust hit.** The product cannot decide what to call its own features. "Sprint Pipeline" vs "Task Pipeline," "Epic/Task Group/Group/Sprint," "Agents/Fleet/Scratchpad/Launchpad," "cost" vs "tokens," "Command Center," "PR Station" (dead but referenced) — every persona on every team independently flagged this. A new user reading the README sees one name, onboarding uses another, the sidebar uses a third, and agents are trained on a fourth.

2. **The best features are hidden.** Ship It, Dev Playground, Promote to Code Review, slash-command steering, Morning Briefing, freshness/rebase, Research Codebase, Cross-Repo Contract — these are the demo moments that would sell BDE, and they are buried behind "Advanced" folds, 10-pixel sidebar notes, grayed-out disabled states, or missing from the README entirely. Marketing flagged the same 5–6 features across all three teams.

3. **Infrastructure is paying for velocity.** The agent manager is a 1,032-line god-object, the IPC surface is 144 channels with no quarantine, the repository pattern is documented but bypassed in 45 files, `TaskTerminalService` is wired through four module-level setters with silent-failure paths, migration v17/v20 silently dropped indexes, the renderer sees only 7 days of tasks while main sees all, and prompt rules are duplicated 4–5 times across the preamble + CLAUDE.md + memory modules + personalities. None of this is on fire. All of it compounds.

None of this is launch-blocking in a "the app crashes" sense. Most of it is launch-blocking in a "a careful reviewer will notice in the first 10 minutes" sense.

---

## Top 20 Prioritized Action Items

Ranked by **confidence × severity × visibility** (roughly: what would a public demo most benefit from fixing?). Items labeled with the reports that flagged them.

### P0 — Demo Killers (fix before anyone else sees the app)

**1. Rewrite the "Create First Task" sample so it runs unmodified.**

- Ships with `REPLACE_WITH_ENTRY_FILE` placeholder. First-run onboarding leads straight into it. Agent will thrash or fail. The 60-second demo dies here.
- Confidence: 1 persona (Gamma Marketing) but severity=critical because it's the first thing every new user touches.
- Files: `src/renderer/src/components/onboarding/steps/sample-first-task.ts:35-38`
- Fix: Ship a task with a literal repo-relative path (e.g., "Add a comment to README.md").

**2. Kill the legacy Supabase onboarding screen.**

- `Onboarding.tsx` still checks for `supabase.url` and blocks first launch after the new `OnboardingWizard` finishes. Users do onboarding twice in two different visual styles, and the second one references a backend that no longer exists.
- Confidence: Gamma PM (critical)
- Files: `src/renderer/src/App.tsx:419-432`, `src/renderer/src/components/Onboarding.tsx`
- Fix: Delete `Onboarding.tsx`. Have `OnboardingWizard.DoneStep` call `onReady` directly.

**3. Fix README factual errors.**

- Wrong clone URL (`rbtechbot/bde` vs `RyanJBirkeland/BDE`), advertises "cost charts" after migration to tokens, claims "86 typed channels"/"8 views"/"17 handler modules" (actuals: ~144/9/23), missing Task Planner from Views table, missing Ship It entirely, Workbench shortcut listed as "—" (actually ⌘0).
- Confidence: Bravo Marketing + Gamma Marketing (both critical)
- Files: `README.md` (many lines)
- Fix: Canonical clone URL sweep, regenerate counts, add Ship It feature section with screenshot, add Task Planner row to the Views table.

**4. Settings "About" tab is unreachable.**

- Built, imported, in `SECTION_MAP` and `SECTION_META`, but not in the `SECTIONS` array that renders the sidebar. Meanwhile every doc promises it exists.
- Confidence: Bravo PM + Gamma PM + Gamma Marketing (three teams)
- Files: `src/renderer/src/views/SettingsView.tsx:35-46`
- Fix: Add `{ id: 'about', label: 'About', icon: Info, category: 'App' }` to `SECTIONS`. One-line fix, three-team confidence.

**5. WebhooksSection is a 293-line orphan.**

- Complete settings panel exists, never imported anywhere except its own test. Webhooks are instead inlined into Agent Manager settings, where nobody will look for them.
- Confidence: Bravo PM + Gamma PM (critical in both)
- Files: `src/renderer/src/components/settings/WebhooksSection.tsx`, `AgentManagerSection.tsx:332`
- Fix: Either wire `WebhooksSection` into `SECTIONS` (probably under "Integrations") and remove the inlined version from Agent Manager, or delete the orphan.

### P1 — High-confidence cross-cutting fixes

**6. Settle the naming war — pick one name per concept and sweep.**

- The three-teams-high-confidence finding of the whole audit.
- **"Sprint Pipeline" vs "Task Pipeline"** → pick one (recommendation across all reports: **Task Pipeline**, since the UI already uses it and "sprint" implies agile ceremony BDE doesn't do)
- **"Epic" / "Task Group" / "Group" / "Sprint"** → the data model has BOTH `group_id` AND `sprint_id` on `SprintTask`, components use "Epic," stores use "groups," sidebar says "Task Planner." **Pick "Epic"** (most vivid) and rename the type, store, view, and drop the unused column.
- **"Agents" / "Fleet" / "Scratchpad" / "Launchpad"** → all four visible on one screen. Recommendation: **lean into "Scratchpad"** as the framing (matches Promote-to-Code-Review story), rename sidebar, drop "Fleet" and "Launchpad."
- **"cost" vs "tokens"** → product migrated to tokens, but README, CSS class names, and `ConsoleHeader` still say "cost/USD." Unify on tokens.
- Confidence: Every marketing persona, every PM persona, Gamma PE (for agent-side drift).
- Files: many — start with `view-registry.ts`, `README.md`, `BDE_FEATURES.md`, `WelcomeStep.tsx`, `sprint-pipeline-neon.css`, `taskGroups.ts` → `epics.ts`.

**7. Dedupe the pre-commit verification block across ALL agent prompts.**

- A pipeline agent currently reads the pre-commit rule **4–5 times** per spawn: (1) `UNIVERSAL_PREAMBLE` (line 57-68), (2) `DEFINITION_OF_DONE` (line 122), (3) auto-loaded `CLAUDE.md` MANDATORY section, (4) `testing-patterns.ts` memory module (which contradicts the others by saying `npm run test:coverage` not `npm test`), (5) the `Test Coverage` task template (which hardcodes threshold numbers the memory module explicitly forbids).
- The preamble hardcodes `"2563+ tests"` which violates the memory module's own rule about hardcoding test counts.
- The preamble forces `npm install` as the FIRST action "before reading any files" — but then tells the agent to "read this entire specification" immediately after.
- Confidence: Alpha PE + Bravo PE + Gamma PE (all three teams, all CRITICAL)
- Files: `src/main/agent-manager/prompt-composer.ts:51,57-68,122`, `src/main/agent-system/memory/testing-patterns.ts`, `src/shared/constants.ts:66`, `CLAUDE.md:34-42`
- Fix: One canonical pre-commit block (probably in the preamble). Remove the duplicates. Drop `2563+`. Use `npm run test:coverage` consistently. Move `npm install` rule out of `UNIVERSAL_PREAMBLE` and into a `pipeline`-only appendix (copilot/synthesizer have no Bash tool and literally cannot obey it).

**8. Fix the `TaskTerminalService` wiring — four setters is too fragile.**

- `_onStatusTerminal` is a module-level `let` mutated via `setOnStatusTerminal()` in **four separate files** (`sprint-local.ts`, `git-handlers.ts`, `review.ts`, `sprint-pr-poller.ts`). Each has its own "if (!\_onStatusTerminal) logger.warn(...)" fallback. Forgetting to wire one silently breaks dependency resolution forever — the two `warn` comments already in code prove this has happened before.
- Confidence: Alpha Arch + Bravo Arch + Gamma Arch (all three teams, all CRITICAL)
- Files: `src/main/handlers/sprint-local.ts:75-79,188-197`, `src/main/handlers/git-handlers.ts:136-140`, `src/main/handlers/review.ts:27-31`, `src/main/sprint-pr-poller.ts`
- Fix: Replace the four setters with a single `registerXxxHandlers(deps)` pattern that takes `terminalService` as a required constructor arg. Or make `updateTask()` itself detect terminal transitions and fire the hook so callers can't forget.

**9. Route Source Control, Code Review actions, and synthesizer through the real abstractions.**

- Repository pattern (`ISprintTaskRepository`) is documented as "always through this" but **45 files import `sprint-queries` directly**, including `sprint-local.ts` which simultaneously imports from `sprint-queries`, `sprint-service`, AND constructs the repository. Three parallel data-access layers.
- `spec-synthesizer.ts` bypasses `buildAgentPrompt` entirely — `synthesizerPersonality` is dead code.
- Four other prompts (`sprint-spec.ts`, `spec-semantic-check.ts`, `review-summary.ts`, `review-summary.ts`) also bypass the composer with hand-written "You are an expert..." strings.
- Confidence: Gamma Arch (critical) + Alpha PE + Gamma PE (both on synthesizer)
- Fix: Decide — either commit to the abstractions or delete them. Current half-state is "docs lie, new contributors copy the wrong pattern."

**10. Promote hidden marquee features in the README and UI.**
Flagged independently by all three marketing personas:

- **Ship It** — single best demo moment, rocket button, not in README, Mermaid diagram doesn't show it, onboarding doesn't mention it.
- **Dev Playground** — two README sentences, zero screenshots, hidden inside "Advanced" fold in Workbench. Should be the marquee.
- **Promote to Code Review** — just shipped in commit `3b2f8763`, only visible via a 10px footnote in AgentsView, no docs.
- **Slash commands** (`/checkpoint`, `/stop`, `/scope`, `/focus`, `/retry`, `/test`, `/status`) — seven powerful commands, entirely discoverable only by typing `/`. Not in README, no help modal, no button.
- **Morning Briefing** — "your agents worked while you slept" card that never shows up on a fresh demo (gated by last-window-close timestamp).
- **Freshness / Rebase** — cryptic `Fresh/Stale/Conflict/Unknown` labels, no screenshots, no explanation.
- **Research Codebase** button — killer "the AI reads your code before drafting a spec" feature labeled only "Research Codebase" with no subcopy.
- Confidence: Alpha Marketing + Bravo Marketing + Gamma Marketing.
- Fix: New README subsections for Ship It and Dev Playground with screenshots. Auto-toast "Done — promote to Code Review?" on adhoc agent completion. Help modal for slash commands triggered by "?" in the CommandBar.

### P2 — High-leverage senior-dev friction

**11. Scope Cmd+Enter to the Workbench form; fix the Code Review action loop.**

- Cmd+Enter in Workbench is a global `window.addEventListener` — fires from anywhere in tear-off windows, IDE panels, anywhere. Can accidentally queue half-finished tasks.
- Every Code Review action (Ship It, Merge, Revise, Discard, Rebase) calls `loadData()` + `selectTask(null)`, dumping the user back to "no task selected" mid-flow and triggering a full sprint task refetch. Defeats the j/k navigation entirely.
- Confidence: Alpha SD (critical), Alpha Arch, Gamma SD
- Files: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:348-369`, `src/renderer/src/components/code-review/ReviewActions.tsx:71,100,128,174,189,214`
- Fix: Scope the Workbench listener to `containerRef`. After a Review action, advance to the next review task in the queue; patch the single task locally, don't refetch.

**12. Fix the local merge conflict dead-end.**

- `mergeLocally` and `rebase` return "conflicts detected" with no file list, no resolution UI, no "Open in IDE" link. The user is dumped to terminal — violating the entire product promise.
- Confidence: Alpha PM + Alpha SD (both CRITICAL)
- Files: `src/renderer/src/components/code-review/ReviewActions.tsx:101-108,191-198`, IPC handler behind it
- Fix: Return `{ success: false, conflictFiles: string[] }`. Render an inline conflict panel with per-file "Open in IDE" buttons and a "Try rebasing first" CTA when freshness is `stale`.

**13. Source Control has no Pull, no Fetch, no Amend, no per-file Discard.**

- `git:pull` and `git:fetch` IPC channels don't exist at all. Meanwhile the empty state helpfully says "pull updates to see changes here."
- Confidence: Bravo PM + Bravo SD (both CRITICAL)
- Files: `src/main/handlers/git-handlers.ts`, `src/renderer/src/components/git-tree/CommitBox.tsx`
- Fix: Add the IPC channels, surface buttons next to Push. Add "Amend last commit" toggle. Add per-row Discard/Restore.

**14. IDE has no Find-in-Files, no project search.**

- ⌘F is bound to terminal find, not editor find. No ⌘⇧F for project-wide. No problems panel. README sells BDE as a "development environment" and it can't grep its own repo.
- Confidence: Bravo PM + Bravo SD
- Files: `src/renderer/src/views/IDEView.tsx`, `src/main/handlers/ide-fs-handlers.ts`
- Fix: Wire Monaco's built-in find widget to ⌘F when editor focused. Add a sidebar Search panel using the existing ripgrep path (or add one).

**15. Agent CommandBar is a single-line `<input>`.**

- Can't paste stack traces, code, multi-paragraph instructions. By contrast, Launchpad uses textarea (but only 2 rows) and Code Review revision modal uses textarea.
- Confidence: Bravo PM + Bravo SD (both MAJOR)
- Files: `src/renderer/src/components/agents/CommandBar.tsx:207-221`
- Fix: Convert to auto-growing textarea, Enter to send, Shift+Enter for newline.

**16. Agent Manager settings require full app restart.**

- `maxConcurrent`, `defaultModel`, `worktreeBase`, `maxRuntimeMs`, `autoStart` are read once at boot. No UI warning. No `app.relaunch()` button. Restart kills running terminals, in-flight agents, file watchers, and unsaved IDE state.
- Confidence: Bravo SD (critical)
- Fix: Hot-reload concurrency at minimum. Add "Save & Restart" button with `app.relaunch()` fallback. Persist terminal tabs across restart so it hurts less.

**17. Delete the fake `estimateCost`.**

- `ConsoleHeader.tsx:28` returns `events.length × 0.001` as a USD estimate. Has nothing to do with actual tokens or pricing. Shown live in orange italics next to the real `costUsd`. After the token migration, the product now: advertises cost in the README, delivers tokens on the Dashboard, and fabricates a dollar figure in the agent header.
- Confidence: Bravo PM + Bravo Marketing + Bravo SD (three personas, same team)
- Files: `src/renderer/src/components/agents/ConsoleHeader.tsx:28-31,155-162`
- Fix: Delete entirely. Show "—" until the SDK reports real `costUsd`. Or expose real interim token usage.

**18. Fix the view shortcut pattern.**

- ⌘1 Dashboard, ⌘2 Agents, ⌘3 IDE, ⌘4 Task Pipeline, ⌘5 Code Review, ⌘6 Source Control, ⌘7 Settings, ⌘8 Task Planner, **⌘0** Task Workbench, ⌘9 unused. Workbench is the primary task-creation surface and gets the worst shortcut.
- Confidence: Alpha PM + Bravo PM + Gamma PM + Gamma SD
- Fix: Move Workbench to ⌘9, or swap with Settings. Reserve ⌘0 for future "reset zoom" if ever needed.

### P3 — Architectural scar tissue worth touching now

**19. Add missing SQLite indexes; audit migration drift.**

- Migration v17 and v20 silently dropped `idx_sprint_tasks_claimed_by` and `idx_sprint_tasks_pr_number` during full-table rewrites for CHECK constraint changes. These columns are queried every 30s by the drain loop and 60s by the PR poller. Full scans today, quadratic cost as the table grows.
- No compound index on `(status, next_eligible_at)`, `(status, completed_at)`, or `(pr_status, status)` despite these being hot-path.
- `sprint_tasks` has been rewritten 4 times for CHECK constraints alone; no test snapshots the final schema; v18/v19 add-and-remove cruft remains.
- Renderer polls `listTasksRecent()` (7-day window) but treats the result as the canonical task list — dependency-picker, partition, DAG overlay all break for older tasks, while main-process PR poller and dep resolver see the full set.
- Confidence: Alpha Arch + Bravo Arch (both CRITICAL)
- Files: `src/main/db.ts`, `src/main/data/sprint-queries.ts`, `src/main/handlers/sprint-local.ts:84-86`
- Fix: New migration v36 that (a) re-adds the dropped indexes, (b) creates compound indexes, (c) deletes `useNativeSystem` cruft. Add a schema-snapshot test. Add `sprint:listFull({ since? })` IPC for views that need history, or document the 7-day window unambiguously.

**20. Fix the Dev Playground XSS vector.**

- `playground:show` IPC handler (`playground-handlers.ts:55`) reads the HTML file and broadcasts it **raw** to the renderer. The parallel auto-detect path in `run-agent.ts:136-137` correctly calls `DOMPurify.sanitize`. Both broadcast on the same channel; the renderer iframe has `sandbox="allow-scripts"`. An `allow-scripts` iframe + unsanitized payload is exactly the DOMPurify threat model.
- Confidence: Bravo Arch (critical, security)
- Files: `src/main/handlers/playground-handlers.ts:55`, `src/main/agent-manager/run-agent.ts:136-137`
- Fix: Extract `sanitizePlaygroundHtml()` to a shared module, call from BOTH paths, add a regression test asserting `<script>alert(1)</script>` is stripped on both paths.

---

## Themes (clusters of related findings)

### Theme A: The product has multiple names for the same thing

Flagged by all three marketing personas, all three PM personas, Gamma PE.

| Concept            | Names in use                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| The execution view | Sprint Pipeline, Task Pipeline, Sprint Center, Pipeline Center, SprintView, sprint-pipeline-neon.css |
| Task containers    | Epic, TaskGroup, Group, Sprint, Task Planner, Plan, Workflow                                         |
| Adhoc agent space  | Agents, Fleet, Scratchpad, Launchpad, Command Center                                                 |
| Money metric       | Cost, Cost & Usage, USD, tokens                                                                      |
| Review UI          | Code Review Station, PR Station (stale skill), Review Queue                                          |
| What agents do     | queue, task, backlog, draft                                                                          |

**Why this hurts:** Every time a user reads the README, opens the app, types into Copilot, or reads an agent's response, the names don't match. Agents themselves are trained on `BDE_FEATURES.md` as context, so when they reference features they use one vocabulary while the UI uses another. New users bounce; careful reviewers notice in 30 seconds; search and documentation fragment.

**Fix cost:** Low. It's mostly a rename sweep plus discipline on what goes in `view-registry.ts`, `BDE_FEATURES.md`, and `README.md`. Budget: 1 day.

### Theme B: The best features are invisible

Flagged by all three marketing personas.

The product has at least **7 features** that would be the first thing you'd demo and all of them are hidden:

- Ship It (rocket button — the climax of the product story)
- Dev Playground (inline HTML rendering — the most screenshot-worthy thing BDE does)
- Promote to Code Review (just shipped, only explained in a 10px footnote)
- Slash-command agent steering (`/checkpoint` is the most novel — save progress mid-run)
- Morning Briefing ("what happened while you slept" card, gated by last-close timestamp)
- Freshness / one-click rebase (answers the "what if main moved?" objection)
- Research Codebase (the copilot reads code before drafting a spec)
- Cross-Repo Contract (double-nested inside "Advanced" fold, not in README)

**Why this hurts:** These are the answers to "why BDE instead of raw Claude Code?" They're the differentiators. Every one of them is either in the README footnotes, behind a disclosure, or documented only in CLAUDE.md. A scanner who only looks at images concludes BDE is yet another agent-monitoring dashboard.

**Fix cost:** Medium. Screenshots, README restructuring, promoting controls out of folds, a "help" modal for slash commands. Budget: 2-3 days.

### Theme C: Prompt engineering is a house of contradictions

Flagged by all three prompt-engineer personas.

The agent prompt system has **two parallel universes** that don't know about each other:

- **Path A** (the disciplined one): `buildAgentPrompt()` in `prompt-composer.ts` → personality → memory → skills. Well-factored.
- **Path B** (the wild west): `spec-synthesizer.ts`, `spec-semantic-check.ts`, `sprint-spec.ts`, `review-summary.ts`. Four hand-written "You are an expert…" system prompts that never touch the composer. `synthesizerPersonality` is literally dead code — the only synthesizer call site bypasses it.

And within Path A, there are **specific contradictions** that cost tokens and trust:

- Pre-commit verification duplicated 4-5x across preamble, DoD, CLAUDE.md, memory, skills
- Hard-coded "2563+ tests" in the preamble that the memory module's own rule forbids
- `npm test` (preamble) vs `npm run test:coverage` (memory module) — pipeline agents will pass locally and fail CI
- `npm install` as mandatory FIRST action for copilot/synthesizer which have no Bash tools and cannot run it
- Assistant personality says "you work in the repo directly (not worktrees)" but `spawnAdhocAgent` puts it in a worktree
- Adhoc personality says "Do NOT run `git push`" but the branch appendix says `git push origin <branch>`
- `repoName` is never passed for adhoc/assistant spawns, so BDE conventions (`safeHandle`, Zustand rules, IPC patterns) are injected into agents working in `life-os`, `bde-site`, `repomap`
- Stale `pr-review.ts` skill says "PR Station view (Cmd+5)" — view was renamed to Code Review months ago
- `taskOrchestrationSkill` teaches agents to use `window.api.sprint.create` — but main-process agents have no `window` object
- `debuggingSkill` teaches agents to raw-UPDATE `sprint_tasks` via SQLite, bypassing `isValidTransition` and `resolveDependents`
- `SELF_REVIEW_CHECKLIST` includes "no hardcoded colors" and "preload .d.ts updated if IPC changed" — task-specific rules baked into the universal appendix
- `BDE_FEATURES.md` auto-loaded as agent context contains marketing-voice third-person descriptions of the agent reading it

**Why this hurts:** Every pipeline spawn starts at ~15-20k tokens before the agent does anything. Recency bias pushes the spec to the bottom where attention is weakest. Contradictory rules train the agent to ignore emphasis. "2563+" will be wrong the first time a test is removed.

**Fix cost:** Medium-high. Consolidation + plumbing `repoName` + rerouting the four bypass paths + deleting dead `synthesizerPersonality`. Budget: 3-5 days for a full prompt-system cleanup.

### Theme D: The data layer is documented honestly in CLAUDE.md but dishonestly in code

Flagged by Alpha Arch, Bravo Arch, Gamma Arch.

CLAUDE.md says:

- "Agent manager data access: always through `ISprintTaskRepository`, never direct sprint-queries imports"
- "Single writer to sprint_tasks"
- "Max one Zustand store per domain concern"

Reality:

- 45 files import `sprint-queries` directly. Only the agent manager honors the repository.
- Three parallel data-access layers (`sprint-queries`, `sprint-service`, `sprint-task-repository`) all routinely imported in the same file.
- 8 Zustand stores touch the task/review concern.
- `SprintTask` type has BOTH `group_id` AND `sprint_id` fields — suggesting the rename was incomplete.
- `task.prompt` vs `task.spec` precedence is silent: `taskContent = task.prompt || task.spec`. Tasks with both set silently use prompt, bypassing the `## Task Specification` wrapper entirely.
- `VALID_TRANSITIONS` state machine disagrees with the code that calls it (`active → blocked` and `review → blocked` missing, forward transitions from `cancelled` empty, etc.)
- `sprint:update` and `sprint:batchUpdate` filter through **two different allowlists** (`UPDATE_ALLOWLIST` vs `GENERAL_PATCH_FIELDS`) with no type enforcement that they match.
- The 35-column SELECT list is copy-pasted across 11+ functions in `sprint-queries.ts` (`updateTask`'s RETURNING clause silently omits `assigned_reviewer`, `cross_repo_contract`, `rebase_base_sha`, `rebased_at` — so optimistic updates appear to "revert" these fields).

**Why this hurts:** New contributors model on existing code. Existing code bypasses the abstractions. The abstractions decay into documentation lies. The state machine breaks silently the next time someone adds a transition. The audit trail returns incomplete rows.

**Fix cost:** High. This is real refactor work. Budget: 1-2 weeks for a proper cleanup, or fence it off at a boundary and accept the debt.

### Theme E: Cross-feature seams leak

Flagged by Gamma SD + several team-level findings.

- **Panel system mounts ALL tabs simultaneously** (display:none). Three tabbed views in one leaf = three sets of `document.addEventListener('keydown')` + three polling loops + three command registrations concurrently. Tear-off multiplies the problem. (`PanelLeaf.tsx:104-119`)
- **IDE `fs.watch` is a module-level singleton.** Opening a second root replaces the first. Tear-off windows fight each other. Can't watch an agent's worktree without losing the IDE's own root. (`ide-fs-handlers.ts:11-15`)
- **Global polling** runs every poller on app mount regardless of which views are open — dashboard polling even when the dashboard has never been opened. (`PollingProvider.tsx:11-21`)
- **Agent worktree edits don't surface anywhere** — Source Control only shows configured repos, not active worktrees. You cannot peek at an in-flight agent's diff without waiting for it to finish.
- **IDE saves can silently collide with agent edits** on the same file (agent works in worktree, user edits main checkout; later merge clobbers user's edit with no warning).
- **`bde:refresh` and `bde:escape` are dispatched but have no listeners** anywhere in the codebase. The keybinding UI happily lets you bind them.

**Why this hurts:** These are "hour 2 of daily use" bugs. The first hour, the app feels great. Then a senior dev starts running two things at once, tears off a panel, loses work, and concludes "this isn't ready."

**Fix cost:** Medium. Panel tab mounting is the biggest — either unmount inactive tabs or gate all side-effects behind `isActive`. Budget: 3-5 days.

### Theme F: IPC surface bloat + boundary erosion

Flagged by all three architect personas.

- 144 typed channels across 26 domain interfaces. No naming convention (`domain:verb`, `domain:verbNoun`, `verb:noun` all coexist).
- Preload bridge is a 538-line hand-maintained passthrough. Any new channel is 3 edits in 3 files.
- Redundant channels: `sprint:update`/`sprint:batchUpdate`/`sprint:unblockTask`/`sprint:retry` all are "patch with side effects." `sprint:exportTasks` and `sprint:exportTaskHistory` share 80% logic.
- Boundary violations: `agents:promoteToReview` lives in `AgentChannels` but writes to `sprint_tasks`.
- Error contract is inconsistent: some channels return `{ ok, error }`, some return `{ success }`, some `void` and throw.
- `safeHandle` swallows arg context — logs only the channel and error string, no stack trace, no args. Production errors impossible to reproduce.
- Four separate pollers (agent-manager drain, sprint-pr-poller, pr-poller, renderer polls) all hit the same `sprint_tasks` rows. Amplified by the `fs.watch` → broadcast → reload path.

**Fix cost:** Medium. The biggest wins are (a) split `ipc-channels.ts` per domain with a barrel re-export, (b) codegen the preload bridge, (c) unify the error contract. Budget: 3-5 days.

---

## Coverage Map

| Surface                             | Alpha      | Bravo                      | Gamma | Total findings                             |
| ----------------------------------- | ---------- | -------------------------- | ----- | ------------------------------------------ |
| Task Workbench                      | ✅✅✅✅✅ | —                          | ✅    | Heavy coverage                             |
| Sprint/Task Pipeline                | ✅✅✅✅✅ | —                          | ✅✅  | Heavy coverage                             |
| Code Review Station                 | ✅✅✅✅✅ | —                          | ✅✅  | Heavy coverage                             |
| Task Dependencies                   | ✅✅✅     | —                          | ✅    | Medium                                     |
| Task Planner                        | ✅✅       | —                          | ✅✅  | Medium                                     |
| Agents view / adhoc                 | —          | ✅✅✅✅✅                 | ✅    | Heavy                                      |
| Dev Playground                      | —          | ✅✅ (security, marketing) | ✅    | Medium                                     |
| IDE                                 | —          | ✅✅✅✅                   | ✅    | Heavy                                      |
| Source Control                      | —          | ✅✅✅✅                   | ✅    | Heavy                                      |
| Dashboard                           | —          | ✅✅                       | ✅    | Medium                                     |
| Settings                            | —          | ✅✅✅                     | ✅✅  | Heavy                                      |
| Panel System                        | —          | ✅                         | ✅✅  | Medium                                     |
| Onboarding                          | —          | —                          | ✅✅  | **Light — consider a dedicated follow-up** |
| Prompt system (pipeline)            | ✅✅       | —                          | ✅    | Heavy                                      |
| Prompt system (adhoc/assistant)     | —          | ✅✅                       | ✅    | Medium                                     |
| Prompt system (copilot/synthesizer) | ✅         | —                          | ✅✅  | Medium                                     |
| Database / migrations               | ✅✅       | ✅✅                       | ✅    | Heavy                                      |
| Agent Manager / lifecycle           | —          | ✅✅✅                     | ✅    | Heavy                                      |
| IPC topology                        | ✅         | ✅                         | ✅    | Medium (all three teams flagged)           |
| Native agent system                 | —          | ✅                         | ✅    | Light                                      |

**Under-covered:** Onboarding (two separate flows, and the audit only caught that from one persona). Accessibility (nobody looked specifically — ARIA is mentioned in passing, keyboard nav gaps are flagged throughout, but no dedicated pass). Electron packaging / auto-update / code signing. Windows/Linux portability (all reports assumed macOS). Security beyond the Playground XSS (no auth-store review, no keychain review, no path-traversal audit).

**Over-covered:** Prompt duplication (same finding hit 3x). Naming drift (same finding hit 6x). These are strong signals, not wasted effort.

---

## Suggested Sequencing

If you're reading this and deciding what to do Monday morning:

1. **One-hour wins (do first):** #1 (sample task placeholder), #2 (legacy onboarding), #4 (About tab), fake cost display (#17), dropped SQLite indexes (part of #19), playground sanitization (#20). All have high impact, low risk, and surface-level surface areas.

2. **One-day sweeps (next):** #3 (README rewrite), #6 (naming — pick 4 terms and sweep), #7 (prompt duplication cleanup), #10 (promote Ship It + Dev Playground in README with screenshots).

3. **One-week refactors (scope carefully):** #8 (`TaskTerminalService` wiring), #9 (synthesizer path + repository pattern), Theme D (data layer consolidation), Theme F (IPC topology).

4. **Don't ship without:** fix the local merge conflict dead-end (#12) — this one specific bug breaks the product's central promise the first time a merge doesn't fast-forward.

5. **Revisit after launch:** panel tab mounting (complex, touches everything), agent manager god-class extraction, IPC codegen.

---

## Notes on the Audit Itself

- **All 15 reports landed.** No reports failed or timed out. Report quality was high across all personas — the persona-charter framing worked.
- **Cross-team confidence was high.** The top 10 findings were independently flagged by 2+ teams. This is the cleanest signal of what's real.
- **Team Gamma's wildcard role paid off.** Gamma caught the cross-cutting naming war, the two-flow onboarding, the Synthesizer orphan, the panel-mounting bug, and the stale architecture doc — all things a focused team could have missed. Worth repeating the hybrid-team model on future audits.
- **One weakness:** Gamma PE noted the agents are reading `BDE_FEATURES.md` as auto-loaded context, which means everything in that file becomes part of the agent system — this audit was conducted _with that in mind_, and the results will differ if that context loading changes.
- **What's not in here:** security beyond Playground XSS, accessibility (ARIA compliance beyond landmark usage), performance profiling under real load, Windows/Linux portability, code signing. Consider dedicated audits for these before public release.

---

## Appendix: Self-Validated Findings from the Dogfood Loop

After the audit was written, Epic 1 was executed by running a preflight prompt fix through BDE's own Code Review Station (the "eat your own dogfood" test). That single Ship It attempt surfaced five additional findings that weren't in the original 20 — each one independently flagged by hitting the failure mode in real use. They're logged here because **finding bugs by using the product is the highest-signal audit technique there is.**

### [CRITICAL-new] Stale `review` tasks with no worktree_path have no recovery path

- **Category:** Error Recovery / Feature Gap
- **Symptom:** Clicking Create PR / Ship It on a `review`-status task whose worktree was cleaned up (e.g., by a completion-handler crash before the status transition fired) throws `Error: Task X has no worktree path`. A red toast with no recovery action. Five such tasks were stranded in the review queue before the dogfood test; their PRs had actually been opened and merged manually, but the task records were left stuck.
- **Recommendation:** Detect the `status='review' + worktree_path IS NULL` condition before enabling action buttons. Offer a "Reconcile from GitHub PR state" action that looks up the branch's PR via gh CLI, reads its state (merged / closed / open), and transitions the task accordingly. Or at minimum a "Mark as done/cancelled manually" escape hatch.
- **Scale:** 5 orphaned tasks found at dogfood time. This is not rare — any completion-handler crash can produce it.
- **Self-validation:** Gamma SD's "bde:refresh and bde:escape dispatched but no listeners" finding is a sibling — both are examples of dead-end error states with no user-visible recovery.

### [CRITICAL-new] `sprint_tasks.repo` field has case drift (`BDE` vs `bde`)

- **Category:** Data Integrity
- **Symptom:** Ship It failed with `Error: Repo "BDE" not found in settings`. Investigation: 100 historical tasks have `repo = 'BDE'` (uppercase), 354 have `repo = 'bde'` (lowercase). Settings stores `name: 'bde'` (lowercase). Code Review's `repo → localPath` lookup is case-sensitive. **22% of historical tasks are currently unshippable** due to this mismatch.
- **Location:** `src/main/handlers/review.ts:499` (`getRepoConfig(task.repo)`), `src/main/data/sprint-queries.ts` writes
- **Recommendation:** (a) New migration: `UPDATE sprint_tasks SET repo = LOWER(repo) WHERE repo != LOWER(repo)`. (b) Make `getRepoConfig()` case-insensitive as belt-and-suspenders. (c) Add a sanitizer at the write path so new inserts normalize casing.
- **Self-validation:** Found by hitting the wall on the preflight task's Ship It. Historical reconstruction showed this isn't a one-off — ~22% of tasks are affected.

### [MAJOR-new] `review:shipIt` does not fast-forward local main before merging

- **Category:** Race Condition / Fragility
- **Symptom:** Ship It fetches origin/main in the agent worktree to rebase the feature branch, but never updates local main in the main checkout. If any commit landed on origin/main since local main was last updated (e.g., other PRs merged during a BDE session), the subsequent `git merge --squash` merges into a stale tip, creating a divergent commit that `git push` rejects as non-fast-forward. The catch block warns quietly and still marks the task done, leaving the user with divergent history and a misleadingly green toast.
- **Location:** `src/main/handlers/review.ts:515-537` (Ship It rebase-before-merge block)
- **Recommendation:** Run `git fetch` in the main checkout (not the worktree), then `git merge --ff-only origin/main` before the feature branch rebase. Verify the main checkout is on `main` branch first; bail loudly if not. If the ff fails (local main has diverged non-fast-forward), return a specific error telling the user to `git pull --rebase` manually.
- **Status:** **Fixed.** See commit `fe3edc5b fix(review): Ship It must fast-forward local main before merging` and related tests.
- **Self-validation:** Found by running Ship It on the preflight task and then checking `git log origin/main`. The toast said "Merged & pushed!" — but origin didn't have the commit. The exact scenario the original audit's Gamma SD finding predicted ("Ship It success toast is misleading on push failure"), validated in real time.

### [MAJOR-new] Ship It's push-failure toast is styled as soft-success

- **Category:** Error Recovery / Copy
- **Symptom:** When Ship It's merge succeeds but push fails, the old code showed `toast.success('Merged locally (push failed — push manually)')` — a green toast with the default 3-second duration. In real use (this very dogfood loop), the user saw a green toast and assumed Ship It succeeded. Only discovered the push had failed by checking `git log origin/main` after the fact.
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:67-70`
- **Recommendation:** On push failure, use `toast.error()` with a longer duration (10s+), and make the message imperative ("Push to origin FAILED. Open Source Control to retry or run `git push` manually."). Even better: add a `toast.warning()` type to the toast store and use that.
- **Status:** **Fixed** in the same commit as the above. Toast is now `toast.error` with 10s duration.
- **Self-validation:** Same dogfood session. This is literally Gamma SD MAJOR #12 from the original audit, reproduced live.

### [MAJOR-new] BDE_FEATURES.md and this audit describe "9 views" but the docs say different counts

- **Category:** Documentation drift (minor — but catches the eye)
- **Symptom:** README says "8 Views" in the architecture section. `BDE_FEATURES.md` describes 9. View registry has 9. The count of "settings tabs" is similarly inconsistent across README (9), `BDE_FEATURES.md` (9), and the actual sidebar (10 visible + 1 orphan).
- **Recommendation:** Add a generated "counts table" at the top of `BDE_FEATURES.md` derived from `view-registry.ts`, `ipc-channels.ts`, handler directory, etc. Regenerate as part of pre-commit or CI.
- **Self-validation:** Surfaced in both Bravo Marketing and Gamma Marketing originally; confirmed during the README factual-fixes task spec authoring.

### Process note: the dogfood loop is the single best remediation test

Running Epic 1 through BDE's own Code Review Station surfaced **5 additional CRITICAL/MAJOR findings** in a single Ship It attempt — roughly 30% more signal than the entire 15-agent audit produced for the same surfaces. Recommendation for future audits: always include a dogfood-loop step where the remediation itself is executed through the product being audited. Bugs that only show up under real use will never appear in a read-only audit.
