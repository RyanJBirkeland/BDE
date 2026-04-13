# Product Manager — Team Alpha — BDE Audit 2026-04-07

## Summary

The core create→queue→execute→review→done loop is feature-rich but fragmented. There are three overlapping surfaces for "task creation/planning" (Workbench, Planner, Pipeline) with unclear handoffs and no breadcrumbs. The Code Review Station has six action buttons but no story for the most common failure mode (local merge conflicts), and the related TaskDetailDrawer renders ZERO action buttons when a task is in `review` state — the literal centerpiece of the new workflow. Polish gaps abound in the workbench (silent draft loss, hidden epic context, awkward keyboard shortcuts on ⌘0) and stale labels still reference the old PR-only review model in the new local-merge world. None of this would prevent a demo, but a real user would absolutely trip on at least four of these in their first session.

## Findings

### [CRITICAL] TaskDetailDrawer has no actions for `review` status tasks

- **Category:** Feature Gap
- **Location:** `src/renderer/src/components/sprint/TaskDetailActionButtons.tsx:48` (switch statement)
- **Observation:** The action-button switch handles `backlog | queued | blocked | active | done | failed | error | cancelled` but has no `case 'review'`. Tasks in review state fall through `default` and render an empty fragment. The drawer body shows a "Review Changes →" link (TaskDetailDrawer.tsx:288) but the entire actions footer is empty. Meanwhile, "review" is now a first-class stage in the pipeline (PipelineStage between active and done) and tasks live there for hours.
- **Why it matters:** The Pipeline view is the place users see "what's happening with my work right now." Clicking a review-state task and seeing zero buttons in the actions bar makes the drawer feel broken. Users have to know to scroll up and find the in-body CTA, then context-switch to a totally different view. The pipeline drawer should at minimum offer Quick-merge / Open in Code Review / Discard.
- **Recommendation:** Add a `case 'review'` returning Ship It (if gh configured), Open in Code Review, Edit, and Discard. Mirror the most common ReviewActions buttons so users can act without switching views.

### [CRITICAL] Local merge/rebase conflicts are a dead-end

- **Category:** Workflow
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:101-108, 191-198`
- **Observation:** When `mergeLocally` or `rebase` returns `success: false` with conflicts, the only feedback is a toast: "Merge failed: conflicts detected" or "Rebase failed: conflicts detected". The freshness badge flips to "Conflict" but there's no UI to view, resolve, or even identify which files conflict. The existing `ConflictDrawer.tsx` only handles GitHub PR-level mergeable_state conflicts (not local conflicts). The user is told there's a problem but offered no way out except "go to terminal and figure it out yourself."
- **Why it matters:** This is the single most common failure mode of any merge workflow. The whole pitch of the Code Review Station is "review and integrate without leaving BDE" — but the very first time something doesn't fast-forward, the user is dumped to the terminal. That breaks the product's central promise.
- **Recommendation:** On conflict, expand a panel showing conflicted files, offer a "Resolve in IDE" button that opens the IDE view scoped to the worktree, and/or surface the agent: "Ask agent to rebase/resolve conflicts." At minimum, show the file list — currently the user doesn't even know which files are involved.

### [CRITICAL] Three overlapping creation/planning surfaces with no clear handoff

- **Category:** Cohesion
- **Location:** `src/renderer/src/views/PlannerView.tsx`, `src/renderer/src/components/task-workbench/TaskWorkbench.tsx`, `src/renderer/src/components/sprint/SprintPipeline.tsx`
- **Observation:** BDE has three views that all touch task creation/planning: Task Planner (epics + multi-task workflows), Task Workbench (single-task spec drafting), and Sprint Pipeline (monitoring, but with create CTAs). The product story per BDE_FEATURES.md says they're distinct, but in practice:
  - Planner's "Add Task" punts to the Workbench by setting `pendingGroupId` (PlannerView.tsx:60-66)
  - Workbench has no UI showing "you are adding a task to epic X" — `pendingGroupId` is set silently in the store and never displayed in the form heading (WorkbenchForm.tsx:64,115)
  - When the user is editing a task that belongs to an epic, `loadTask` (taskWorkbench.ts:305) doesn't preserve `pendingGroupId` either, so saving may orphan the task
  - The Pipeline empty-state CTA "New Task" (SprintPipeline.tsx:538) jumps straight to Workbench, bypassing Planner entirely
- **Why it matters:** A new user opens BDE, sees Pipeline (⌘4), Code Review (⌘5), Task Planner (⌘8), Task Workbench (⌘0) and has no idea which one to start in. Once they pick Planner and click "Add Task," they're teleported to Workbench with no context that they're inside an epic. That is the kind of inconsistency that makes a product feel half-built.
- **Recommendation:** (1) Show an "In epic: <name>" banner at the top of WorkbenchForm when `pendingGroupId` is set, with a "Remove from epic" button. (2) Persist the epic association through `loadTask`. (3) Decide whether Planner and Workbench should be one view with two modes (epic context vs. no context) or genuinely separate; if separate, give Planner first-class onboarding so users land there for new work.

### [MAJOR] Workbench is at ⌘0 — the wrong shortcut for the primary creation surface

- **Category:** UX
- **Location:** `src/renderer/src/lib/view-registry.ts:77-90`
- **Observation:** Shortcuts: Dashboard ⌘1, Agents ⌘2, IDE ⌘3, Pipeline ⌘4, Code Review ⌘5, Git ⌘6, Settings ⌘7, Planner ⌘8, **Workbench ⌘0**. There's no ⌘9. Workbench — the canonical place to create new tasks — sits at ⌘0, awkwardly far from the other workflow keys. Settings (rarely used) gets ⌘7 but the most common day-one action gets the leftover slot.
- **Why it matters:** Keyboard shortcuts encode a hierarchy of importance. ⌘0 for "create new task" tells users this is an afterthought.
- **Recommendation:** Rebind: Workbench ⌘N or Workbench ⌘5 (push everything else down). At the very least, fill ⌘9 with something so the gap doesn't feel accidental.

### [MAJOR] Pipeline "Review" stage subtitle still says "PRs awaiting merge"

- **Category:** Polish
- **Location:** `src/renderer/src/components/sprint/PipelineStage.tsx:83`
- **Observation:** The Review stage shows the subtitle "PRs awaiting merge" — but per BDE_FEATURES.md, agents now stop at `review` status with the worktree preserved for _local_ inspection. PRs are an opt-in action from the Code Review Station, not the default. The subtitle is leftover from the old PR-driven model.
- **Why it matters:** The whole new product story is "human reviews work before it becomes a PR." The label undermines that story right where users look first.
- **Recommendation:** Change to "Awaiting human review" or "Worktrees awaiting integration."

### [MAJOR] Workbench Cmd+Enter handler bypasses operational checks

- **Category:** Workflow
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:347-369` and `describeQueueBlocker:35-45`
- **Observation:** `describeQueueBlocker` only inspects structural and operational checks already in state. But operational checks (auth, repo path, git clean, slots, conflicts) only run when the user clicks the Queue button (handleSubmit, line 222). So Cmd+Enter is checked against potentially stale or never-populated operational state. It will pass `null` reason → call `handleSubmit('queue')` → which then runs operational checks → which may fail → which silently aborts. Result: keyboard shortcut behaves differently from the button under the same conditions.
- **Why it matters:** Keyboard power-users will hit Cmd+Enter, see nothing happen, and not know why. This kind of silent inconsistency is the exact thing the new "explain why it's blocked" toast was added to fix — but it has a hole.
- **Recommendation:** Either pre-run operational checks in describeQueueBlocker, or surface a "Running pre-flight checks…" toast on Cmd+Enter so the user knows the shortcut isn't a no-op.

### [MAJOR] No way to discover what `revision_feedback` from previous attempts looks like before re-queuing

- **Category:** UX
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:136-180`
- **Observation:** When the user clicks Revise, they're shown a single textarea prompt: "What should the agent fix or improve?" If this is the 3rd attempt, the past 2 feedback messages exist (in `task.revision_feedback`) but the prompt modal doesn't show them. The user has to remember what they said before, or cancel + open Conversation tab + find the revision history block.
- **Why it matters:** Users iterating on a hard task will write contradictory or duplicative feedback. Surfacing prior feedback inline turns this into a productive iteration loop.
- **Recommendation:** When `task.revision_feedback` has entries, show them in a collapsed "Previous feedback (N)" panel inside the TextareaPromptModal so the user has context.

### [MAJOR] Spec-quality dots on the SpecEditor only check 2 things; the workbench validation pipeline checks 7+

- **Category:** Cohesion
- **Location:** `src/renderer/src/components/task-workbench/SpecEditor.tsx:131-192` vs `src/renderer/src/components/task-workbench/ReadinessChecks.tsx:54`
- **Observation:** The SpecEditor toolbar has tiny dot-indicators for `files` and `tests`, with no way to see other quality signals at a glance. Meanwhile, ReadinessChecks (a separate component below the editor) tracks `structural`, `semantic`, and `operational` checks (clarity, scope, files-exist, etc.) — a much richer view. The two systems duplicate the "files mentioned?" check with subtly different logic (`spec-quality.ts` vs the IPC `workbench:checkSpec`).
- **Why it matters:** Two indicators of the same thing that may disagree erode trust. New users see "files: green dot" in the toolbar but "Files: warn — no paths detected" in ReadinessChecks below.
- **Recommendation:** Pick one signal source. Either remove the dot indicators (let ReadinessChecks be the authority) or move the dots into the ReadinessChecks summary as a glanceable shortcut.

### [MAJOR] CommitsTab and ChangesTab show no agent context at all

- **Category:** Feature Gap
- **Location:** `src/renderer/src/components/code-review/CommitsTab.tsx`, `src/renderer/src/components/code-review/ChangesTab.tsx`
- **Observation:** Reviewing an agent commit, the user sees commit message + author + date. Author will always be the user themselves (because agents commit as the user). There's no signal of which agent run produced which commit, no link back to the conversation, no token cost. ChangesTab shows the diff but doesn't show "the agent said it was doing X here."
- **Why it matters:** The whole reason to have a Code Review Station instead of GitHub PR review is to surface the agent's reasoning alongside the diff. Currently it's just a diff viewer with worse syntax highlighting than GitHub.
- **Recommendation:** Add a "what the agent said about this file" sidebar in ChangesTab, populated from `agent:text` events around the file's tool_calls. Show task cost and runtime in CommitsTab header.

### [MAJOR] Failed pipeline retries have no visibility into prior failure reasons

- **Category:** UX
- **Location:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:117-138` (failed-card)
- **Observation:** Failed cards in the sidebar show `task.notes` truncated as a meta line. There's a "Re-run" button. But the user can't see _what attempt this is_ or _what previous attempts said_ — those are presumably in `task_changes` audit history but no UI surfaces them. Clicking a failed card opens TaskDetailDrawer which has a "Failure Details" block (TaskDetailDrawer.tsx:298-391) — but it only shows the LAST failure, not the history.
- **Why it matters:** "Why does this task keep failing?" is the #1 question after a Re-run. The product currently makes the user investigate via logs.
- **Recommendation:** Include attempt count badge (`#3`) on failed cards. In TaskDetailDrawer's failure block, show all retry attempts as collapsible entries with their respective failure reasons.

### [MAJOR] BulkActionBar (sprint) and BatchActions (code review) are similar but inconsistent

- **Category:** Cohesion
- **Location:** `src/renderer/src/components/sprint/BulkActionBar.tsx`, `src/renderer/src/components/code-review/BatchActions.tsx`
- **Observation:** Both views support multi-select, but BatchActions only offers "Merge All" (squash hardcoded — no strategy picker, unlike single-task ReviewActions which has squash/merge/rebase). BulkActionBar has different actions entirely. Two separate stores (`sprintUI.selectedTaskIds`, `codeReview.selectedBatchIds`) with no awareness of each other.
- **Why it matters:** Selecting tasks in Pipeline doesn't carry over to Code Review or vice versa. The user has to re-select. And the merge strategy choice they made in single-task review isn't honored in batch mode.
- **Recommendation:** Unify selection state across views, or at minimum honor the merge strategy from ReviewActions in BatchActions. Add Discard All / Request Revision All to BatchActions.

### [MAJOR] Soft vs hard dependency UI is inscrutable on first encounter

- **Category:** UX
- **Location:** `src/renderer/src/components/task-workbench/DependencyPicker.tsx:115-142`
- **Observation:** Dependencies show as a row with: title, a `hard`/`soft` toggle button, a Default/On Success/On Failure/Always dropdown, and an X. The toggle button is labeled just "hard" or "soft" with a tooltip; the condition dropdown defaults to "Default (type-based)" which is a contradictory phrasing — the type IS the default? Then what does "On Success" override? A first-time user has no idea. There's no inline help, no link to docs. The combinations of (hard|soft) × (default|on_success|on_failure|always) produce 8 permutations with non-obvious behavior.
- **Why it matters:** Dependencies are a marquee feature ("BDE understands task graphs!"), but the UI is impenetrable. Users will avoid the feature.
- **Recommendation:** Replace the toggle+dropdown with a single dropdown of meaningful presets: "Wait for success (default)," "Wait for completion (any outcome)," "Wait — but skip if it fails." Plain English. Drop the hard/soft jargon from the UI; keep it as the data model.

### [MINOR] Workbench autosave drafts but reset on success — without explaining the drop

- **Category:** Polish
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:296` (resetForm after success), `src/renderer/src/stores/taskWorkbench.ts:296-303`
- **Observation:** The store autosaves drafts to localStorage. After successful create, `resetForm()` clears both the form and the saved draft. If the user creates a task and immediately wants to make a near-duplicate (very common workflow: "create issue 1, then issue 2 for the same area"), they have to retype everything.
- **Why it matters:** Power users batch tasks. Losing their context after every Create is friction.
- **Recommendation:** After successful Create, offer a toast action: "Created. [Duplicate]" that loads the just-saved values back into the form. Or keep title/repo/spec fields populated and only clear deps + flags.

### [MINOR] Pipeline shows a single "active/5" hardcoded WIP limit

- **Category:** Polish
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:583`
- **Observation:** The Active stage label says `${count}/5`. The "5" is hardcoded. The actual `MAX_ACTIVE_TASKS` is configurable in Settings → Agent Manager. If a user changes it to 3, the UI still says "/5".
- **Why it matters:** Stale UI numbers = "the product is lying to me."
- **Recommendation:** Read MAX_ACTIVE_TASKS from settings store and render it dynamically.

### [MINOR] DependencyPicker max-results=10 with no "show more"

- **Category:** UX
- **Location:** `src/renderer/src/components/task-workbench/DependencyPicker.tsx:11,29`
- **Observation:** The picker hard-caps results at 10. No paginate, no "show more", no count of how many are hidden. If the user has 50 tasks and searches "fix," they see 10 — possibly not the one they want, with no indication others exist.
- **Recommendation:** Show "X of Y matching" in the empty/footer area, or remove the cap when there's an active search query.

### [MINOR] CodeReviewView j/k navigation collides with text inputs in unfocused state

- **Category:** UX
- **Location:** `src/renderer/src/components/code-review/ReviewQueue.tsx:25-48`
- **Observation:** ReviewQueue listens for `j`/`k` keydown anywhere in the document, with a guard for INPUT/TEXTAREA/SELECT tags. ChangesTab/CommitsTab/etc. render content outside of inputs — typing "j" while reading the diff cycles to the next task unexpectedly. This is vim-y but inconsistent with the rest of BDE which uses cmd-keys.
- **Recommendation:** Either scope j/k to when ReviewQueue has focus, or document the shortcut prominently.

### [MINOR] "Ship It" button hidden behind GH config requirement, no friendly explanation

- **Category:** UX
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:262-263`
- **Observation:** The "Ship It" button (the marquee CTA in code review) is disabled when `!ghConfigured` with a `title` tooltip. Title attributes only show on hover and never on touch/keyboard. Users will see a grayed-out Ship It button and not know why.
- **Recommendation:** Replace the disabled state with an active button that opens a modal: "Configure GitHub to enable Ship It →" with a direct link to Settings → Connections.

### [MINOR] Workbench "Generate Spec" + "Research Codebase" are two buttons that do similar things via different paths

- **Category:** Cohesion
- **Location:** `src/renderer/src/components/task-workbench/SpecEditor.tsx:91-115`, `WorkbenchForm.tsx:319-345`
- **Observation:** "Generate Spec" calls `workbench.generateSpec` (Synthesizer agent — single-turn, structured output). "Research Codebase" calls `onSendCopilotMessage("Research the X codebase for: Y")` which routes through the chat copilot. Two paths to AI assistance with no labeled difference. A user picks one and gets one shape of result; tries the other and gets a different shape. Why two?
- **Recommendation:** Either merge them into a single "AI Help" dropdown ("Generate full spec," "Research the area first," "Suggest test cases") or label them with what they actually do differently.

### [MINOR] The "Export" button in PipelineHeader has no preview/scope of what gets exported

- **Category:** Polish
- **Location:** `src/renderer/src/components/sprint/PipelineHeader.tsx:100-142`
- **Observation:** Click Export → JSON or CSV → save dialog. No indication of whether this exports filtered tasks or all tasks, including failed/done? Just done? Number of records?
- **Recommendation:** Show "Export (N tasks)" with the current filter applied. Add a checkbox in the menu: "Include done/failed."

### [MINOR] No way to tell which model an in-flight task is using

- **Category:** UX
- **Location:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx` (no model display)
- **Observation:** The Workbench advanced section lets you pick Opus/Sonnet/Haiku per task. After queueing, the TaskDetailDrawer doesn't display the chosen model anywhere. So when a user wonders "is this slow because I picked Haiku for a hard task?" — no answer in the UI without re-opening the workbench in edit mode.
- **Recommendation:** Show `task.model` (or "Default") next to the priority in the drawer fields.
