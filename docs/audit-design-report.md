# BDE Design & Product Audit

**Date:** 2026-03-16
**Auditor:** Senior Product Designer & UX Architect
**Scope:** Full UI/UX review of BDE (Birkeland Development Environment) — an Electron-based AI coding IDE for developers who build with Claude Code agents.

---

## 1. Product Vision Alignment

### Who is the user?

Ryan is a solo developer / technical founder managing multiple codebases (BDE, Feast, Life-OS) with AI coding agents. He is both the user and the builder. The user persona is: **a power user who orchestrates AI agents like a flight director — creating specs, dispatching agents to repos, monitoring progress, reviewing output, and merging PRs.** This is not a general-purpose IDE. It's a command center for someone who treats AI agents as junior engineers on a sprint team.

### Does the current UI help them accomplish it?

Partially. BDE has the right _pieces_ — sessions, terminal, sprint board, git client, cost tracking — but they exist as isolated views with weak connective tissue between them. The core workflow loop (spec → agent → monitor → review → merge) requires bouncing between 4-5 views with no persistent context. The user must mentally track which agent is working on which ticket, which PR belongs to which sprint task, and what it all costs.

### Top 3 Jobs-to-Be-Done

| Job                                                     | How well served                                                                                                                                           | Gap                                                                                                                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Create a spec, dispatch an agent, and monitor it** | 60% — Sprint Center handles creation and launch, but monitoring requires switching to Sessions. No way to see agent progress from the sprint card itself. | Sprint cards need inline status (last message, % done, error state). Need a "jump to session" link and vice versa.                                                              |
| **2. Review agent output, inspect diffs, and merge**    | 40% — DiffView is solid for staging/committing, but there's no PR review workflow. Agent output in Sessions is a raw chat transcript with no structure.   | Need: structured agent output (files changed, tests passed/failed, PR link). DiffView should link to sprint tasks. PR review should be a first-class flow, not an afterthought. |
| **3. Understand cost, capacity, and throughput**        | 30% — CostView shows spend but not ROI. No way to see "this ticket cost $X to complete." No throughput metrics (tickets/day, avg completion time).        | Cost needs to be tied to sprint tasks. Throughput dashboard is missing entirely.                                                                                                |

---

## 2. Information Architecture

### Are the 7 views the right top-level structure?

The 7 views (Sessions, Terminal, Sprint, Diff, Memory, Cost, Settings) are _functional categories_, not _workflow steps_. This is fine for a tool-centric power user, but it creates constant view-switching during the core loop. The current structure is:

```
Sessions  Terminal  Sprint  Diff  Memory  Cost  Settings
```

**Verdict:** The top-level tabs are mostly right, but the naming and ordering could be improved:

| Current      | Issue                                                                           | Suggested                  |
| ------------ | ------------------------------------------------------------------------------- | -------------------------- |
| Sessions     | Good name, but "Agents" is used in the sidebar title — inconsistency            | **Agents** (match sidebar) |
| Terminal     | Fine                                                                            | Terminal                   |
| Sprint / PRs | Activity bar says "Sprint / PRs" but view title says "SPRINT CENTER" — pick one | **Sprint**                 |
| Diff         | Too generic — this is a full git client                                         | **Git**                    |
| Memory       | Fine but niche — most users rarely touch this                                   | Memory                     |
| Cost         | Fine                                                                            | Cost                       |
| Settings     | Fine, should always be last                                                     | Settings                   |

### Navigation

- **Activity bar is clear.** Icon + label + shortcut tooltip. The vertical left rail is industry-standard (VS Code, Linear, Figma). Good.
- **Cmd+1-7 shortcuts are excellent.** Power users will memorize these fast.
- **Command palette exists** (Cmd+P). Good — this is expected in dev tools.
- **What's confusing:** There's no breadcrumb or context indicator. When you're in the Sprint view looking at a task, there's no way to tell where you "came from" or navigate back. The spec drawer is a slide-over panel with no URL or history, so browser-style back/forward doesn't apply.

### What's missing entirely

1. **Notifications / Activity Feed** — When an agent finishes, errors out, or opens a PR, there's no persistent notification center. Toast notifications are ephemeral. A developer who steps away for 30 minutes has no way to see what happened without checking each view manually.
2. **Dashboard / Home view** — No landing page that answers "what's happening right now?" at a glance. The user lands on Sessions by default, which only shows agent chat threads, not the overall state of the sprint.
3. **Search** — No global search across sessions, sprint tasks, memory files, or git. The command palette exists but appears limited.

---

## 3. View-by-View UX Assessment

### Sessions View

**What works:**

- Split modes (single, 2-pane, grid-4) are a power feature that feels genuinely useful for monitoring multiple agents. The keyboard shortcuts (Cmd+Shift+1/2/4) are intuitive.
- Unified agent list (gateway sessions + local agents + history) is smart — one list for everything.
- Resizable sidebar with drag handle.
- Optimistic message updates with rollback on error — good latency masking.

**What's confusing:**

- The sidebar title says "AGENTS" but the view is called "Sessions" in the activity bar. Pick one.
- `selectedUnifiedId` uses prefixes like `local:`, `history:` — this is an implementation detail leaking into the data model. If the user sees agent IDs anywhere, these prefixes would be nonsensical.
- The "Spawn Agent" button (+ icon) doesn't indicate _what_ it does until you click it. "Spawn" is jargon — "New Agent" or "Start Agent" would be clearer.

**What's broken:**

- When a history agent is selected, the split mode toolbar is still visible but doesn't apply. The `renderMainContent` function short-circuits to show `AgentLogViewer` regardless of split mode, but the split buttons remain clickable. This is misleading.
- No visual indicator of which pane is focused in split modes. Users can set focus with Cmd+Opt+Arrow, but there's no border/highlight showing the current pane.

**What should change:**

- Add a "jump to sprint task" link from the session header when the agent was launched from a sprint task (the `agent_session_id` link exists in data but not in UI).
- The empty state "Select a session" should be replaced with a more useful zero-state — recent sessions, quick-launch buttons, or the sprint summary.

### Sprint View

**What works:**

- 4-column Kanban (Backlog → Sprint → In Progress → Done) is a clean, correct model.
- "Push to Sprint" as an explicit action separating drafting from queuing — this is the key insight of v2 and it's well-executed.
- Repo filter chips in the header let you focus on one project.
- Spec drawer with inline editing and "Ask Paul" AI generation — genuinely differentiating.
- Optimistic updates on task mutations with rollback.
- Drag-and-drop between columns via @dnd-kit.

**What's confusing:**

- The "Launch" button on queued tasks manually dispatches an agent, but the spec says a task runner auto-picks up `queued` tasks. So does "Launch" bypass the queue? Or is it redundant? The user doesn't know whether to click Launch or wait.
- SpecDrawer footer has buttons in a confusing order: "→ Push to Sprint", "Ask Paul", "Launch Agent" — three CTAs in one footer, none obviously primary. The hierarchy is: `primary, ghost, primary`. Two primary buttons in one toolbar is a violation of the design system's own principles.
- Task priority is exposed as a number (0/1/2) in the data model but as labels (High/Medium/Low) in the modal. There's no priority indicator on the task card itself.

**What's broken:**

- PRSection is rendered below the kanban board but there's no data about what it shows — it's a separate component with no visible integration with the sprint tasks.
- The `renderMarkdown` function in SpecDrawer is a naive regex implementation that doesn't handle nested lists, code blocks, or links. Using `dangerouslySetInnerHTML` with user-edited markdown is an XSS vector if spec content is ever shared or imported.

**What should change:**

- Add priority indicator (color dot or P0/P1/P2 badge) to TaskCard.
- Add elapsed time or "started 5m ago" on active tasks.
- Add a "Pull back to Backlog" action on queued tasks (currently only available via drag).
- Use a proper markdown renderer (e.g., `marked` + `DOMPurify`) instead of regex replacement.

### Terminal View

**What works:**

- Multi-tab terminals with shell picker (zsh, bash, fish, etc.) — good parity with VS Code / Warp.
- Agent output tabs with purple accent differentiation — smart visual separation.
- Split pane support (Cmd+Shift+D).
- Find bar for shell tabs.
- All terminal tabs stay mounted when switching away — PTY state survives navigation.

**What's confusing:**

- Inline styles everywhere. The entire TerminalView uses `style={{...}}` objects instead of CSS classes. This is inconsistent with every other view in the app, which uses CSS class names. It also means the design system's glass/gradient tokens aren't applied here — the terminal looks visually different from the rest of BDE.
- The tab bar uses `tokens.color.*` from a JS design-system/tokens file, while the rest of the app uses CSS custom properties. Two styling systems running in parallel.

**What should change:**

- Migrate TerminalView from inline styles to CSS classes + custom properties. This is the only view that doesn't use the glass morphism system, and it shows.
- Add a "rename tab" action (double-click on tab name).
- Add an indicator of which agent a tab belongs to (right now it's just an emoji + title, no link back to the sprint task).

---

## 4. Visual Design & Consistency

### Glass/Gradient Design System — Is it applied consistently?

**No.** The visual identity spec describes a sophisticated 4-level glass morphism system, but it's unevenly implemented:

| Component            | Glass applied? | Notes                                                                                       |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| NewTicketModal       | Yes            | Uses `glass-modal elevation-3` correctly                                                    |
| ShortcutsOverlay     | Yes            | Uses `glass-modal` with spring animations                                                   |
| SessionsView sidebar | Partially      | Has CSS classes but unclear if backdrop-filter is active                                    |
| Sprint columns       | Partially      | Spec calls for glass panels with column-specific gradients; implementation uses CSS classes |
| TerminalView         | **No**         | Entirely inline styles using `tokens.*` JS objects. No glass, no gradients.                 |
| DiffView             | **No**         | Uses basic `--bde-surface` backgrounds, no glass treatment                                  |
| CostView             | Partially      | Uses Card components but no glass elevation                                                 |
| MemoryView           | **No**         | Basic sidebar + editor layout with flat backgrounds                                         |
| SettingsView         | **No**         | Simple form layout, no glass or elevation                                                   |

**Verdict:** Glass morphism is a "hero" treatment on modals and the sprint board, but the majority of the app is still on the old flat `--bde-*` color system. The CSS has **two parallel variable systems** — the original `--bde-bg`, `--bde-surface`, `--bde-text-*` and the new `--bg-void`, `--bg-base`, `--text-primary`, etc. Neither has been fully adopted or deprecated. This creates visual inconsistency and maintenance burden.

### Typography hierarchy

- The type scale is well-defined in both the spec and CSS (14 size tokens, 4 tracking values, 3 font stacks).
- In practice, most views use `bde-section-title` for headings and system defaults for body. The spec's `heading-section`, `heading-page`, and `heading-hero` classes are defined but appear underused outside the sprint and shortcuts components.
- The `text-gradient-aurora` class is used for "SPRINT CENTER" and "NEW TICKET" titles, creating a nice premium feel — but it's not used consistently across other view titles ("Cost Tracker", "Settings", "Memory" use plain text).

### Color usage — signal vs decoration

- **Good:** Semantic colors are well-chosen. Green = running/success, purple = AI/agent, amber = warning/cost, red = error. These map naturally to the user's mental model.
- **Problem:** The accent green (#00D37F) is used for too many things — running status, success states, accent borders, primary buttons, gradient backgrounds, AND the brand identity. When everything is green, nothing is green. Active agent sessions and the "Save" button should not look the same.
- **Problem:** The repo color system (BDE = blue, Feast = amber, Life-OS = green) conflicts with the semantic color system. A Life-OS badge is green like a success state. A Feast badge is amber like a warning. This creates false signal.

### Motion/Animation

- The spec defines 5 spring presets and 7 animation variants — but they're only used in the shortcuts overlay and (referenced in) session cards.
- Most of the app uses CSS transitions (`--bde-transition-fast: 100ms ease`) or no animation at all.
- The `view-enter` class on the ViewRouter wraps views in a div but doesn't apply any entrance animation. Switching views is an instant cut, not a crossfade.
- **Verdict:** Motion is aspirational in the spec, minimal in implementation. The app feels static.

---

## 5. Sprint Center Deep Dive

### Is the Backlog → Sprint → Active → Done flow intuitive?

**Mostly yes.** The 4-column model is a well-understood pattern (Jira, Linear, Trello). The key innovation — separating "backlog" (draft) from "sprint" (queued for agent pickup) — correctly models the "think before you send" workflow that matters with AI agents.

**However:**

- The column headers don't explain their purpose. "Backlog" could mean "stuff I haven't gotten to" or "draft ideas." "Sprint" could mean "current sprint" or "ready to execute." A subtitle or tooltip on each column header would help: "Draft ideas — not sent to agents" / "Ready — agents will pick these up."
- There's no visual cue that moving a card from Backlog → Sprint is a meaningful action (it triggers agent pickup). The drag-and-drop is smooth but the _consequence_ is invisible. A confirmation dialog or animation emphasizing the transition would help.

### Ticket creation — friction points

1. **Title is the only required field.** You can create a ticket with just a title and no spec, which means the agent gets dispatched with no instructions. This should either be blocked (require spec for sprint) or warned.
2. **Template selection resets the spec textarea.** If you type some notes, then click a template, your notes are replaced. This should either merge or confirm before overwriting.
3. **"Ask Paul" has no loading indicator in the button itself** — the spec textarea switches to "Paul is writing your spec..." but if the user isn't looking at the textarea, there's no feedback on the button. The button text does change to "Generating..." which helps, but the lack of a spinner feels incomplete.
4. **Enter submits the form from the title field** (line 156-159 in NewTicketModal). This means a user who presses Enter thinking they're adding a newline will accidentally create a half-finished ticket. This should only submit on Cmd+Enter or via the Save button.
5. **Priority defaults to Medium (1) with no way to set it from keyboard.** Tab order goes: title → repo select → priority select → template buttons (not focusable via Tab) → spec textarea. The template buttons are `<button>` elements that participate in tab order, which is correct, but the flow is dense.

### How well does it serve the "spec → agent → review → merge" workflow?

| Step               | Support                                                 | Gap                                                                                 |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Spec**           | Good — template picker + AI generation + manual editing | No spec preview (rendered markdown) during creation. Only raw markdown in textarea. |
| **Agent dispatch** | Good — "Push to Sprint" is explicit and intentional     | No estimated duration. No selection of which agent/model to use.                    |
| **Monitor**        | Weak — requires switching to Sessions view              | Need inline progress indicator on active sprint cards.                              |
| **Review**         | Weak — DiffView is disconnected from Sprint             | No "review this PR" flow that links sprint task → PR → diff → approval.             |
| **Merge**          | Missing — no merge action in BDE                        | User must go to GitHub to merge. BDE should have a "merge PR" button on done tasks. |

---

## 6. Top 10 UX Issues (Ranked by User Impact)

| #   | View / Component         | Issue                                                                                                                                                                                                                      | Impact (1-5) | Suggested Fix                                                                                                                                                                                                              |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Global**               | Two parallel CSS variable systems (`--bde-*` and `--bg-*`/`--accent-*`) causing visual inconsistency across views. Some views look premium (Sprint, modals), others look like a prototype (Terminal, Memory, Settings).    |      5       | Consolidate to one variable system. Deprecate `--bde-*` tokens, replace all references with the visual-identity-spec v2 tokens. One migration pass.                                                                        |
| 2   | **Sprint → Sessions**    | No bidirectional link between a sprint task and its running agent session. "View Output" dispatches a custom event but there's no "back to sprint task" from the session.                                                  |      5       | Add `sprintTaskId` to session metadata. Show a "Sprint Task: [title]" badge in SessionHeader. Add a "Back to Sprint" button.                                                                                               |
| 3   | **Sprint / TaskCard**    | Active tasks show no progress information. The card says "In Progress" with an agent status chip, but no indication of what the agent is doing, how long it's been running, or if it's stuck.                              |      4       | Add: last agent message preview (truncated), elapsed time, and error state indicator on active TaskCards. Poll or subscribe to agent session updates.                                                                      |
| 4   | **Global**               | No notification center or activity feed. Finished agents, opened PRs, and errors are only visible as ephemeral toasts. If the user is in another view or AFK, they miss everything.                                        |      4       | Add a notification bell/counter in the TitleBar. Clicking it opens a slide-out panel with recent events (agent completed, PR opened, error, etc.) with timestamps. Persist notifications across views.                     |
| 5   | **TerminalView**         | Entirely built with inline styles and JS token objects, bypassing the CSS design system. Looks visually disconnected from the rest of BDE. No glass morphism, no gradients, different color values.                        |      4       | Refactor TerminalView to use CSS classes from the design system. Apply glass treatment to the tab bar. Use `--bg-*` and `--border` variables.                                                                              |
| 6   | **NewTicketModal**       | Pressing Enter in the title field submits the form. Accidental submissions of half-complete tickets.                                                                                                                       |      3       | Only submit on Cmd+Enter or via the "Save to Backlog" button click. Remove the Enter-to-submit shortcut from the title input, or require spec content before allowing submission.                                          |
| 7   | **SpecDrawer**           | `dangerouslySetInnerHTML` with a naive regex markdown renderer. XSS risk if spec content is ever imported from external sources. Also doesn't handle code blocks, tables, or links.                                        |      3       | Replace `renderMarkdown` regex with a proper library (`marked` + `DOMPurify`, or `react-markdown`). This also improves spec readability with proper code highlighting.                                                     |
| 8   | **Sprint / KanbanBoard** | No visual/haptic feedback when dragging a card from Backlog → Sprint to indicate this is a consequential action (triggers agent queue). Dropping to Sprint looks identical to reordering within a column.                  |      3       | Add a column highlight/glow effect when a card is dragged over the Sprint column. Show a brief confirmation toast: "Task queued — agents will pick this up." Consider a "confirm push?" micro-dialog for first-time users. |
| 9   | **DiffView**             | No connection to sprint tasks or agent sessions. It's a standalone git client that doesn't know about BDE's workflow. Files changed by an agent aren't highlighted or grouped.                                             |      3       | When a sprint task has an active agent, show a "Changes from [task title]" section in DiffView. Auto-select the relevant repo. Link staged changes back to the sprint task.                                                |
| 10  | **CostView**             | Cost is per-session but not per-task. No way to answer "how much did this sprint ticket cost?" Token breakdown uses `contextTokens` as a proxy for input tokens (acknowledged as incorrect in a TODO comment on line 349). |      2       | Add `sprint_task_id` to session data. Aggregate cost per task in the CostView. Fix the token accounting upstream (gateway should expose input/output separately).                                                          |

---

## 7. Feature Gaps

Ranked by impact on the core workflow (spec → agent → review → merge):

1. **Activity Feed / Notification Center** — A persistent, scrollable list of events (agent started, agent finished, PR opened, error, task moved). Shows timestamps and links to the relevant view. Without this, BDE is a "pull" interface when it should be "push" — the user shouldn't have to check each view to know what happened.

2. **Dashboard / Home View** — A single-screen summary: active agents (with progress), recent completions, open PRs awaiting review, today's cost, sprint progress (n/m tasks done). This replaces the current behavior of landing on the Sessions view and having to assemble the picture mentally.

3. **PR Review Flow** — When an agent opens a PR, BDE should surface it as a reviewable artifact: show the diff (inline, not in a separate view), run status, and a "Merge" button. The current DiffView is a git staging tool, not a review tool. These are different jobs.

4. **Agent-to-Task Bidirectional Linking** — Every agent session should know which sprint task spawned it, and every sprint task should show its agent's current state. This is the single most important "connective tissue" missing from BDE.

5. **Per-Task Cost Attribution** — Tie cost tracking to sprint tasks. Show on each task card: "$0.47 spent, 12K tokens." Aggregate in the CostView: cost per task, cost per repo, cost per day by task type.

6. **Structured Agent Output** — The agent's chat transcript is useful for debugging but terrible for review. Extract and surface: files changed, tests run (pass/fail), PR URL, errors encountered, and a one-line summary. Show this on the sprint card and in a dedicated "Agent Report" panel.

7. **Inline Spec Preview** — The NewTicketModal and SpecDrawer show raw markdown. Add a rendered preview pane (split or toggle) so the user can see what the agent will actually read, with proper formatting.

8. **Agent Model/Config Selection** — When launching an agent, the user can't choose the model (Opus vs Sonnet vs Haiku), set a token budget, or configure agent behavior. These defaults are hardcoded. Adding a "Launch Config" dropdown (even a simple one: model + max tokens) gives the user cost control.

9. **Sprint Metrics** — Throughput dashboard: tasks completed per day, average time from backlog to done, cost per task trend, agent success rate (% of tasks that produce a mergeable PR). This turns BDE from a task manager into a _performance tool_.

10. **Global Search** — Search across sprint tasks (title, spec content), agent sessions (messages), memory files, and git (file names, commit messages). Power users expect Cmd+K / Cmd+P to search everything.

---

## 8. Design Epic Candidates

### Epic 1: Unified Workflow Ribbon

**Goal:** Eliminate view-switching during the core loop by connecting sprint tasks, agent sessions, diffs, and PRs into a single navigable thread.

**Stories:**

1. Add `sprintTaskId` to agent session metadata; show task title badge in SessionHeader with "Back to Sprint" link.
2. Add "Jump to Session" button on active/done TaskCards that navigates to the agent's session with the task context preserved.
3. When a sprint task has a PR, show a "Review PR" action that opens a slide-over with the diff and merge button — without leaving the Sprint view.
4. Add a "Task Timeline" component on the SpecDrawer showing: created → pushed to sprint → agent started → PR opened → merged, with timestamps.

### Epic 2: Activity Feed & Dashboard

**Goal:** Give the user a single place to see what's happening and what happened, reducing the need to poll individual views.

**Stories:**

1. Build a `NotificationStore` that captures events (agent started/finished/errored, PR opened/merged, task status changes) and persists them in memory.
2. Add a notification bell in the TitleBar with unread count badge. Clicking opens a slide-out activity feed.
3. Build a "Home" view (Cmd+0 or replace the current default landing) showing: active agents, recent completions, open PRs, sprint progress bar, today's cost.
4. Add desktop notifications (Electron `Notification` API) for high-priority events: agent error, PR merged, task completed.

### Epic 3: Design System Consolidation

**Goal:** Make the entire app look like it was designed by the same person in the same week.

**Stories:**

1. Deprecate all `--bde-*` CSS variables. Create a migration map from old tokens to new tokens. Find-and-replace across all CSS files.
2. Refactor TerminalView from inline styles to CSS classes using the design system. Apply glass treatment to the tab bar and toolbar.
3. Apply glass elevation to DiffView (sidebar), MemoryView (sidebar + editor), and SettingsView (section cards). Use `elevation-1` for sidebars, `elevation-2` for active panels.
4. Apply `text-gradient-aurora` to all view titles for consistency. Add the gradient underline used in Sprint Center to all view headers.

### Epic 4: Sprint Cards 2.0

**Goal:** Make the Kanban board a real-time operations dashboard, not just a task list.

**Stories:**

1. Add inline agent progress to active TaskCards: last message preview (truncated), elapsed time, animated pulse indicator.
2. Add priority indicator (P0/P1/P2 badge or colored dot) and estimated effort to all TaskCards.
3. Add per-task cost display on done TaskCards: "$0.47 · 12K tokens · 3m 22s."
4. Add micro-interactions: column glow when a card is dragged over it, celebratory animation when a task moves to Done, error shake when an agent fails.

### Epic 5: PR Review Flow

**Goal:** Close the loop from "agent opened a PR" to "developer merges it" without leaving BDE.

**Stories:**

1. Build a `PRReviewPanel` component that shows: diff (using existing DiffViewer), CI status, PR description, and merge/close buttons via GitHub API.
2. In Sprint Center, done tasks with PRs show a "Review" button that opens the PRReviewPanel as a slide-over.
3. Add a "PRs" tab or section to the Dashboard showing all open PRs across repos with status, age, and quick-action buttons.
4. Add keyboard shortcuts for PR review: `n`/`p` for next/prev file, `a` to approve, `m` to merge.

### Epic 6: Agent Intelligence Layer

**Goal:** Transform raw agent chat transcripts into structured, actionable output.

**Stories:**

1. Build an `AgentReport` parser that extracts from session transcripts: files changed, test results, errors, PR URL, and a summary.
2. Show the structured report on the TaskCard (collapsed) and in the SpecDrawer (expanded) for completed tasks.
3. Add model/token-budget selection to the Launch flow — dropdown on the "Launch Agent" button or in the SpecDrawer.
4. Add an "Agent Cost" breakdown per task: model used, input/output tokens, total cost, duration.
