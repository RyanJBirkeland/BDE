# Workspace Domain PM Audit: IDE + Agents + Terminal

**Auditor:** Product Manager lens
**Date:** 2026-03-27
**Scope:** `IDEView.tsx`, `AgentsView.tsx`, `src/renderer/src/components/ide/*`, `src/renderer/src/components/agents/*`, `src/renderer/src/components/terminal/*`

---

## 1. Executive Summary

The Workspace domain delivers a functional IDE with Monaco editor, a capable agent monitoring console with virtual-scrolled event streams, and a real terminal backed by xterm.js with PTY integration. The agent launchpad flow (template grid -> configure -> review -> spawn) is well-structured for ad-hoc agent spawning. However, several critical UX gaps remain: the IDE lacks file search and go-to-file, the agent console provides no way to see what files an agent has actually changed, the terminal font size store is never wired to the xterm instances, and multiple slash commands in the autocomplete menu (`/approve`, `/files`) are advertised but have no implementation behind them. The overall experience is that of a 70% complete developer workspace -- each surface works in isolation but cross-surface integration (e.g., agent finishes -> review its diff -> open PR) is missing.

---

## 2. Critical Issues (Broken Workflows)

### 2.1 Phantom slash commands: `/approve` and `/files` are dead

**Files:** `src/renderer/src/components/agents/CommandAutocomplete.tsx:8-14`, `src/renderer/src/views/AgentsView.tsx:117-148`

The `CommandAutocomplete` component advertises five slash commands: `/stop`, `/retry`, `/focus`, `/approve`, and `/files`. The `handleCommand` callback in `AgentsView.tsx` only implements three (`/stop`, `/retry`, `/focus`). The remaining two silently fall through the default case and do nothing. A user seeing "Approve pending action" and "List files the agent touched" in the autocomplete will expect them to work. This is a trust-breaking UX bug -- showing capabilities that don't exist.

### 2.2 Terminal font size zoom has no effect

**Files:** `src/renderer/src/stores/terminal.ts:149-159`, `src/renderer/src/components/terminal/TerminalPane.tsx`

The terminal store tracks `fontSize` with `zoomIn`/`zoomOut`/`resetZoom` actions, and `IDEView.tsx` wires keyboard shortcuts for them (Cmd+=, Cmd+-, Cmd+0). However, `TerminalPane.tsx` hardcodes `fontSize: 13` at line 43 and never reads `useTerminalStore.fontSize`. The zoom shortcuts trigger state changes that are never consumed by any component. Users pressing Cmd+= will see nothing happen.

### 2.3 "Save as Template" button hidden with `{false && ...}`

**Files:** `src/renderer/src/components/agents/LaunchpadReview.tsx:97`

The "Save as Template" button is rendered inside `{false && (...)}`, making it permanently invisible. The `onSaveTemplate` prop is passed through but the callback only shows a toast "coming soon." This is dead code that clutters the props interface. If the feature is not ready, the prop should be removed entirely rather than leaving a permanently-false conditional in the render tree.

### 2.4 PaneStatusBar CWD is always "~" (hardcoded)

**Files:** `src/renderer/src/components/terminal/PaneStatusBar.tsx:11`

The status bar always displays `~` as the current working directory. The TODO comment at line 13 acknowledges the missing `terminal:getCwd` IPC handler. However, `PaneStatusBar` is not actually rendered anywhere in the current component tree -- `TerminalContent.tsx` and `TerminalPanel.tsx` do not import or use it. This is dead code that was presumably intended to show per-pane status but was never wired in.

### 2.5 "Add Custom" template tile is a no-op

**Files:** `src/renderer/src/components/agents/LaunchpadGrid.tsx:130-133`

The "Add Custom" tile in the template grid has no `onClick` handler. Clicking it does nothing. There is no flow to create a new prompt template. Combined with the hidden "Save as Template" button in LaunchpadReview, the entire custom template creation story is unimplemented.

---

## 3. Significant Issues (Confusing Flows, Missing Feedback)

### 3.1 No file search / go-to-file in IDE

**Files:** `src/renderer/src/views/IDEView.tsx`, `src/renderer/src/components/ide/FileSidebar.tsx`

There is no Cmd+P / quick-open / fuzzy file search. In a large repo, users must manually expand directories in the file tree to find files. This is a baseline IDE feature and its absence makes the IDE impractical for daily use on anything beyond toy projects.

### 3.2 Agent console shows no diff/file summary on completion

**Files:** `src/renderer/src/components/agents/ConsoleLine.tsx:276-317`

The completion card shows duration, cost, and token counts -- but not what the agent actually produced. There is no list of changed files, no diff preview, no link to the resulting PR. After a 30-minute agent run costing $2, the user has to manually go to PR Station or Source Control to find out what happened. The "Open shell in agent directory" button in `ConsoleHeader.tsx:60-61` is the only bridge, requiring manual `git diff` in a terminal.

### 3.3 No confirmation before `/stop` kills a running agent

**Files:** `src/renderer/src/views/AgentsView.tsx:122-127`, `src/renderer/src/components/agents/ConsoleHeader.tsx:64-69`

Both the `/stop` command and the Stop button in ConsoleHeader immediately call `window.api.killAgent()` with no confirmation dialog. Killing a running agent that has been working for 45 minutes is a destructive and irreversible action. Users who accidentally type `/stop` and hit Enter (e.g., mistyping `/status`) will lose work with no recourse.

### 3.4 `window.prompt()` for file/folder creation is jarring

**Files:** `src/renderer/src/components/ide/FileSidebar.tsx:27,37`

Creating new files/folders uses the browser's native `window.prompt()` dialog, which looks out of place in an Electron desktop app with a neon theme. Similarly, `window.confirm()` is used for delete confirmations (line 60). The app already has a `useConfirm` hook and `ConfirmModal` component (used by `UnsavedDialog.tsx`). These should be used instead.

### 3.5 Agent launchpad repo selector is confusing

**Files:** `src/renderer/src/components/agents/LaunchpadGrid.tsx:170-179`

The repo selector is a button that cycles through repos on click. There is no visual indication that it is a cycler, no dropdown to see all options, and the down-arrow symbol is misleading (suggests a dropdown). With 5+ repos configured, users must click repeatedly to cycle to the one they want. The model selector (pill group) is much better designed by comparison.

### 3.6 Empty state for Agents view when agents exist but none selected

**Files:** `src/renderer/src/views/AgentsView.tsx:253-266`

When agents exist but none is selected (e.g., after the selected agent is deleted from the list), the console area shows "> Select an agent to view console." in dim text. This is adequate but provides no guidance about the launchpad or slash commands. It should at minimum mention Cmd+N or the + button to spawn a new agent.

### 3.7 Agent event stream: no search/filter capability

**Files:** `src/renderer/src/components/agents/AgentConsole.tsx`

The agent console has virtualized scrolling and a "Jump to latest" button, but no way to search through events. For a long-running agent with 500+ events, finding a specific tool call or error requires manual scrolling. The terminal has Cmd+F find -- the agent console should have parity.

### 3.8 File tree does not update when files change during editing

**Files:** `src/renderer/src/components/ide/FileTree.tsx:34-37`

The file tree subscribes to `window.api.onDirChanged()` at the root level only. If a user creates a file inside a deeply expanded directory using the terminal, the tree may not reflect the change until the parent directory is collapsed and re-expanded. The `onDirChanged` listener at line 35 reloads only the current `dirPath` entries -- child `FileTreeNode` instances maintain their own state and would need their own refresh.

### 3.9 No visual indicator for running agents in the IDE terminal

**Files:** `src/renderer/src/components/ide/TerminalPanel.tsx`, `src/renderer/src/components/terminal/TerminalTabBar.tsx`

While the terminal supports agent output tabs via the Bot icon picker, there is no proactive notification when an agent starts or finishes. A user working in the IDE has no ambient awareness of agent activity unless they switch to the Agents view. A badge count on the Agents sidebar icon or a toast notification would bridge this gap.

---

## 4. Minor Issues (Polish)

### 4.1 AgentTimeline and TimelineBar are dead code

**Files:** `src/renderer/src/components/agents/AgentTimeline.tsx`, `src/renderer/src/components/agents/TimelineBar.tsx`

Per CLAUDE.md, these are unused (replaced by MiniChart). They remain in the codebase with test files, adding to maintenance burden.

### 4.2 Duplicate `formatDuration` implementations

**Files:** `AgentCard.tsx:26-33`, `ConsoleHeader.tsx:24-39`, `ConsoleLine.tsx:22-29`, `TimelineBar.tsx:36-48`

Four separate `formatDuration` functions with slightly different signatures and formatting. These should be consolidated into a shared utility.

### 4.3 Duplicate `formatFileSize` in PlaygroundCard and PlaygroundModal

**Files:** `PlaygroundCard.tsx:17-21`, `PlaygroundModal.tsx:23-27`

Identical function duplicated across two files.

### 4.4 ChatRenderer and AgentConsole both implement virtual scrolling independently

**Files:** `src/renderer/src/components/agents/ChatRenderer.tsx:163-236`, `src/renderer/src/components/agents/AgentConsole.tsx:23-64`

Both components use `@tanstack/react-virtual` with identical scroll-tracking logic. `AgentConsole` renders `ConsoleLine` blocks while `ChatRenderer` renders bubble-style blocks (used by `AgentDetail` and `AgentOutputTab`). This means there are two rendering modes for the same data. The `AgentDetail` component appears to be a legacy alternative to `AgentConsole` that is no longer used in `AgentsView` but is still imported by nothing at the view level.

### 4.5 Inline styles vs CSS classes inconsistency in Agents components

**Files:** Multiple files in `src/renderer/src/components/agents/`

`AgentCard.tsx`, `AgentDetail.tsx`, `AgentList.tsx`, `SteerInput.tsx`, `ChatBubble.tsx`, and others use extensive inline `style={{}}` with `tokens.*` values. Meanwhile, `ConsoleLine.tsx`, `ConsoleHeader.tsx`, `CommandBar.tsx`, and `AgentConsole.tsx` use CSS classes from `agents-neon.css`. This split makes theming inconsistent -- some components will respond to CSS variable changes, others won't.

### 4.6 The "Open in Browser" button on PlaygroundModal silently fails

**Files:** `src/renderer/src/components/agents/PlaygroundModal.tsx:137-146`

The `data:` URI scheme is likely blocked by the `window:openExternal` handler's allowed-schemes list. The catch block is empty, so the button click produces zero feedback. At minimum it should show a toast explaining the limitation.

### 4.7 Terminal clear shortcut label is wrong

**Files:** `src/renderer/src/components/terminal/TerminalToolbar.tsx:19-21`

The clear button shows `Cmd+K` as the shortcut label, but `IDEView.tsx:269` binds `Ctrl+L` (not Cmd+K) to clear. The actual `Cmd+K` binding is not implemented anywhere in the keyboard handler.

### 4.8 Editor tab bar has no drag-to-reorder

**Files:** `src/renderer/src/components/ide/EditorTabBar.tsx`

Terminal tabs support drag reorder (`onDragStart`, `onDragOver`, `onDrop` in `TerminalTabBar.tsx`), but editor tabs do not. This is a minor inconsistency between the two tab bars.

---

## 5. User Journey Map: Agent Launch -> Monitor -> Completion -> Review

### Step 1: Launch Agent

**Entry points:**

- Agents view (Cmd+2) -> "+" button in Fleet sidebar header -> Launchpad appears
- Agents view -> LiveActivityStrip "Spawn Agent" button when no agents running
- CommandPalette -> "Spawn Agent" action (dispatches `bde:open-spawn-modal` event)

**Launchpad flow (3 phases):**

1. **Grid** (`LaunchpadGrid.tsx`): Template tiles, recent tasks, custom prompt input bar with repo cycler + model pills. Templates load from `promptTemplates` store. "Add Custom" tile is non-functional.
2. **Configure** (`LaunchpadConfigure.tsx`): Chat-style Q&A for template variables. Step counter. Choice buttons or text input. Skipped if template has zero questions.
3. **Review** (`LaunchpadReview.tsx`): Shows assembled prompt, parameter cards (repo, model, answers). "Edit" button allows modifying the generated prompt. "Spawn Agent" button calls `spawnAgent()` IPC. "Save as Template" button is hidden.

**Gaps:**

- No way to specify a branch or worktree for the agent to work in (hardcoded to repo path)
- No cost estimate before spawning
- No way to set `max_runtime_ms` per ad-hoc agent
- Repo path resolution (`repoPaths[repo.toLowerCase()]`) silently fails if the repo name case doesn't match

### Step 2: Monitor Running Agent

**Surfaces:**

- **LiveActivityStrip** (top of AgentsView): Shows running agents as pills with latest action text. Clicking a pill selects the agent.
- **Fleet sidebar** (AgentList): Running group always open with pulse dot. Recent (24h) always open. History collapsed by default. Search filter.
- **AgentConsole**: Virtual-scrolled event stream showing `ConsoleLine` blocks. Auto-scrolls to bottom. "Jump to latest" button appears when scrolled up.
- **ConsoleHeader**: Status dot (animated pulse when running), task name, model badge with accent color, live duration ticker, cost (from completed event), action buttons (terminal, stop, copy log).
- **CommandBar**: Text input with `/` command autocomplete. Steer messages sent via `window.api.steerAgent()`.

**Gaps:**

- No progress indicator (% complete, estimated time remaining)
- No way to see token consumption in real time (only shown in completion card)
- No way to pause an agent (only kill)
- Tool call details require expanding each block individually; no "expand all" option
- Stderr events use the same `[stderr]` prefix styling as rate limit events, which is confusing
- No notification when agent completes if user is in another view

### Step 3: Agent Completes

**What happens:**

- `agent:completed` event arrives, rendered as `console-completion-card` with duration, cost, tokens in/out
- Agent card in fleet sidebar moves from "Running" to "Recent" group
- Pill disappears from LiveActivityStrip
- CommandBar becomes disabled with "Agent not running" placeholder

**Gaps:**

- No summary of what changed (files modified, lines added/removed)
- No link to the PR if one was created
- No "View diff" button
- No "Retry" button on the completion card itself (must use `/retry` command, which requires the agent to still be selected)
- `/retry` only works if `agent.sprintTaskId` exists; ad-hoc agents spawned from launchpad have no sprint task, so `/retry` silently does nothing for them

### Step 4: Review Agent Output

**Available actions:**

- **Copy log**: ConsoleHeader button copies raw log file to clipboard
- **Open shell in agent directory**: Opens terminal tab at `agent.repoPath`
- **Scroll through events**: All tool calls, thinking blocks, text outputs visible
- **PlaygroundCard/Modal**: If agent wrote HTML files, inline preview cards appear with split view (preview + source)

**Gaps:**

- No way to navigate from agent console to PR Station for the agent's PR
- No way to see the git diff of what the agent changed without opening a terminal
- No way to export the agent's conversation/event history (only raw log copy)
- Completed agents cannot be re-steered or asked follow-up questions
- No way to compare two agent runs side by side

---

## Summary Priority Matrix

| Priority    | Count | Examples                                                    |
| ----------- | ----- | ----------------------------------------------------------- |
| Critical    | 5     | Phantom commands, dead zoom, no-op buttons                  |
| Significant | 9     | No file search, no diff on completion, no kill confirmation |
| Minor       | 8     | Dead code, duplicate utils, style inconsistency             |

**Top 3 recommendations for next sprint:**

1. Remove or implement `/approve` and `/files` commands -- user trust issue
2. Add changed-files summary + PR link to agent completion card -- closes the monitoring -> review gap
3. Wire terminal fontSize from store to xterm instances -- broken keyboard shortcuts undermine confidence
