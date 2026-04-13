# Senior Dev (User) — Team Gamma (Full Pass) — BDE Audit 2026-04-07

## Summary

I spent the audit pretending to be a senior dev who lives in BDE every day — bouncing between Workbench, Agents, IDE, Pipeline, Code Review, and Source Control with two or three things in flight at once. The product is impressively cohesive on the happy path, but the seams between features bleed in painful ways: keyboard shortcut handlers leak across hidden tabs, the IDE and the agents share a single global watcher with no awareness of one another, "review" actions silently re-load the whole sprint task list (closing your selection mid-flow), and several user-facing affordances (`bde:refresh`, `bde:escape`, the ⌘9 slot, auto-commit-after-IDE-edit) are dead ends that look live. The biggest single risk for daily use is the panel system: every tab in a leaf is **mounted simultaneously** (display:none), which means side-by-side panels actually quadruple-mount stores, polling, and global keydown handlers — a real mess once you start tearing off windows.

## Findings

### [CRITICAL] All tabs in a panel leaf are mounted, not unmounted, when inactive

- **Category:** Cross-feature Friction / Performance / State Loss
- **Location:** `src/renderer/src/components/panels/PanelLeaf.tsx:104-119`
- **Observation:** `PanelLeaf` renders **every** tab in `node.tabs.map(...)` and toggles a class for the active one. Inactive tabs are still mounted and run their effects, polling, command registration, and keydown handlers. This isn't the usual "render the active one" pattern.
- **Why it matters:** With three views in one panel (e.g. IDE + Agents + Code Review tabbed together) you have three sets of `document.addEventListener('keydown', …)` running at once. ReviewQueue's `j`/`k` keys (`ReviewQueue.tsx:25-48`), the IDE's command-palette command registration (`IDEView.tsx:240-284`), and CodeReviewView's command registration (`CodeReviewView.tsx:23-103`) all live concurrently. This is also why Cmd+P quick-open in the IDE could feel sluggish in a multi-tab leaf — every other view is firing effects on every poll.
- **Recommendation:** Only mount the active tab's view, or at least gate the side-effecting hooks behind `isActive`. If keep-mounted is intentional (preserve scroll/state), then move every keyboard listener and `registerCommands` call behind a `useActiveTab(node.panelId)` guard.

### [CRITICAL] IDE has a single global file watcher; cannot follow agent worktrees, can't watch two roots

- **Category:** Cross-feature Friction / State Loss
- **Location:** `src/main/handlers/ide-fs-handlers.ts:13-15` (module-level `ideRootPath`/`watcher`/`debounceTimer`) and `:235-249` (`fs:watchDir` registration)
- **Observation:** The IDE root and `fs.watch` are module-level singletons. Opening any folder calls `stopWatcher()` and replaces it. There is no concept of "watch the worktree the agent is editing" or "watch two repos at once". Tear-off IDE windows would silently steal each other's watcher.
- **Why it matters:** The product story is "BDE is your one development environment" — but if I open the BDE source in IDE while a pipeline agent is actively editing files in `~/worktrees/bde/agent/<task>/...`, I never see those edits. If I tear off a second IDE pane to look at the agent's worktree, the original IDE's file tree silently stops updating because the global watcher got replaced. A senior dev will hit this within an hour.
- **Recommendation:** Key the watcher off `windowId`+`rootPath` (Map of watchers). At minimum, broadcast a "watcher hijacked" event so the previous IDE pane can refuse to keep displaying stale data.

### [CRITICAL] Code Review actions clear selection and reload everything mid-review

- **Category:** State Loss / Error Recovery
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:71-72,99-100,127-128,213,232-238` and the `applySnapshot`/`useEffect` reset in `ChangesTab.tsx:54-80`
- **Observation:** Every successful action — Ship It, Merge Locally, Create PR, Discard, Request Revision — calls `selectTask(null)` followed by `loadData()`. The detail panel collapses, the diff list resets, scroll position is lost, and the user is dumped back at "No task selected" while the global tasks list refetches. Even if the very next task in the queue is what they want to review, they have to re-find it.
- **Why it matters:** Code Review is a high-frequency loop. The intended workflow is "review, ship, j to next, review, ship". Today it's "review, ship, hunt for next task, click, wait for diff to reload". The j/k navigation handler exists in `ReviewQueue.tsx:25-48` but it's defeated because `selectedTaskId` was just set to null. This single behavior turns a 2-second review loop into a 10-second hunt-and-peck.
- **Recommendation:** After a terminal action, advance selection to the next review task in the queue (or the previous if at end). Don't full-reload — patch the single task locally so the queue updates without flicker.

### [CRITICAL] `bde:refresh` and `bde:escape` are dispatched but have no listeners

- **Category:** Keyboard / Error Recovery
- **Location:** `src/renderer/src/App.tsx:272` (`bde:escape` dispatch), `:385` (`bde:refresh` dispatch); grep for listeners returns zero non-self matches
- **Observation:** Pressing the rebound "refresh" key fires `window.dispatchEvent(new CustomEvent('bde:refresh'))`. No view listens for it. Same for `bde:escape` — App dispatches it as a fallback Esc, but no module subscribes. The keybindings UI happily shows them as bound actions.
- **Why it matters:** Users will rebind these expecting them to work. They won't. A senior dev will spend ten minutes debugging "is my keybinding broken?" before realizing the entire mechanism is dead. These are silent bugs masquerading as features.
- **Recommendation:** Either wire them up (each view's polling hook listens for `bde:refresh` and force-refetches; modals listen for `bde:escape`) or remove them from `keybindings.ts` and the shortcuts overlay.

### [MAJOR] Cmd+9 is unbound; ⌘0 is Workbench (off-pattern)

- **Category:** Keyboard
- **Location:** `src/renderer/src/lib/view-registry.ts:81-90`
- **Observation:** Shortcuts are ⌘1 dashboard, ⌘2 agents, ⌘3 ide, ⌘4 sprint, ⌘5 review, ⌘6 git, ⌘7 settings, ⌘8 planner, **⌘0** workbench, ⌘9 unused.
- **Why it matters:** Workbench is the primary task creation surface. Putting it on ⌘0 (which usually means "default zoom" in editors) is unmemorable and breaks the 1..n mental model. Power users will never reach for ⌘0 without checking the shortcut overlay every time.
- **Recommendation:** Move Workbench to ⌘9 (or swap it with Settings). Reserve ⌘0 for "reset zoom" if BDE ever ships text scaling.

### [MAJOR] Agent worktree edits don't surface in Source Control or IDE

- **Category:** Cross-feature Friction
- **Location:** `src/renderer/src/views/GitTreeView.tsx:55-65` (loads `repoPaths` from settings), agent worktrees live under `worktreeBase` from `worktree.ts:244-310`
- **Observation:** `GitTreeView` only knows about user-configured repos (`loadRepoPaths()`). The repo selector doesn't list active agent worktrees. When an agent is mid-task in `~/worktrees/bde/<repo-slug>/<taskId>`, I cannot tail its uncommitted changes through Source Control. I can only see them after merge — by which point they're in main.
- **Why it matters:** A senior dev wants to peek at what an agent is doing without context-switching to a terminal or to the Code Review view (which only shows tasks in `review` status). The whole point of BDE-as-IDE is to _avoid_ leaving the app.
- **Recommendation:** Surface active agent worktrees in the GitTreeView repo dropdown (perhaps under an "Agents" group). Bonus: clicking one previews the live diff against `origin/main` exactly the way Code Review will once the agent transitions.

### [MAJOR] No collision detection between IDE saves and agent activity on the same file

- **Category:** Edge Case / State Loss
- **Location:** `src/main/handlers/ide-fs-handlers.ts:172-189` (`writeFileContent`) — atomic write, but no awareness of the agent manager
- **Observation:** I can open `src/main/index.ts` in the IDE, edit it, and hit ⌘S while a pipeline agent is busy writing to that exact file in a worktree. The IDE writes to the user's checkout; the agent writes in its worktree; both succeed. Later the agent's PR merges and silently clobbers my change because the agent branched off `main` before my edit hit. There's no warning, no merge, no diff prompt.
- **Why it matters:** This is the "data loss while looking the other way" scenario senior devs fear. It breaks the trust contract.
- **Recommendation:** When the IDE saves a file, check whether any active agent has a worktree referencing the same repo path; if yes, surface a non-blocking toast: "Agent X is editing this repo in branch Y — your edit may conflict on merge. Open Code Review to compare." Stretch: a real `worktree status` summary in IDE's status bar.

### [MAJOR] Optimistic update TTL (2 seconds) is shorter than typical sprint poll latency

- **Category:** State Loss
- **Location:** `src/renderer/src/stores/sprintTasks.ts:28` (`PENDING_UPDATE_TTL = 2000`) and `:96-138` merge logic
- **Observation:** When I edit a task field (priority, depends_on) the optimistic patch is preserved for 2s. If the next poll arrives at 2.001s and the server hasn't yet picked up the write (SQLite + IPC + main loop), the merge logic discards my local field and shows the stale value. The user sees their input "snap back" briefly — classic optimistic-update flicker.
- **Why it matters:** I noticed during the audit and would have logged it as a "ghost reverted my edit" bug if I were a real user. This is exactly the kind of intermittent failure that erodes trust.
- **Recommendation:** Bump TTL to 5-8s, or better: clear pending only when the server response arrives, not on a clock. The current code already has the round-trip awareness in `updateTask` (`:170-189`) — the TTL is a redundant safety net that does more harm than good.

### [MAJOR] AgentsView j/k-style hidden interactions; ReviewQueue j/k uses document-level listener

- **Category:** Keyboard / Cross-feature Friction
- **Location:** `src/renderer/src/components/code-review/ReviewQueue.tsx:25-48`
- **Observation:** ReviewQueue installs a `document.addEventListener('keydown', …)` for j/k. It filters INPUT/TEXTAREA/SELECT but **not** Monaco's contentEditable, and **not** when the Code Review view is in an inactive panel tab (because every tab is mounted — see CRITICAL #1 above). So if a user has Code Review tabbed alongside IDE in the same panel, typing `j` or `k` in a Monaco editor pane outside an INPUT could still let it through. Even if Monaco swallows it first, this is fragile.
- **Why it matters:** A senior dev will type `k` or `j` in some terminal-adjacent input and watch their CodeReview selection silently change in the background. Then they'll wonder why their review queue is on a different task than they expected.
- **Recommendation:** Scope keyboard listeners to the focused panel via the panel-leaf focus state, or use `useEffect` with an `isActive` check from `usePanelLayoutStore.getState().focusedPanelId`. Better yet: use a single central key-router (like the App.tsx handler) instead of view-local document listeners.

### [MAJOR] PollingProvider runs every poller globally regardless of which views are open

- **Category:** Performance
- **Location:** `src/renderer/src/components/PollingProvider.tsx:11-21`
- **Observation:** Sprint, PR status, dashboard, git status, agent session, cost, and health-check polling all run on app mount, in the root `<PollingProvider>`. No view-aware gating. If I never open the dashboard, dashboard polling still hits the main process every 60s. If I never open Source Control, git status polling still runs every 30s.
- **Why it matters:** On a slower machine or under battery, the always-on polling tax is real — and confusingly hard to disable. The hooks already exist (`useVisibilityAwareInterval`); they just need to consult the panel layout for "is anyone showing this view?".
- **Recommendation:** Each polling hook should consult `usePanelLayoutStore.getState()` for whether its view is mounted (or use the existing `getOpenViews()` helper from `panelLayout.ts:76`) and short-circuit when not.

### [MAJOR] No "Promote to Code Review" affordance in scope for adhoc agents who completed in worktree

- **Category:** Cross-feature Friction
- **Location:** Scratchpad notice in `AgentsView.tsx:328-346` references "Promote to Code Review in its console header" — but I'd want to verify the path; the user-facing rule is "adhoc agents are not tracked"
- **Observation:** The recent commit history (`3b2f8763 feat(agents): adhoc worktrees + Promote to Code Review`) added this, and the UI now claims the affordance exists. Good. But the Scratchpad text in `AgentsView.tsx:328-346` is the only place in the app that explains this — it's only visible the first time you spawn an agent. After that, an experienced user might forget and discard work that should have been promoted.
- **Why it matters:** Discovery of this critical button shouldn't require reading a one-time notice. The button's hint should be omnipresent on completed agents in the fleet list (e.g., a small "Promote" badge on the AgentCard).
- **Recommendation:** Surface "Promote" as a persistent action on every completed adhoc agent in `AgentList`, not only in the console header.

### [MAJOR] CodeReview "Ship It" success toast is misleading on push failure

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:67-70`
- **Observation:** `toast.success(result.pushed ? 'Merged & pushed!' : 'Merged locally (push failed — push manually)')` — this is a _success_ toast even when the push step failed. The task is also still marked as "shipped" in the success branch.
- **Why it matters:** Users will read "success" and assume their PR is up. Then they'll be confused tomorrow when CI never ran. A push failure during Ship It is a partial failure and should be a warning toast at minimum, with a one-click retry.
- **Recommendation:** Use `toast.warning()` (or whatever the equivalent is) when `!result.pushed`, and include a "Retry push" action button on the toast.

### [MINOR] Workbench Copilot stream failure handling is text-only

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/task-workbench/TaskWorkbench.tsx:66-77`
- **Observation:** On `chatStream` failure the assistant message is rewritten to "Failed to reach Claude. Check your connection and try again." There's no retry button, no error code, no link to settings. The only recovery is to retype the prompt.
- **Recommendation:** Render the failed assistant bubble with a small "Retry" button that resends the same message. Bonus: distinguish auth failures (point to Settings → Connections) from network failures.

### [MINOR] Unsaved IDE tabs don't block view switches, only window unload

- **Category:** State Loss
- **Location:** `src/renderer/src/views/IDEView.tsx:222-232` (only handles `beforeunload`)
- **Observation:** The IDE installs a `beforeunload` guard for dirty tabs. But if I have an unsaved file in IDE and I press ⌘5 to jump to Code Review, the IDE view stays mounted (because of CRITICAL #1 above) so my edit is preserved — _for now_. If I close the tab in PanelLeaf, however, the view unmounts and I lose unsaved state with no warning. The unsaved-on-tab-close confirm only fires on explicit `closeTab` from the EditorTabBar (`:191-203`), not on panel-tab close.
- **Why it matters:** Senior devs close panel tabs all day. If "close panel tab" silently destroys unsaved IDE work, that's a data loss bug.
- **Recommendation:** When the IDE view is about to unmount and has dirty tabs, show the same UnsavedDialog before allowing PanelLeaf to drop it. This requires hooking into the panelLayout `closeTab` action with a pre-close veto.

### [MINOR] Workbench layout collapses copilot at 600px without telling the user

- **Category:** State Loss
- **Location:** `src/renderer/src/components/task-workbench/TaskWorkbench.tsx:13-27`
- **Observation:** A `ResizeObserver` toggles `copilotVisible` off if the workbench width drops below 600px. It also calls `toggleCopilot` (which mutates store state), so when I drag a panel resize handle to make Workbench narrow, the copilot disappears. When I drag back wide, it doesn't come back automatically. Mid-conversation context can be hidden.
- **Recommendation:** Track an "auto-collapsed" flag separate from "user-collapsed" and re-expand when width crosses the threshold back upward. Show a toast when auto-collapsing: "Copilot hidden — drag wider to restore".

### [MINOR] Spawning an adhoc agent does not navigate or scroll into the new agent's console

- **Category:** Cross-feature Friction
- **Location:** `src/renderer/src/components/agents/AgentLaunchpad.tsx:33-51`, `AgentsView.tsx:364-371`
- **Observation:** After `spawnAgent` succeeds, the launchpad calls `onAgentSpawned()` which sets `showLaunchpad=false` and `fetchAgents()`. The newly spawned agent isn't auto-selected, so the user lands on whatever was selected before (or nothing).
- **Why it matters:** The whole point of spawning an agent is to watch it run. Making the user hunt the fleet sidebar for the just-created entry is needless friction.
- **Recommendation:** Pass the new agent ID back from `spawnAgent` and call `setSelectedId(newId)` in `onAgentSpawned`.

### [MINOR] Repository selector in Source Control silently shows 0 repos when none configured

- **Category:** Edge Case / Error Recovery
- **Location:** `src/renderer/src/views/GitTreeView.tsx:220-233` and `:382-388`
- **Observation:** If `repoPaths.length === 0`, the selector renders nothing and the empty state says "Working tree clean — No uncommitted changes." That's misleading: the working tree isn't clean, there's just no repo configured. A first-time user opening Source Control before configuring a repo will see "Working tree clean" and assume everything is fine.
- **Recommendation:** Distinguish "no repo configured" from "clean tree". Show an EmptyState that links to Settings → Repositories.

### [MINOR] CodeReview rebase status check fires per-task-id but with no debouncing

- **Category:** Performance
- **Location:** `src/renderer/src/components/code-review/ReviewActions.tsx:34-41`
- **Observation:** `useEffect` runs `review.checkFreshness` on every change of `task?.id` or `task?.rebased_at`. With j/k navigation across the queue this fires a freshness check per arrow press. If freshness checks shell out to git, that's an `execFile` per keystroke during a fast review.
- **Recommendation:** Debounce by 250ms or cancel in-flight checks when a new selection arrives.

### [MINOR] CodeReview ChangesTab `applySnapshot` is called inside an effect with hidden side effects

- **Category:** Edge Case
- **Location:** `src/renderer/src/components/code-review/ChangesTab.tsx:38-80`
- **Observation:** `applySnapshot` is defined as a non-memoized helper but called from inside the load effect; it captures `snapshot` and `setDiffFiles` via closure. Because the effect's deps are unclear, falling-back to a snapshot can race with a fresh worktree diff response if the user clicks between tasks fast.
- **Recommendation:** Move `applySnapshot` into the effect body (or `useCallback` it) so the dependency surface is explicit, and use the `cancelled` flag consistently across both branches.

### [MINOR] Activity chart in Agents view uses `Date.now()` inside `useMemo`

- **Category:** Edge Case
- **Location:** `src/renderer/src/views/AgentsView.tsx:127-151`
- **Observation:** The eslint-disable comment acknowledges this — `Date.now()` makes the memo non-pure, so the chart only refreshes when `agents` changes. It's stuck on whatever clock value happened on the last agent fetch, so the bucket labels become stale immediately and never update until something moves in the agent list.
- **Recommendation:** Recompute on a 60s interval, or accept staleness and label the chart "as of <time>".
