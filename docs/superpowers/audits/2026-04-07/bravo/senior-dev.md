# Senior Dev (User) — Team Bravo — BDE Audit 2026-04-07

## Summary

I traced the developer surfaces I'd actually live in: Agents view (spawning + steering adhoc agents), the IDE (open folder, edit, save, terminal), Source Control (stage/commit/push), Settings, and the Panel system. There's a lot to like — the Code Review handoff at `review` status, the playground modal, the IDE's quick-open palette, the persistent error banner in Source Control. But there are real friction points that would burn me daily: the Settings → Agent Manager values requiring an app restart, the agent CommandBar being a single-line `<input>` (no Shift+Enter, no multiline paste), terminal tabs not surviving app restart, the BranchSelector's hard refusal to switch when the working tree is dirty (no stash escape hatch), and a fake `estimateCost` in the agent header that shows a price that has nothing to do with reality. None of these are blockers individually, but together they push the app from "I'd use this every day" to "I keep alt-tabbing back to my regular terminal."

## Findings

### [CRITICAL] Agent Manager settings require full app restart to take effect

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/settings/AgentManagerSection.tsx:1-3`, see also docstring `"Changes take effect after app restart."`
- **Observation:** The five fields a real user is most likely to change mid-session — `maxConcurrent`, `defaultModel`, `worktreeBase`, `maxRuntimeMs`, `autoStart` — are read once at agent-manager startup. The Settings UI has no warning surfacing this on save; you only learn by digging into the source comment. Same applies in `CLAUDE.md`: "Changes via Settings UI take effect on next app restart."
- **Why it matters:** "I bumped concurrency from 2 → 4 because I have a free hour" is the canonical use case for an autonomous agent runner. Forcing a full restart — which kills running terminals, in-flight agents, file watchers, and unsaved IDE state — to bump a number from 2 to 4 is a hard "no" for daily use. I will not restart this app.
- **Recommendation:** Hot-reload these settings. At minimum, post-save show an explicit banner ("Restart BDE to apply") next to the affected fields and keep a "Restart now" action in the UI. Better: have the AgentManager subscribe to settings changes so concurrency at least is live.

### [CRITICAL] Agent CommandBar is a single-line `<input>` — Shift+Enter does nothing, multiline paste collapses

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/agents/CommandBar.tsx:207-221`
- **Observation:** The bar is `<input type="text">`, not a `<textarea>`. There's no Shift+Enter handling. If I paste a stack trace, a code snippet, or a multi-paragraph instruction, it gets flattened to a single line. Compare with `LaunchpadGrid.tsx:157` which uses `<textarea rows={2}>` for the spawn prompt — and even that has only 2 rows and Enter-to-send (Shift+Enter not handled).
- **Why it matters:** Steering an adhoc agent is conversational. Real prompts include code, error logs, multi-step instructions. Forcing me to fit everything on one line is the kind of paper cut that makes me close the app and just open a Claude Code terminal instead — which defeats BDE's value prop.
- **Recommendation:** Convert to autosizing textarea, Enter to send, Shift+Enter for newline, with the standard `e.preventDefault()` on plain Enter. Also handle multiline paste explicitly in `LaunchpadGrid.tsx` so the spawn prompt isn't a 2-row jail.

### [MAJOR] Fake `estimateCost` shows misleading dollar amounts during agent runs

- **Category:** Error Recovery / Trust
- **Location:** `src/renderer/src/components/agents/ConsoleHeader.tsx:28-31`
- **Observation:** `estimateCost` does `events.length * 0.001` (or `0.003` for opus). This is not an estimate of anything — it's `event count × constant`. A 30-message run shows "$0.03" while the actual cost from `agent:completed.costUsd` could be $1.50 or more. Users see this number live and reasonably think it's a budget signal.
- **Why it matters:** I'd reach for cost the moment a long-running agent feels expensive, and I'd make stop/continue decisions based on it. A fake cost that's wrong by 50× is worse than no cost at all — it teaches users to distrust the whole UI.
- **Recommendation:** Either delete the live estimate entirely until the SDK reports interim usage, or label it `~tokens used` and base it on actual token counts from `agent:usage` events. Don't make up a USD figure.

### [MAJOR] Terminal tabs and PTYs don't survive app restart — IDE tabs do

- **Category:** State Loss
- **Location:** `src/renderer/src/stores/terminal.ts:76-86` (no persistence), vs. `src/renderer/src/views/IDEView.tsx:43-88` (which restores `ide.state` for editor tabs / sidebar / etc.)
- **Observation:** The IDE store carefully restores file tabs, sidebar collapse, expanded directories, even font size — but the terminal store starts every session with a single fresh `Terminal 1`. There's no rehydration in `terminal.ts`, no `terminal.state` setting equivalent, no recovery of `cwd` or kind for previously open shells.
- **Why it matters:** I keep three terminals open: dev server, test runner, and a scratch shell. Restarting BDE (which I'd be doing anyway after every Agent Manager settings tweak) blows them all away. This is the kind of state loss that quietly erodes trust until you stop trying.
- **Recommendation:** Persist the tab list (id, title, kind, cwd, isLabelCustom) in `terminal.state`. PTYs themselves can't survive a restart, but at minimum re-create shells in their previous `cwd` so I can `!!` and keep going.

### [MAJOR] BranchSelector blocks switching with no stash / autostash escape hatch

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/git-tree/BranchSelector.tsx:28-31`, `97-101`
- **Observation:** When `hasUncommittedChanges` is true, the dropdown is fully disabled with the tooltip "Commit or stash changes before switching branches." There's no stash button, no "Switch anyway" option that runs `git stash --include-untracked && git checkout`, no link to the IDE terminal.
- **Why it matters:** Switching branches with WIP is one of the most common things I do. I might be in the middle of debugging a flaky test on `main` and need to peek at a colleague's branch. Telling me to leave the app to do `git stash` is exactly the "I have to leave the app to do X" trap.
- **Recommendation:** Add a "Stash & switch" action and a `git stash list` view, OR at least a button that opens an IDE terminal scoped to that repo with the cursor on `git stash push -u -m "switch from <branch>"`.

### [MAJOR] Source Control has no `git pull`, no `git fetch`, no amend, no discard

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/git-tree/CommitBox.tsx:48-110`, `src/renderer/src/views/GitTreeView.tsx:200-398`
- **Observation:** The CommitBox surfaces only `Commit` and `Push`. There's no Pull/Fetch button anywhere in the header, no "Amend last commit" toggle, no per-file discard / restore in `FileTreeSection`. The header has refresh + branch selector + repo selector and that's it.
- **Why it matters:** Half my git workflow is `pull` (start of day) and `commit --amend` (typo in the last message). If the app can stage and push but not pull, I'll never use it as my primary git client — and if I'm not committing here, I'm not seeing the rest of BDE's git surface either. Discarding a single bad file edit is a daily operation.
- **Recommendation:** Add Pull and Fetch buttons next to Push. Add an "Amend" checkbox below the commit textarea that pre-fills the last commit message. Add right-click (or hover) "Discard changes" / "Restore" on each row in `FileTreeSection`.

### [MAJOR] Settings agent-manager has no "Restart now" action — you have to fully quit/relaunch

- **Category:** Recovery
- **Location:** `src/renderer/src/components/settings/AgentManagerSection.tsx:70-80`
- **Observation:** Save persists to settings table. Nothing in the UI prompts a restart, and there's no `app.relaunch()` button. Combined with finding #1, you're left to figure it out yourself.
- **Why it matters:** Even if hot-reload isn't viable for some fields, having `Save & Restart BDE` would at least make the friction one click instead of "remember to restart later."
- **Recommendation:** After save, show a "Restart to apply" toast with a button calling Electron `app.relaunch()` + `app.exit()`. Make it dismissible if the user wants to defer.

### [MAJOR] QuickOpenPalette loads ALL files at once with hardcoded skip-dirs (no `.gitignore`)

- **Category:** Performance
- **Location:** `src/renderer/src/components/ide/QuickOpenPalette.tsx:71-83`, walker at `src/main/handlers/ide-fs-handlers.ts:214-233`
- **Observation:** On open, `window.api.listFiles(rootPath)` synchronously walks the entire repo, returning every file path. The walker's `skipDirs` is hardcoded to `['node_modules', '.git', 'dist', 'build', '.next', 'coverage']` — no `.gitignore` parsing. Repos with `target/`, `vendor/`, `.venv/`, `__pycache__/`, `out/`, large `public/` asset trees, or build artifacts will balloon. After load, fuzzy matching runs on the array on every keystroke and slices to 50.
- **Why it matters:** Cmd+P needs to be instant. On a 50k-file monorepo this will block the renderer for 1–3 seconds the first time, and the input feels janky as you type because every keystroke remaps the entire array. Worse, my private repos have dirs the hardcoded list doesn't know about, so the result list is full of `.venv/lib/python3.13/site-packages/...` noise.
- **Recommendation:** Stream results from the main process. Respect `.gitignore` (use `simple-git`'s `ls-files` or `git ls-files --cached --others --exclude-standard`). Cache the list and invalidate via the existing `fs:watchDir` watcher.

### [MAJOR] AgentLaunchpad repo picker is a click-cycle, not a dropdown

- **Category:** Keyboard / Workflow Friction
- **Location:** `src/renderer/src/components/agents/LaunchpadGrid.tsx:130-140`
- **Observation:** The repo "selector" is a button that increments through the array on click. With three configured repos, picking the third requires two clicks; with five, four clicks. There's no keyboard equivalent, no visible list, and `repo` defaults to the first available — so if I usually work in repo #4, every spawn is "click click click click."
- **Why it matters:** I spawn agents constantly. This is the canonical "make the common path two clicks instead of one" anti-pattern. And there's no way to tell what the next repo in the cycle will be without clicking.
- **Recommendation:** Replace with a real `<select>` (or a popover listbox). Persist `lastUsedRepo` and default to it. Same for `model` if a user routinely uses opus.

### [MAJOR] No keyboard shortcut to focus the agent CommandBar / Launchpad prompt

- **Category:** Keyboard
- **Location:** `src/renderer/src/views/AgentsView.tsx:99-122`, `CommandBar.tsx:220` (autofocus only)
- **Observation:** Once you click out of the CommandBar (e.g., to scroll the console), there's no shortcut to refocus it. CommandBar autofocuses on mount but if the agent finishes and you click around, you're stuck reaching for the mouse. The Agents view registers commands for spawn / clear console but not "focus prompt."
- **Why it matters:** The whole flow is "watch console → type response → watch console." The keyboard hand should never have to move to the mouse. Most chat-style UIs use `/` or `i` to focus.
- **Recommendation:** Add a global "/" or `Cmd+L` shortcut that focuses the CommandBar input when AgentsView is active. Same for the Launchpad textarea.

### [MAJOR] IDE has no Find-in-Files (Cmd+Shift+F), no Cmd+P from outside IDE view

- **Category:** Keyboard / Workflow Friction
- **Location:** `src/renderer/src/views/IDEView.tsx:23-37`, `src/renderer/src/hooks/useIDEKeyboard.ts`
- **Observation:** The shortcut overlay lists `⌘P` (Quick open), `⌘F` (terminal find), but no `⌘⇧F` for project-wide search. Find is per-Monaco-instance only. Quick open requires the IDE view to be active — there's no global "open file" palette from Agents/Dashboard.
- **Why it matters:** "Where is this string used in the codebase?" is the second-most common dev action after editing. Without it I'm shelling out to `rg` in the terminal. Same for "I'm in the dashboard but I just thought of a file I want to edit" — the trip is Cmd+3, Cmd+P, type, Enter instead of Cmd+P, type, Enter.
- **Recommendation:** Wire up a project-wide ripgrep handler in main and a results panel. Make Quick Open globally available by switching to IDE view + opening the palette in one shortcut.

### [MINOR] BranchSelector dropdown has no search/filter

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/git-tree/BranchSelector.tsx:121-138`
- **Observation:** The dropdown lists every branch as a flat scrollable list with arrow-key nav only.
- **Why it matters:** I have 40+ branches in BDE. Finding `feat/copilot-identity-fix` means a lot of arrow-keying.
- **Recommendation:** Add a filter input at the top of the dropdown that focuses automatically when it opens.

### [MINOR] CommitBox char counter only counts the first line — doesn't tell me about body line wrapping

- **Category:** Minor Workflow Friction
- **Location:** `src/renderer/src/components/git-tree/CommitBox.tsx:44-66`
- **Observation:** `charCount = firstLine.length` and shows `n/72` only for the subject. Standard convention is also "wrap body at 72 characters." There's no visual ruler or warning for body lines.
- **Why it matters:** Half the value of a commit-message UI is enforcing conventions. Having half-conventions is confusing.
- **Recommendation:** Either drop the counter entirely or add a body wrap indicator. Bonus: support a `commit.template` from `git config`.

### [MINOR] Playground modal "Open in Browser" silently fails on error

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/agents/PlaygroundModal.tsx:141-148`
- **Observation:** `handleOpenInBrowser` catches errors and only `console.error`s them. No toast, no user feedback.
- **Why it matters:** If the temp file write fails (disk full, permissions), the user clicks the button and… nothing happens. They can't tell whether they need to look at devtools or try again.
- **Recommendation:** `toast.error('Failed to open in browser: ' + err.message)`.

### [MINOR] AgentConsole `agent not found` is a dead-end

- **Category:** Error Recovery
- **Location:** `src/renderer/src/components/agents/AgentConsole.tsx:191-205`
- **Observation:** When `agents.find(... === agentId)` returns undefined (e.g. agent was just pruned), the console shows a centered "Agent not found" string with no action — no "Back to fleet," no "Refresh."
- **Why it matters:** This will happen if I leave the console open and the cap evicts the agent, or if a parent refresh happens. I'm stuck staring at gray text.
- **Recommendation:** Show a button that clears `selectedId` and returns to the launchpad / fleet empty state.

### [MINOR] Save in IDE shows error toast but leaves the tab dirty with no recovery hint

- **Category:** Error Recovery
- **Location:** `src/renderer/src/views/IDEView.tsx:165-180`
- **Observation:** On save failure, `toast.error("Save failed: ...")` fires but `setDirty(id, false)` is not called. Good — the dirty state is preserved. But the toast is the only signal. There's no inline indicator on the tab, no "save as elsewhere" fallback, no "open file in Finder" escape hatch.
- **Why it matters:** Disk full, network drive disconnected, file became read-only mid-session — these happen. I want a way to copy my edits out to clipboard or save to a different path before I lose them by closing the tab.
- **Recommendation:** On save error, surface a persistent banner above the editor with "Retry," "Copy to clipboard," and "Save as…" actions. Critical for trust.

### [MINOR] No way to restart a single agent or "continue from last checkpoint"

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/views/AgentsView.tsx:181-191` (`/retry` only re-queues sprint tasks, not adhoc)
- **Observation:** `/retry` for an adhoc agent shows `toast.info('Adhoc agents cannot be retried — spawn a new agent instead')`. So if my agent crashes or I accidentally kill it, the entire conversation history is gone — I have to start over typing the task.
- **Why it matters:** One of the most useful adhoc agent flows is "spawn, watch it work for 10 minutes, accidentally close BDE, want to resume." The session ID is preserved in the SDK; `query()` supports `resume`. There should be a "Restart from session" action.
- **Recommendation:** For finished/cancelled adhoc agents with a session ID, add a "Resume session" button in `ConsoleHeader` that re-spawns with `resume: sessionId` and the same prompt template.

### [MINOR] Branch selector's disabled state hides too much — selector also can't show branches when working tree is dirty

- **Category:** Workflow Friction
- **Location:** `src/renderer/src/components/git-tree/BranchSelector.tsx:30-33`
- **Observation:** When dirty, `toggleDropdown` early-returns. So I can't even _see_ the branch list — I can't browse what's available, I can't read names, I can't decide what to switch to "after I commit."
- **Why it matters:** Read-only browsing of branches has no risk and is independently useful.
- **Recommendation:** Allow opening the dropdown when dirty, but disable the option `onClick`s with tooltips on hover.

### [MINOR] Agent kill confirmation: no diff or summary of work-in-progress before destroying it

- **Category:** Edge Case
- **Location:** `src/renderer/src/components/agents/AgentCard.tsx:1-40`, `ConsoleHeader.tsx:70-78`
- **Observation:** Stop/Kill is a single click in `ConsoleHeader`. There's no "agent has uncommitted changes in worktree X — view diff before killing?" check.
- **Why it matters:** Pipeline agents have worktrees. Killing them mid-edit can leave uncommitted work. I want to know what I'm losing before I click.
- **Recommendation:** Before calling `killAgent`, fetch `git status` from the worktree. If non-empty, show a confirm dialog with a one-line summary ("12 modified files in worktree — kill anyway / cancel / open diff").

### [MINOR] Panel system has no "reset layout" shortcut

- **Category:** Recovery
- **Location:** `src/renderer/src/components/panels/PanelLeaf.tsx`, `src/renderer/src/stores/panelLayout.ts`
- **Observation:** I can drag panels around, dock them, split them. If I make a mess and want to go back to the default, I either need to `rm ~/.bde/bde.db` (nuclear) or hand-undock everything. There's no "Reset layout" command in the palette or Settings.
- **Why it matters:** Panel systems are easy to mess up. The recovery story is "manually reverse 20 actions."
- **Recommendation:** Add a "Reset Panel Layout" command to the command palette and a button in Settings → Appearance. One click should restore the default.
