# Product Manager — Team Bravo — BDE Audit 2026-04-07

## Summary

BDE has impressive surface area for a pre-launch product — Agents view, IDE, Source Control, Dashboard, and a 9-section Settings panel — but coherence cracks show up almost immediately. The product has three different task-creation entry points, an Agents launcher whose relationship to the Sprint Pipeline is explained only through a small inline note, dead/orphaned settings sections (`AboutSection`, `WebhooksSection`), and a Source Control view that ships without Pull or Fetch — a basic git affordance any new user will reach for in their first session. The Agent Console exposes a useful slash-command surface (`/stop`, `/checkpoint`, `/scope`...) but those commands are essentially undiscoverable outside typing `/`. Several quality details — bogus cost estimation in the console header, single-line input that can't accept newlines, "Auto-start" hidden inside Agent Manager settings — feel half-finished. None of this is shipping-blocking, but cumulatively it gives the impression of a powerful tool whose seams are still visible.

## Findings

### [CRITICAL] Source Control has no Pull or Fetch

- **Category:** Feature Gap
- **Location:** `src/renderer/src/views/GitTreeView.tsx:200`, `src/renderer/src/components/git-tree/CommitBox.tsx`
- **Observation:** The Source Control view exposes Stage / Unstage / Commit / Push / Branch checkout / Refresh status, but there is no Pull and no Fetch button anywhere. A grep across `src/` for `git:pull`, `git:fetch`, `gitPull`, `gitFetch` returns zero matches — the IPC channel itself is missing. Users on a multi-machine workflow, or pulling agent-pushed branches, cannot bring remote changes into the repo from inside BDE at all.
- **Why it matters:** Pull is one of the three or four operations every git user expects in any source-control UI. The empty state literally suggests "pull updates to see changes here" (`GitTreeView.tsx:386`) but the product offers no way to do that. New users will assume the feature is broken, not missing.
- **Recommendation:** Add `git:pull` and `git:fetch` IPC channels and surface them next to Push in `CommitBox` (or in the header). Show last-fetched timestamp and ahead/behind counts on the branch chip.

### [CRITICAL] Branch checkout is silently disabled when working tree is dirty, with no escape hatch

- **Category:** Workflow
- **Location:** `src/renderer/src/components/git-tree/BranchSelector.tsx:28`
- **Observation:** `isDisabled = hasUncommittedChanges` — any uncommitted file (staged, modified, or untracked) disables the entire branch selector. There is no stash flow, no "discard and switch", no "force checkout", and no "Create New Branch" affordance anywhere in the git surface (grep for "Create.*Branch" / "new.*branch" returns nothing).
- **Why it matters:** This is the single most common git workflow — "let me jump to another branch, fix something, come back". BDE blocks it without explanation and offers no path forward. Users will be forced to drop into the IDE terminal to run `git stash` or `git checkout -b`, defeating the purpose of having a Source Control view.
- **Recommendation:** Add (1) a "Create new branch" entry at the top of the dropdown, (2) a stash/pop flow, and (3) when checkout is blocked, show a tooltip explaining why with a "Stash & switch" action.

### [CRITICAL] Three different task-creation entry points with overlapping responsibilities

- **Category:** Cohesion
- **Location:** `src/renderer/src/lib/view-registry.ts:77` (Workbench), `view-registry.ts:84` (Planner), `src/renderer/src/views/DashboardView.tsx:217` ("Create First Task" CTA)
- **Observation:** Task Workbench (⌘0), Task Planner (⌘8), and the Sprint Pipeline all participate in task creation. `BDE_FEATURES.md` describes Workbench as "single-task spec drafting" and Planner as "multi-task workflow planning", but a new user has no way to know which one to pick. The Dashboard's "Create First Task" CTA hardcodes routing to Workbench, the Planner's `handleAddTask` also routes back into Workbench, and the Sprint Pipeline's note in `AgentsView.tsx:344` says "queue tasks from Task Workbench". So Workbench is the de-facto entry point — yet it has the lowest-priority shortcut (⌘0) while Planner gets ⌘8.
- **Why it matters:** Three doors into the same room is a sure way to lose new users. The shortcut numbering reinforces the confusion (Planner numbered before Workbench despite being the secondary tool).
- **Recommendation:** Either merge Planner into Workbench as a "multi-task" mode, or make the relationship explicit in both views ("Planning a multi-task epic? Open Task Planner."). Reassign Workbench to ⌘8 and Planner to ⌘0 (or vice versa) so the primary entry point gets the primary shortcut.

### [MAJOR] AboutSection and WebhooksSection are dead components

- **Category:** Polish
- **Location:** `src/renderer/src/views/SettingsView.tsx:35`, `src/renderer/src/components/settings/AboutSection.tsx`, `src/renderer/src/components/settings/WebhooksSection.tsx`
- **Observation:** `SECTIONS` array in `SettingsView.tsx` lists 10 entries; `SECTION_MAP` and `SECTION_META` both include an `about` entry — but `about` is never added to `SECTIONS`, so the user can never reach the About page through the sidebar. Separately, `WebhooksSection.tsx` exists as a standalone component file (with its own test), but it is imported nowhere except its own test — webhook UI is instead inlined into `AgentManagerSection.tsx`. `BDE_FEATURES.md` advertises a 9-tab settings panel including "About", and the App→Settings shortcut docs also reference an About surface.
- **Why it matters:** The About surface is documented but unreachable. WebhooksSection is a 100% orphan that no one is maintaining. Both are signs of half-completed refactors.
- **Recommendation:** Either add About to `SECTIONS` or delete `AboutSection.tsx`. Either consolidate webhook management on `WebhooksSection` (with its own sidebar entry) or delete the orphaned file.

### [MAJOR] Agent slash commands are completely undiscoverable

- **Category:** UX
- **Location:** `src/renderer/src/components/agents/CommandBar.tsx:217`, `src/renderer/src/components/agents/commands.ts`
- **Observation:** The Agent Console exposes 7 powerful slash commands (`/stop`, `/retry`, `/focus`, `/checkpoint`, `/test`, `/scope`, `/status`) via `AgentCommand[]`, but they only become visible after the user types `/`. There is no help button, no "Show commands" affordance in the console header, no tooltip on the command bar, no entry in the IDE-style ⌘/ shortcuts overlay. The placeholder says "or / for commands…" — that is the only hint a user gets.
- **Why it matters:** These commands are the entire interactive control surface for a running agent. A user who never types `/` will never learn they exist, and will instead reach for the kill button.
- **Recommendation:** Add a "?" or keyboard-shortcut button in `ConsoleHeader` that opens a command reference modal (mirroring the IDE shortcuts overlay at `IDEView.tsx:400`). Surface `/checkpoint`, `/stop`, `/retry` as visible action buttons rather than commands.

### [MAJOR] Agent Console "estimated cost" is fabricated, not estimated

- **Category:** Polish
- **Location:** `src/renderer/src/components/agents/ConsoleHeader.tsx:28`
- **Observation:** `estimateCost(events, model)` returns `events.length × 0.001` (or `× 0.003` for opus). It is not based on tokens, model pricing, or any real cost data — it is a constant per event count. This value is rendered in the header in italic orange next to the real `costUsd` for completed agents.
- **Why it matters:** Showing users a made-up dollar figure as if it were a live estimate is worse than showing nothing. A user who runs a long agent will trust the orange `~$X.XX` and either get spooked or undershoot the real number.
- **Recommendation:** Either compute estimated cost from real token counts (the SDK exposes `usage` in the wire protocol), or remove the estimate entirely and show "—" until the agent reports `costUsd`.

### [MAJOR] CommandBar uses single-line `<input>`, can't accept multi-line messages

- **Category:** UX
- **Location:** `src/renderer/src/components/agents/CommandBar.tsx:208`
- **Observation:** The agent message input is a `<input type="text">`, not a `<textarea>`. There is no Shift+Enter handling because there is no way to insert a newline at all. By contrast, the LaunchpadGrid uses a textarea (`LaunchpadGrid.tsx:157`) and the Code Review revision modal does too — but the steady-state "talk to a running agent" surface does not.
- **Why it matters:** Steering an agent often requires multi-paragraph context, code snippets, or pasted error logs. Forcing all of that onto one line is hostile.
- **Recommendation:** Convert to `<textarea>` with auto-grow (1–6 rows), Shift+Enter for newline, Enter to submit.

### [MAJOR] Webhooks UI is buried inside Agent Manager settings, not its own section

- **Category:** Cohesion
- **Location:** `src/renderer/src/components/settings/AgentManagerSection.tsx:332`
- **Observation:** Webhook configuration (a first-class integration feature with HMAC secrets, event filtering, test/delete) lives inside the "Agent Manager" settings tab below the concurrency/worktree/runtime sliders. Users looking for webhooks will scan the sidebar (Connections, Repositories, Templates, Agent Manager…) and never think to open Agent Manager. There is also a parallel `WebhooksSection.tsx` component that suggests the team intended to break this out and didn't finish.
- **Why it matters:** Webhooks are an integration concern (Connections-adjacent), not a pipeline-execution concern. Burying them makes the feature invisible to anyone who isn't already searching.
- **Recommendation:** Move webhooks to their own settings tab (or under Connections), and use the existing `WebhooksSection.tsx` as the home.

### [MAJOR] IDE has no global Find/Replace and no project-wide search

- **Category:** Feature Gap
- **Location:** `src/renderer/src/components/ide/`, `src/renderer/src/views/IDEView.tsx`
- **Observation:** The IDE ships QuickOpen (⌘P), file explorer, multi-tab editor, and integrated terminal — but a grep across `components/ide/` for `find.*replace`, `globalSearch`, `problemsPanel` returns zero matches. There is no Find In Files, no Find/Replace in the active editor (only the terminal find), and no problems/diagnostics panel. The shortcuts list at `IDEView.tsx:23` confirms ⌘F is bound to "Find in terminal" — not in editor.
- **Why it matters:** "Open a folder, edit a file, search the codebase" is the absolute baseline for a code editor. Without project-wide search, the IDE can't be the primary editing surface for any non-trivial repo, which undercuts BDE's positioning as a development environment.
- **Recommendation:** Wire Monaco's built-in find widget (⌘F when editor focused), and add a sidebar Search panel using the existing Grep/ripgrep IPC.

### [MAJOR] AgentLaunchpad and Sprint Pipeline have unclear, easy-to-confuse roles

- **Category:** Cohesion
- **Location:** `src/renderer/src/views/AgentsView.tsx:328`, `src/renderer/src/components/agents/AgentLaunchpad.tsx`
- **Observation:** The Agents view shows a "Scratchpad" inline note (`AgentsView.tsx:331`) explaining that agents spawned here are NOT tracked by the sprint pipeline, and that you must click "Promote to Code Review" to flow work into the queue. The Promote button is in the console header but only appears for `source === 'adhoc' && status === 'done' && worktreePath && !sprintTaskId` (`ConsoleHeader.tsx:92`). New users have to read four sentences of explanation just to understand which entry point does what, and they will find out about Promote _after_ their agent finishes.
- **Why it matters:** The product has two parallel agent pipelines (scratchpad and sprint) with distinct guarantees, and the only documentation is a small note in a sidebar. Users will spawn agents in the wrong place, then be surprised when the work doesn't show up in the pipeline.
- **Recommendation:** Either rename "Agents" to "Scratchpad" in the activity bar, or add an upfront "Spawn for Sprint" / "Spawn Scratchpad" choice on the launchpad that funnels into the right tracking model. Make Promote visible (greyed) before the agent finishes so users know it exists.

### [MAJOR] Dashboard "Activity" feed click routes to Agents view, not the source event

- **Category:** UX
- **Location:** `src/renderer/src/views/DashboardView.tsx:256`
- **Observation:** `onFeedEventClick={() => setView('agents')}` — every event in the activity feed routes to the same destination (the Agents view) regardless of whether the event is an error, completion, PR open, or task transition. There is no contextual deep-link to the specific task or agent that fired the event.
- **Why it matters:** The activity feed loses most of its value if you can't click through to the thing it's about. Users will stop trusting the feed as a way to investigate problems.
- **Recommendation:** Pass the event to the click handler and route based on type — agent errors → Agents view with that agent selected, task completions → Sprint Pipeline filtered to that task, PR events → Code Review.

### [MINOR] IDE empty state offers no "Clone" or "Open Recent" beyond a flat list

- **Category:** Polish
- **Location:** `src/renderer/src/components/ide/IDEEmptyState.tsx:27`
- **Observation:** First-launch IDE shows "Open Folder" and a flat list of recent folders. There is no "Clone repository", no integration with the Repositories settings (which already store `localPath`), and no way to drag-and-drop a folder onto the panel.
- **Why it matters:** The Settings → Repositories list is the canonical source of truth for "projects this user works on" — but the IDE doesn't read from it, so the user has to find each repo on disk separately. Two configuration surfaces, no glue.
- **Recommendation:** Show configured repositories on the empty state with one-click open, and add a "Clone…" button that calls a `git:clone` IPC.

### [MINOR] CommitBox character counter only flags >72 but doesn't enforce or wrap

- **Category:** Polish
- **Location:** `src/renderer/src/components/git-tree/CommitBox.tsx:46`
- **Observation:** The 72-char counter turns red when the first line goes over, but the user can still commit. There is no soft-wrap, no body/subject separation prompt, and no "Generate from staged changes" affordance (despite this being a Claude-powered product).
- **Why it matters:** This is a missed opportunity in a tool whose entire premise is AI assistance — the commit box could write the commit message from the staged diff with a single click.
- **Recommendation:** Add an "AI Compose" button that calls the agent SDK with the staged diff and the conventional-commit format from `CLAUDE.md`.

### [MINOR] Agent Manager "autoStart" is a hidden global toggle with no user-visible effect description

- **Category:** UX
- **Location:** `src/renderer/src/components/settings/AgentManagerSection.tsx:319`
- **Observation:** Auto-start is a bare checkbox labeled "Auto-start" with no help text, no link to docs, and no indication of what it auto-starts (the drain loop? agents on app launch?). It also requires a restart to take effect, which is mentioned only in the card subtitle.
- **Why it matters:** A user who flips this off may break their pipeline silently because they didn't realize it controls whether queued tasks run at all.
- **Recommendation:** Add a description ("Automatically claim queued sprint tasks when BDE starts. Off = manual start only."), and gate dangerous-state toggles behind a confirm.

### [MINOR] Agent Activity chart at bottom of Agents view uses fixed 6-hour window, no zoom

- **Category:** Polish
- **Location:** `src/renderer/src/views/AgentsView.tsx:127`
- **Observation:** The activity chart hardcodes a 6-hour window with 1-hour buckets and no controls. For users who run agents intermittently (most pre-launch users), this chart will be empty most of the time. There's also no relationship to the metrics shown on the Dashboard.
- **Why it matters:** Real estate spent on a near-empty chart that can't be configured. Either it should be more useful or it should go.
- **Recommendation:** Add a window selector (1h / 6h / 24h / 7d) or remove the chart and reuse Dashboard MiniChart components.

### [MINOR] LaunchpadGrid repo picker is a click-cycle button, not a dropdown

- **Category:** UX
- **Location:** `src/renderer/src/components/agents/LaunchpadGrid.tsx:131`
- **Observation:** The repo selector cycles through repos on each click (`setRepo(repos[(idx + 1) % repos.length]?.label …)`). For a user with 4–5 repos, this means clicking up to 4 times to get to the right one, with no preview of the full list.
- **Why it matters:** Discoverability and speed both suffer. The chevron `▾` glyph implies a dropdown; the behavior is a cycler.
- **Recommendation:** Make it a real `<select>` (or a popover menu) so users see all repos at once.

### [MINOR] Settings Notifications and Keybindings tabs both exist but BDE_FEATURES.md says "9 tabs" and lists different ones

- **Category:** Polish
- **Location:** `src/renderer/src/views/SettingsView.tsx:35`, `docs/BDE_FEATURES.md` (Settings section)
- **Observation:** The features doc lists Connections, Repositories, Templates, Agent, Agent Manager, Cost, Memory, Appearance, About — 9 tabs. The actual sidebar shows 10 entries: Connections, Permissions, Repositories, Templates, Agent Manager, Cost, Appearance, Notifications, Keybindings, Memory. "Permissions", "Notifications", "Keybindings" are present in code but absent from the features doc. "About" and "Agent" are in the doc but absent from the sidebar.
- **Why it matters:** Internal documentation drift. Either the docs lie to users, or the product accidentally shipped sections it isn't ready to support.
- **Recommendation:** Reconcile `BDE_FEATURES.md` with the actual sidebar contents and make sure every shipping section is listed.

### [MINOR] No way to spawn a copilot/synthesizer agent from the Agents view

- **Category:** Cohesion
- **Location:** `src/renderer/src/components/agents/AgentLaunchpad.tsx:41`
- **Observation:** `BDE_FEATURES.md` lists 5 agent types: pipeline, adhoc, assistant, copilot, synthesizer. The Agents Launchpad only spawns "assistant" mode (`assistant: true` is hardcoded). There is no way for a user to spawn a copilot or synthesizer outside of Task Workbench, and no way to spawn a non-assistant adhoc directly.
- **Why it matters:** The 5-type model implies the user should be able to choose; in practice the Agents view exposes 1.5 modes (assistant + templates that all become assistants). The Workbench is the _only_ place to access the copilot/synthesizer flows.
- **Recommendation:** Either document that Agents view = assistant only (and surface a mode toggle for adhoc-vs-assistant), or expose all five types as launchpad cards.

### [MINOR] Promote-to-Code-Review button only appears post-completion with no preview

- **Category:** UX
- **Location:** `src/renderer/src/components/agents/ConsoleHeader.tsx:90`
- **Observation:** `canPromote` requires `status === 'done' && worktreePath && !sprintTaskId`. A user who realizes mid-run "I want to track this in the sprint pipeline" has no way to do so — they have to wait for the agent to finish, then promote. Equally, the button has no tooltip describing what "promotion" does to the existing worktree (will it move? copy? overwrite a task?).
- **Why it matters:** The decision to track an agent's work happens during the run, not after. Forcing users to wait creates friction and lost work if the agent crashes.
- **Recommendation:** Allow promotion at any time during a run (the button creates a tracking task, attaches the agent, and surfaces it in the pipeline). Add a confirmation modal explaining what happens to the worktree.
