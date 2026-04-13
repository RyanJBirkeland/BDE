# Senior Dev (User) — Team Alpha — BDE Audit 2026-04-07

## Summary

I'd actually use BDE day-to-day — the workbench-to-pipeline-to-review loop is genuinely well thought out, drafts autosave, Cmd+Enter has a "why is this blocked" toast, and the Code Review station's Ship It button is the kind of one-click flow I want. But there are a handful of papercuts that I'd hit on day one and never stop noticing: Cmd+Enter is a global window listener that fires from anywhere (including other panels), the Code Review actions don't have keyboard equivalents (only `j`/`k` for navigation), error messages from `mergeLocally` say "conflicts detected" without telling me which files conflict, the "Revise" flow re-queues but doesn't take me to the agent so I have no idea when it'll be done, and the workbench Copilot persists 100 messages forever with no per-task scoping — I'll be reading a stale conversation about a different task next week. None of this is dealbreaking; all of it is fixable in a sprint.

## Findings

### [CRITICAL] Cmd+Enter to queue is a global window listener that fires from anywhere

- **Category:** Workflow Friction / Edge Case
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchForm.tsx:348-369`
- **Observation:** The Cmd+Enter handler is `window.addEventListener('keydown', ...)` with no scope check. If the workbench is in a panel and I'm typing in the IDE editor, the Code Review conversation tab, or the agents view in another panel, Cmd+Enter still queues whatever is in the workbench form. With BDE's tear-off windows and split panes, the workbench is rarely the only thing on screen.
- **Why it matters:** Accidental queue is the worst kind of bug — I'll launch a half-finished task with stale repo/spec context and burn agent runtime + watchdog slots before noticing. Then I have to find it in the pipeline and stop it.
- **Recommendation:** Scope the listener to the workbench root (`containerRef`) or check `document.activeElement` is inside the form. Better yet, attach via `onKeyDown` on the form `<div>` so it only fires when focus is inside.

### [CRITICAL] mergeLocally / Ship It error messages don't tell me what to do

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:101-103, 73-74`
- **Observation:** On merge failure I get `Merge failed: conflicts detected` or `Ship It failed: <error>`. No file list, no offer to open the worktree, no "Rebase first" suggestion, no "Switch to manual mode" — just a toast that disappears in 5 seconds. The Rebase button next door has the same problem (`Rebase failed: conflicts detected`).
- **Why it matters:** This is the exact moment where I most need clarity. If my agent did good work but it conflicts with main, I want to immediately see _which files_ conflict so I can decide: rebase, manual fix in IDE, or revise. Right now I have to leave the app, `cd` to the worktree, and `git status` myself. That's the "I have to leave the app to do X" moment I most want to avoid.
- **Recommendation:** Have the IPC handler return `{ success: false, conflictFiles: string[], error }`. Render conflicts inline in `cr-actions` with a "Open in IDE" button per file and a "Try rebasing first" CTA when freshness is `stale`.

### [MAJOR] Copilot messages persist globally across all task drafts forever

- **Category:** State Loss / Workflow Friction
- **Location:** `src/renderer/src/stores/taskWorkbench.ts:176-190` (`COPILOT_STORAGE_KEY`, capped at 100)
- **Observation:** The workbench Copilot conversation lives in one global localStorage key, capped at 100 messages. There's no per-task scoping, no "new chat", no clear button visible from the form. When I draft a task today about "fix recipe search" and tomorrow draft a task about "add login UI", the Copilot panel still shows yesterday's messages and the assistant has stale context the moment I send a new message.
- **Why it matters:** Copilot is sold as a per-task assistant but behaves as a global one. I'll either get confused conversations or learn to manually clear it every time — both are failure modes.
- **Recommendation:** Reset Copilot messages on `resetForm()` (or on `loadTask()` for edit mode), and add a "New chat" button in the Copilot header. Optionally tie persistence to `taskId` for edit mode so re-opening a task restores its conversation.

### [MAJOR] Request Revision re-queues but doesn't navigate me anywhere

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:136-180`
- **Observation:** After typing my revision feedback I get a toast `Task re-queued with revision feedback`, the selection clears, and I'm left staring at an empty review pane. There's no link to "watch the agent work" or "view in pipeline". I have to manually Cmd+4 → find the task → click it → switch to agents view to see anything happening.
- **Why it matters:** Revision is a high-touch flow — I'm asking the agent to fix something specific and I want to know it actually picked up my feedback. Right now there's zero feedback loop after the toast.
- **Recommendation:** After revise success, either auto-select the next review task (if any) or surface a toast action button: "View in pipeline →" / "Watch agent →". Bonus: keep the review tab on this task and show a "Re-queued at HH:MM, waiting for agent..." state instead of blanking the panel.

### [MAJOR] Code Review actions have no keyboard shortcuts

- **Category:** Keyboard
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx`, `ReviewQueue.tsx:25-48`
- **Observation:** `j`/`k` navigates the queue (good!) but there's no key for the actions I'd hit 50x/day: Ship It, Merge Locally, Revise, Discard, Rebase. Every single one needs a mouse trip across the screen. The command palette has no review-action commands either (only navigation).
- **Why it matters:** The whole point of Code Review Station is to triage agent output fast. Mouse-only is going to feel terrible the moment I have 5+ tasks awaiting review.
- **Recommendation:** Add `s` Ship It, `m` Merge, `r` Revise, `d` Discard, `b` Rebase. Show them inline as hint badges on the buttons (like `[s]`). Register them in the command palette too.

### [MAJOR] Drawer Edit button blows away workbench draft without warning

- **Category:** State Loss
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:629-632`, `src/renderer/src/stores/taskWorkbench.ts` (loadTask)
- **Observation:** Clicking "Edit" in the TaskDetailDrawer calls `useTaskWorkbenchStore.getState().loadTask(selectedTask)` and switches to the workbench. If I had an in-progress new-task draft in the workbench, it's just overwritten. There's no "you have unsaved changes" guard.
- **Why it matters:** Autosave saves the create-mode draft, but `loadTask` enters edit mode and the next save targets a different row. The user can lose work that they thought was safely persisted because they hit Edit on something else "real quick."
- **Recommendation:** Before `loadTask`, check if the create-mode draft has content (already detectable via `draftHasContent`) and confirm: "You have an unsaved new task draft. Discard it and edit X?"

### [MAJOR] Workbench layout collapses copilot at <600px without remembering my preference

- **Category:** State Loss
- **Location:** `src/renderer/src/components/task-workbench/TaskWorkbench.tsx:13-27`
- **Observation:** A `ResizeObserver` automatically toggles the copilot off whenever the panel width drops below 600px. If I drag the panel narrow to focus on the spec, then drag it back, the copilot stays closed and I don't realize why. Also, `toggleCopilot()` mutates global state — collapsing in one tear-off window affects every workbench instance.
- **Why it matters:** The app silently fights me. I'd rather see a clipped layout than have state mutated behind my back.
- **Recommendation:** Use a CSS `display:none` based on container width instead of mutating store state. When width recovers, copilot should reappear in the state I left it.

### [MAJOR] DependencyPicker has no keyboard navigation in results

- **Category:** Keyboard
- **Location:** `src/renderer/src/components/task-workbench/DependencyPicker.tsx:88-100, 169-200`
- **Observation:** Picker opens, focuses the search, but Arrow keys don't move through the result list and Enter doesn't pick the first match. Only Escape works. With 10+ tasks I have to mouse to each one. `aria-selected={false}` on every result is also a lie to screen readers.
- **Why it matters:** Adding deps is a multi-pick flow. It should be type-arrow-arrow-enter, not type-mouse-mouse-mouse.
- **Recommendation:** Track a `highlightedIndex`, support ArrowUp/Down/Enter, and update `aria-selected` to reflect it. Auto-pick first match on Enter when there's exactly one.

### [MAJOR] Failed task notes are unstructured strings shown only in a tiny `<pre>`

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:298-391`, `PipelineBacklog.tsx:117-130`
- **Observation:** When a task fails, the backlog "Failed" section just shows `task.notes` truncated in a one-line meta. The drawer shows the same notes in a `<pre>` with no copy button, no "open log file" button, no "view in agent console" link. The diagnostic note often points to `~/.bde/agent-manager.log` — and I can't open that from inside the app. That's another "I have to leave the app" moment.
- **Why it matters:** Recovery from failures is half my workflow. Right now triage means: read truncated notes → switch to terminal → tail the log → find the task ID → grep. That's many clicks too many.
- **Recommendation:** Add a "Copy" button on the failure block, an "Open in Logs view" link that filters the agent log to this `agent_run_id`, and ideally a one-shot `Open agent-manager.log` action. Render the recent errors block (lines 355-389) with structure not opacity-juggled inline styles.

### [MAJOR] Ship It / Create PR show generic disabled state when GH not configured

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:262-264, 299-300`
- **Observation:** If GitHub isn't configured, the buttons are greyed out with a tooltip `Configure GitHub in Settings → Connections`. There's no clickable link, no command palette entry, no inline "Configure now" CTA. New users will hit this immediately and have to navigate to Settings tab manually.
- **Why it matters:** Onboarding friction. Every disabled state with a "go configure X" tooltip is a missed deep link.
- **Recommendation:** Make the tooltip clickable to jump to Settings → Connections, or render a small "Configure GitHub" inline link beside the disabled buttons.

### [MAJOR] Auto-select on load picks the wrong task and there's no way back to "no selection"

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:378-385`
- **Observation:** On every mount, if no task is selected, the pipeline auto-selects the first active or queued task. Combined with the `loadData()` calls in ReviewActions handlers, this means after I merge/revise/discard a review task, I land back on a random in-progress task in the pipeline view I wasn't even looking at. The drawer pops open. I have to close it.
- **Why it matters:** The tool keeps choosing for me. The selection should follow my actions, not the latest state poll.
- **Recommendation:** Only auto-select on first mount, and only when there's exactly one obvious target. After an explicit `selectTask(null)` call, respect that null.

### [MINOR] "Cancel" stream button in Copilot calls `finishStreaming(true)` (success!)

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx:226-237`
- **Observation:** Clicking Cancel calls `finishStreaming(true)` — passing `true` for what looks like a success flag. The cancelled message stays in the conversation as if it completed. There's no "[cancelled]" marker.
- **Why it matters:** I won't know whether that half-baked answer is what the model actually said or what I cut off. Confusing for both me and any future re-reads.
- **Recommendation:** Append a `(cancelled)` badge to the message and pass `false` if that flag distinguishes success from cancel.

### [MINOR] Workbench draft persists even when only `title` is filled

- **Category:** State Loss / Edge Case
- **Location:** `src/renderer/src/stores/taskWorkbench.ts:165` (`draftHasContent`)
- **Observation:** I haven't read the full `draftHasContent` function but the comment says it avoids persisting "blank-form keystroke" only. Whatever the threshold is, I'd want explicit visibility: a tiny "Draft saved · 14:03" indicator next to the form heading. Right now there's no signal that autosave is even working.
- **Why it matters:** Trust. If I don't see autosave feedback, I won't trust it, and I'll keep manually saving to backlog as a hedge.
- **Recommendation:** Show a "Draft autosaved · timestamp" line in the form header, or a faint dot indicator. Standard Google Docs pattern.

### [MINOR] PipelineBacklog limits to 40 tasks with no scroll fallback for the rest

- **Category:** Edge Case / Performance
- **Location:** `src/renderer/src/components/sprint/PipelineBacklog.tsx:16, 34, 83-92`
- **Observation:** Backlog shows 40 by default, then a "Show N more" button switches to _all_ tasks at once. With 200 backlog tasks (my realistic case), clicking "Show more" renders the whole list synchronously. There's no virtualization in this sidebar.
- **Why it matters:** This is the audit-stress-test scale problem. Once I queue 50+ tasks, the sidebar will feel laggy.
- **Recommendation:** Either virtualize the backlog list, or paginate (Show 40 more / Show 80 more) instead of "all in one go".

### [MINOR] Drawer resize handle has no double-click reset

- **Category:** Keyboard / Workflow Friction
- **Location:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:169-188`
- **Observation:** I can drag the resize handle and use ArrowLeft/Right (nice!), but there's no "double-click to reset to default width" affordance. Once I drag it to 700px to read a long spec, getting back to a tidy 380px is fiddly.
- **Recommendation:** Double-click the handle resets to `DEFAULT_DRAWER_WIDTH`. Persist the width per-window so I don't reset every session.

### [MINOR] Task Planner Queue All silently skips tasks without specs

- **Category:** Error Recovery
- **Location:** `src/renderer/src/views/PlannerView.tsx:95-117`
- **Observation:** Queue All filters to `status==='backlog' && spec.trim() !== ''` and reports "No tasks ready to queue" if zero match. But if 5 match and 3 don't, the confirmation says "Queue 5 tasks" and the other 3 just disappear from the operation with no mention.
- **Why it matters:** I'd want to know which tasks I forgot specs for. Otherwise I'll think they got queued and lose track.
- **Recommendation:** Show "Queue 5 tasks (3 skipped — missing spec)" in the confirmation, and offer a "View skipped" link.

### [MINOR] CommitsTab shows commit date but no relative time and no link to GitHub

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/code-review/CommitsTab.tsx:38-52`
- **Observation:** Each commit row shows hash, message, author, date — but the hash isn't clickable. I can't jump to the GitHub commit even if a PR exists. I also can't see the commit body or diff.
- **Why it matters:** Reviewing a multi-commit branch means reading messages and diffs in tandem. Right now I have to switch back to ChangesTab and lose the commit context.
- **Recommendation:** Make the commit row clickable to scroll the diff to that commit's changes, and link the hash to GitHub if a PR exists.

### [MINOR] Status filter in pipeline header doesn't have an obvious "Clear filter" button

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/sprint/SprintPipeline.tsx:488-497` (PipelineHeader)
- **Observation:** I haven't read PipelineHeader fully, but the command palette has a "Show All Tasks" command — meaning the only way back from a status filter via UI is to find that command or click the same chip again. If I filter to "blocked" and forget, the pipeline looks wrong and I might think tasks vanished.
- **Recommendation:** Show an "× Clear filter" pill prominently when any filter is active, and dim the filtered-out stages so it's visually obvious the view is filtered.

### [MINOR] Discard action deletes work without offering "Save branch first"

- **Category:** Edge Case
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:201-220`
- **Observation:** Discard cleans up the worktree and marks task cancelled. The confirmation says "this cannot be undone." But sometimes I want to discard the _task tracking_ while keeping the branch around to cherry-pick from later.
- **Why it matters:** Edge case but real. Agents occasionally produce mostly-bad work with one good gem.
- **Recommendation:** Offer two flavors in the confirm modal: "Discard everything" vs "Mark cancelled, keep branch".
