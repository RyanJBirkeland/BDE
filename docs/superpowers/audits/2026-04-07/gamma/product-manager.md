# Product Manager — Team Gamma (Full Pass) — BDE Audit 2026-04-07

## Summary

BDE has a strong feature surface, but the product feels like four overlapping prototypes glued together rather than one cohesive app. The biggest cross-cutting issues are: (1) **the same concept goes by different names in different views** (Epics vs Task Groups vs Sprints; Task Pipeline vs Sprint Center vs Sprint Pipeline; Code Review vs PR Station); (2) **two separate planning surfaces** (Task Workbench, Task Planner) with unclear boundaries and overlapping responsibilities; (3) **at least three documented features have no UI affordance** (Synthesizer, WebhooksSection, AboutSection) — built but never wired in; (4) **two onboarding flows run back-to-back** with no shared state, and one of them still references the removed Supabase backend; (5) the Code Review and Source Control views both push to GitHub, with no shared mental model of where you "ought" to be when. New users will be lost. The good news: most of these are rewireable rather than rewritable.

## Findings

### [CRITICAL] Onboarding still requires/promotes Supabase, which has been removed

- **Category:** Cohesion / Feature Gap
- **Location:** `src/renderer/src/components/Onboarding.tsx:23,121,129,152-159,224-226`
- **Observation:** The legacy `Onboarding.tsx` (which still runs after `OnboardingWizard` completes — see below) shows a "Supabase connected" check and the help text reads _"Set supabase.url and supabase.serviceKey in Settings to enable Sprint tasks"_. Per `CLAUDE.md`, sprint tasks were migrated to local SQLite (migration v15). There is no `supabase.url` field in the new Settings sidebar (`SettingsView.tsx:35-46`).
- **Why it matters:** Brand-new users on first launch will be told to configure something that no longer exists. A failing check in onboarding screams "broken product".
- **Recommendation:** Delete `Onboarding.tsx` entirely (the wizard already covers auth / git / repos), or at minimum strip the Supabase check and help text.

### [CRITICAL] Two separate onboarding flows run sequentially with no coordination

- **Category:** Cohesion
- **Location:** `src/renderer/src/App.tsx:419-432`
- **Observation:** First-launch users hit `<OnboardingWizard>` (5-step neon wizard: Welcome / Auth / Git / Repos / Done). The moment they complete it and `onboarding.completed` is set, the app then renders the _legacy_ `<Onboarding>` blocking screen until `onReady` fires. Both check overlapping things (auth, git, repos). The user effectively does onboarding twice in two completely different visual styles.
- **Why it matters:** First impressions are everything. Two onboarding screens back-to-back is "this product is unfinished" in a way users will not forgive.
- **Recommendation:** Delete the legacy `Onboarding.tsx` path. Move any auth-status checks it does into the `AuthStep` of the wizard, and have the wizard's `DoneStep` call `onReady` directly.

### [CRITICAL] The "Synthesizer" agent is a documented feature with zero renderer UI

- **Category:** Feature Gap
- **Location:** `src/main/handlers/synthesizer-handlers.ts`, `src/preload/index.ts:494-522` (exposed as `synthesizeSpec`, `cancelSynthesis`, `onSynthesizerChunk`); zero renderer callers (verified via grep over `src/renderer`).
- **Observation:** `BDE_FEATURES.md` calls out the Synthesizer as one of five agent types — "Generates structured specs from codebase context + user answers… outputs markdown with `## heading` sections." Main process, IPC channels, preload bridge, and personality module all exist. The Task Workbench has only the `Copilot` (text-only) and never invokes `synthesizeSpec`.
- **Why it matters:** Users reading the docs (and the in-app Feature Guide) will look for the Synthesizer button and never find one. This is the single biggest "where is the thing the docs promised me" gap in the product.
- **Recommendation:** Add a "Generate from codebase" action to `WorkbenchForm` / `WorkbenchActions` that opens a Synthesizer flow. Until then the docs are lying.

### [CRITICAL] Task Workbench vs Task Planner have unclear, overlapping responsibilities

- **Category:** Cohesion / Workflow
- **Location:** `src/renderer/src/views/PlannerView.tsx`, `src/renderer/src/views/TaskWorkbenchView.tsx`, `src/renderer/src/components/planner/EpicDetail.tsx`
- **Observation:** Workbench is a **single-task** form + AI copilot + readiness checks. Planner is an **Epic** (TaskGroup) container that holds multiple tasks — but the only way to _create_ a task inside an Epic is to click "Add Task" in `PlannerView`, which jumps you over to the Workbench (`PlannerView.tsx:59-66`) with a `pendingGroupId` set. Editing a task ID jumps you over to the Workbench again. So Planner has no actual task editor — it's a list view that punts to Workbench. Meanwhile, Workbench has no concept of which Epic it belongs to in its main UI; the relationship is hidden in `pendingGroupId`. The two views feel like one feature split in half.
- **Why it matters:** Users can't form a mental model of "where do I go to do X." There's also no breadcrumb, so jumping Planner → Workbench → back loses context.
- **Recommendation:** Either (a) merge Planner into Workbench as a left-pane "Epics" picker, or (b) give Planner an inline mini-editor for adding tasks without leaving the view. Add a visible Epic chip in Workbench when `pendingGroupId` is set so users know what they're attached to.

### [CRITICAL] "Epic" / "Task Group" / "Group" / "Sprint" — four names, one concept

- **Category:** Inconsistency
- **Location:** `src/shared/types.ts:47` (`TaskGroup`), `src/renderer/src/views/PlannerView.tsx:149` ("Task Planner" / "epics"), `src/renderer/src/components/planner/EpicList.tsx`, `EpicDetail.tsx`, `CreateEpicModal.tsx` (UI says "Epic"), `src/renderer/src/stores/taskGroups.ts` (store says "groups"), `SprintTask.sprint_id` and `SprintTask.group_id` both exist on the type (`types.ts:116-117`).
- **Observation:** The data model calls it a `TaskGroup`. The UI calls it an `Epic`. The store calls it a `group`. The view is called `Task Planner`. And `SprintTask` has BOTH `group_id` and `sprint_id` columns — implying maybe Sprints were once a different thing and the rename was incomplete.
- **Why it matters:** Devs and users alike will struggle to correlate code, docs, and UI labels. Two columns (`group_id`, `sprint_id`) for one concept is a latent bug factory.
- **Recommendation:** Pick one term ("Epic" reads best in product). Rename the type to `Epic`, the store to `useEpics`, and drop the unused column from the SprintTask type.

### [MAJOR] About Settings page is built but unreachable from the sidebar

- **Category:** Feature Gap
- **Location:** `src/renderer/src/views/SettingsView.tsx:29,59` (imported, in SECTION_MAP) vs `SECTIONS` array `:35-46` (not listed)
- **Observation:** `AboutSection` is imported and registered in `SECTION_MAP` and `SECTION_META`, but not added to the `SECTIONS` sidebar list. There is no clickable nav entry for "About". CLAUDE.md still claims Settings has an About tab.
- **Why it matters:** Users have no way to see version info / log file locations / GitHub link without opening DevTools. Listed in docs as an existing feature.
- **Recommendation:** Add `{ id: 'about', label: 'About', icon: Info, category: 'App' }` to the `SECTIONS` array.

### [MAJOR] WebhooksSection is built (293 lines) and entirely orphaned

- **Category:** Feature Gap
- **Location:** `src/renderer/src/components/settings/WebhooksSection.tsx` (293 lines), zero imports in `SettingsView.tsx`
- **Observation:** A complete Webhooks settings panel exists but is never imported, never rendered, never reachable.
- **Why it matters:** Either the feature is real and needs wiring up (a launch-blocking gap if so), or it should be deleted to stop confusing future maintainers. Either way it's currently the worst kind of dead code: production-shaped, fully-styled, completely invisible.
- **Recommendation:** Decide. If it's real: register it in `SECTIONS` with a "Pipeline" or "Integrations" category. If not: delete it.

### [MAJOR] Dashboard has two stat counters that route to the same filter

- **Category:** Cohesion / Polish
- **Location:** `src/renderer/src/components/dashboard/StatusCounters.tsx:67-80`
- **Observation:** "Review" counter (`stats.review`) and "PRs" counter (`awaitingReviewCount`) both call `onFilterClick('awaiting-review')`. Two visually-distinct cards land on the same filtered view of the same partition.
- **Why it matters:** Two-different-numbers-mean-different-things-but-same-click is confusing. Either the partition is wrong or the cards should route differently. As-is users will click "PRs" expecting a PR-filtered view and get the same thing as "Review".
- **Recommendation:** Either route "PRs" to a true `pr_status='open'` filter, or collapse the two counters into one ("Awaiting review · 5").

### [MAJOR] Code Review and Source Control both push to GitHub with no shared model

- **Category:** Cohesion / Workflow
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:53-134` (`shipIt`, `mergeLocally`, `createPr`, `rebase`), `src/renderer/src/views/GitTreeView.tsx` (commit + push for any repo)
- **Observation:** Code Review can merge, push, and create PRs for a task's worktree branch. Source Control can stage / commit / push for any active repo. There is no indication in either view of what the _other_ one is doing or whether the branch you're staring at in Source Control is the same one being reviewed in Code Review. A user can `git push` from Source Control on the same branch the agent worktree is on, then "Ship It" from Code Review and have ambiguous state.
- **Why it matters:** Two doors to the same shed. Power users will be fine; new users will not understand "do I review or do I commit?" The two views do not link to each other at all.
- **Recommendation:** When viewing a task in Code Review, link to "Open in Source Control" (and pre-select that repo + branch). In Source Control, when the active branch is an agent branch in `review` status, show a banner "This branch is in Code Review" with a deeplink.

### [MAJOR] View shortcuts skip a number — Cmd+8 and Cmd+0 in odd places

- **Category:** Polish / Inconsistency
- **Location:** `src/renderer/src/lib/view-registry.ts:81-90`
- **Observation:** Shortcuts run 1-7 (Dashboard → Settings) then jump to **8** (Planner) and **0** (Workbench). Cmd+9 is unused. The two most-used "creation" surfaces have the most awkward shortcuts. CLAUDE.md describes Workbench as Cmd+0 but ARIA users and feature guides won't intuit why 9 is missing.
- **Why it matters:** Muscle memory. Workbench is the canonical place to create work — it should have a top-of-mind shortcut, not Cmd+0.
- **Recommendation:** Remap to Cmd+8 = Workbench, Cmd+9 = Planner, drop the Cmd+0 oddity. Or move Workbench up to Cmd+2 and push Agents down. The current mapping looks like it grew accidentally.

### [MAJOR] Naming inconsistency: "Sprint Center" vs "Task Pipeline" vs "Sprint Pipeline"

- **Category:** Inconsistency
- **Location:** `src/renderer/src/views/DashboardView.tsx:121` (comment "Sprint Center"), `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts:2` ("Sprint Center"), `src/renderer/src/lib/view-registry.ts:50` ("Task Pipeline"), `src/renderer/src/components/sprint/SprintPipeline.tsx` (component "SprintPipeline"), `src/renderer/src/assets/sprint-pipeline-neon.css`
- **Observation:** The view is labeled "Task Pipeline" in the sidebar, but internally called Sprint, the file is `SprintView.tsx`, the CSS is `sprint-pipeline-neon.css`, and code comments still say "Sprint Center". Three names competing.
- **Why it matters:** Cosmetic but symptomatic. Anyone searching the codebase has to know all three names. Documentation drift will only get worse.
- **Recommendation:** Pick "Task Pipeline" (it reads best to users) and rename files/stores accordingly. At minimum update the comments.

### [MAJOR] Agents view introduces "Promote to Code Review" but Code Review docs don't mention adhoc promotion

- **Category:** Cohesion
- **Location:** `src/renderer/src/views/AgentsView.tsx:332-346`, `BDE_FEATURES.md` Code Review Station section
- **Observation:** AgentsView shows a Scratchpad notice that explains: _"When an agent finishes, click Promote to Code Review in its console header to flow the work into the review queue."_ That's a great affordance — but the Code Review feature docs and the ReviewQueue UI never mention that adhoc-promoted tasks live there. Users in Code Review will see a task with no obvious origin.
- **Why it matters:** Two-way feature documentation gap. Users won't connect "I clicked Promote" with "this thing in the Review queue".
- **Recommendation:** In Code Review's task detail, surface "Origin: Adhoc agent (promoted)" vs "Origin: Pipeline task" so users can tell. Update `BDE_FEATURES.md` Code Review section to mention promotion as an entry path.

### [MAJOR] Dead "Sprint Center" terminology lingers in shortcuts hook + dashboard comments

- **Category:** Inconsistency
- **Location:** `src/renderer/src/hooks/useSprintKeyboardShortcuts.ts:2`, `DashboardView.tsx:121`
- **Observation:** Same as the naming finding above but worth flagging as its own polish item — these are user-facing through tooltips, not just docs.

### [MINOR] Planner queue confirmation says "draft tasks" but the status is "backlog"

- **Category:** Inconsistency
- **Location:** `src/renderer/src/views/PlannerView.tsx:98-110`
- **Observation:** The confirm modal says _"Queue N tasks to the pipeline? This will transition all draft tasks with specs to queued status."_ The actual filter is `t.status === 'backlog'`. There is no `draft` task status (`SprintTask.status` enum: backlog/queued/blocked/active/review/done/cancelled/failed/error).
- **Why it matters:** Users will scan the confirm dialog and be confused about what gets queued. "Draft" implies something not in backlog yet.
- **Recommendation:** Change copy to "...transition all backlog tasks with specs to queued status."

### [MINOR] Planner view title says "Task Planner" but the body talks exclusively about Epics

- **Category:** Inconsistency / Polish
- **Location:** `src/renderer/src/views/PlannerView.tsx:149,154,167` ("Search epics...", "Import doc")
- **Observation:** Title is "Task Planner", search placeholder is "Search epics...", Empty state is "Select an epic to view details", `EmptyState message="Select an epic..."`. Users see "Planner" in nav and "Epics" everywhere inside.
- **Why it matters:** Adds to the Epic/Group/Planner naming soup.
- **Recommendation:** Rename the view to "Epics" in `view-registry.ts` (and CLAUDE.md docs). Or call epics "plans". Pick one.

### [MINOR] IDE has its own ⌘/ shortcut for help, conflicting with global ?-key shortcut overlay

- **Category:** Polish / Inconsistency
- **Location:** `src/renderer/src/views/IDEView.tsx:36` ("⌘/" shows IDE help) vs `src/renderer/src/App.tsx:397` (`?` toggles `setShortcutsOpen`)
- **Observation:** Pressing `?` anywhere opens the global shortcuts overlay. In IDE, ⌘/ opens an _IDE-specific_ shortcuts overlay. Two different patterns for "show me shortcuts".
- **Why it matters:** Power-user friction. Users will form a habit and the IDE breaks it.
- **Recommendation:** Have IDE register its shortcuts into the global `SHORTCUT_CATEGORIES` (`shortcuts-data.ts`) as a category, and remove its own modal.

### [MINOR] "Spec" vs "Prompt" vs "Notes" — three text fields on a task with hazy boundaries

- **Category:** Cohesion / Workflow
- **Location:** `src/shared/types.ts:88-90` (`notes`, `spec`, plus `prompt` on line 76)
- **Observation:** A task carries `prompt`, `spec`, AND `notes`. Workbench has spec_type "spec" or "prompt". The product never explains which one the agent uses, what `notes` are for, or how they relate.
- **Why it matters:** Users will dump information into any of the three and be surprised when the agent ignores it.
- **Recommendation:** In Workbench, label fields with their role: "Agent prompt (passed verbatim)", "Spec (markdown briefing the agent reads)", "Notes (for humans only — not sent to agent)". Or collapse to two fields.

### [MINOR] Feature Guide modal exists, but there is no obvious entry point to it from the shell chrome

- **Category:** Polish / Discoverability
- **Location:** `src/renderer/src/App.tsx:243-249,475` (opened via `bde:open-feature-guide` custom event), `src/renderer/src/components/help/FeatureGuideModal.tsx`
- **Observation:** The Feature Guide is wired up to a custom event but I see no clearly-labeled "Help" button in `NeonSidebar` or `UnifiedHeader` to fire that event. New users don't know it exists.
- **Why it matters:** Built-in help that users can't find is no help at all.
- **Recommendation:** Add a "?" / "Help" button in the sidebar footer or header that dispatches `bde:open-feature-guide`.

### [MINOR] Pipeline "Backlog" panel and Planner "Epics with backlog tasks" overlap with no cross-link

- **Category:** Workflow
- **Location:** `src/renderer/src/components/sprint/PipelineBacklog.tsx`, `PlannerView.tsx`
- **Observation:** The Sprint Pipeline shows a "Backlog" sidebar of tasks that aren't queued yet. Planner shows the same backlog tasks grouped by Epic. Two views of the same data, no link between them.
- **Why it matters:** Users will wonder why a task they see in Pipeline backlog isn't in Planner (or vice versa). It's the same set, just sliced differently.
- **Recommendation:** From Pipeline backlog, allow "Group into Epic". From Planner, allow "Show in Pipeline backlog". Even a small affordance ties the two surfaces together mentally.
