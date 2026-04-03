# Neon Agents View Redesign — Design Spec

**Date**: 2026-03-25
**Status**: Approved
**Scope**: Full rethink of the Agents view — stacked zones layout, terminal console, command bar, timeline

## Overview

Transform the Agents view from a basic two-panel list+detail into a neon cyberpunk command center with three stacked zones: a live activity strip showing running agents in real-time, a fleet list + terminal console for agent interaction, and a Gantt-style timeline waterfall. The detail pane becomes a terminal-aesthetic console with colored event prefixes. Steering is upgraded to a command bar with slash-command autocomplete.

## Design Decisions

| Decision    | Choice                        | Rationale                                                        |
| ----------- | ----------------------------- | ---------------------------------------------------------------- |
| Layout      | Stacked Zones (option A)      | Maximum information density, all three views always visible      |
| Detail pane | Terminal/console aesthetic    | Feels like watching a live session, monospace + colored prefixes |
| Steering    | Command bar with autocomplete | Power-user experience, quick actions via slash commands          |
| Data layer  | No new stores                 | Existing stores cover all data needs — UI-only redesign          |

## Section 1: Stacked Zones Layout

Three horizontal zones stacked vertically:

```
┌─────────────────────────────────────────────────────────┐
│ ⚡ LIVE ACTIVITY STRIP (~60px)                           │
│ [● fix-auth: Edit file] [● add-tests: Running] [● ref.] │
├────────────┬────────────────────────────────────────────┤
│  FLEET     │  AGENT CONSOLE                     (flex:1)│
│  (~220px)  │  ┌─ header: status + actions ────────────┐ │
│  ┌──────┐  │  │ [agent] Updating session handler...   │ │
│  │● fix  │  │  │ [tool]  Edit src/auth/middleware.ts   │ │
│  │● add  │  │  │ [think] Analyzing token flow... 847t  │ │
│  │  deps │  │  │ [agent] Fixed the validation...       │ │
│  │  login│  │  ├───────────────────────────────────────┤ │
│  └──────┘  │  │ > /focus error handling ▸              │ │
│            │  └───────────────────────────────────────┘ │
├────────────┴────────────────────────────────────────────┤
│ TIMELINE (~70px) ══█████░░░████░░░░██████░░████████░░░  │
└─────────────────────────────────────────────────────────┘
```

### Live Activity Strip (~60px, top)

- Fixed height, always visible
- Running agents rendered as glowing neon pills
- Each pill: pulsing status dot + task name (truncated) + current action (last tool call or text snippet)
- Each pill gets a unique neon accent color (cycling through cyan, pink, blue, orange, purple)
- Click pill → selects agent in fleet list + loads console
- When no agents running: dim "No agents active" text with spawn button
- HealthBar info (running count, slot status) merged into this strip — HealthBar component removed

### Fleet + Console (flex: 1, middle)

Two-pane horizontal split:

**Fleet list (~220px, left):**

- Agents grouped: Running → Recent (last 24h) → History (older)
- Each card: `NeonCard` with status dot (glow for running), task name, model badge, duration, cost
- Running cards get accent-tinted borders matching their pill color
- Search/filter input at top
- Click card → loads in console
- "+" spawn button in header

**Agent Console (flex: 1, right):**

- See Section 2 for full detail

### Timeline Strip (~70px, bottom)

- Fixed height, always visible
- Horizontal Gantt waterfall showing agent runs over time
- Each bar colored by status: cyan=running, green=done, red=failed, orange=cancelled
- Bar height indicates agent type (taller for opus, shorter for haiku/sonnet)
- Time axis: last 6 hours by default
- Horizontal scroll for panning, mouse wheel for zoom
- Hover bar → tooltip with agent name, duration, cost, status
- Click bar → selects agent in fleet + console

## Section 2: Agent Console — Terminal Aesthetic

The right pane of the middle zone. Replaces current AgentDetail.

### Console Header (32px)

- Status dot (pulsing animation for running) + task name (bold)
- Model badge (`NeonBadge` with accent color)
- Duration ticker (live for running, final for completed)
- Cost display (when available)
- Action buttons (right side):
  - Terminal icon → open shell at agent's repo path
  - Stop icon → kill agent (running only)
  - Copy icon → copy log to clipboard
  - Expand icon → full-screen console mode
- Glass background with accent-tinted border-bottom

### Console Body (flex: 1)

- Dark glass background: `rgba(10, 0, 21, 0.8)` with optional subtle scanline texture
- Monospace font for all content (`var(--bde-font-code)`)
- Events rendered as terminal lines with colored prefixes:

| Prefix    | Color       | Content                                                                                 |
| --------- | ----------- | --------------------------------------------------------------------------------------- |
| `[agent]` | Neon Cyan   | Agent text output — primary chat messages                                               |
| `[user]`  | Neon Pink   | User steering messages                                                                  |
| `[tool]`  | Neon Blue   | Tool calls — tool name + summary inline. Collapsible: expand for full JSON input/output |
| `[think]` | Neon Purple | Thinking blocks — collapsible, token count badge inline                                 |
| `[error]` | Neon Red    | Error messages with subtle glow                                                         |
| `[rate]`  | Neon Orange | Rate limit warnings with retry countdown                                                |
| `[done]`  | Neon Cyan   | Completion summary: exit code, cost, tokens, duration                                   |
| `[play]`  | Neon Cyan   | Playground cards — inline clickable preview                                             |

- Timestamps in dim monospace on the right margin of each line
- Collapsible lines: click prefix or chevron to expand/collapse tool I/O, thinking text
- Virtual scrolling via `@tanstack/react-virtual` (preserved from current ChatRenderer)
- Auto-scroll to bottom when user is at bottom (100px threshold)
- "Jump to latest" floating button when scrolled up

### Command Bar (44px, bottom)

- Glass panel with neon purple border-top
- Purple `>` prompt character (monospace)
- Input field: monospace, placeholder "Steer agent or type / for commands"
- Autocomplete popup (glass popover, appears when typing `/`):

| Command          | Description                                                |
| ---------------- | ---------------------------------------------------------- |
| `/stop`          | Kill the running agent                                     |
| `/retry`         | Requeue the sprint task                                    |
| `/focus <topic>` | Steer agent to focus on a topic                            |
| `/approve`       | Approve a pending action                                   |
| `/files`         | List files the agent has touched (parsed from tool events) |

- Free text (no `/` prefix) sends as steering message
- Send on Enter, Shift+Enter for newline
- `/` triggers autocomplete popup, arrow keys navigate, Enter selects
- Disabled state: "Agent not running" placeholder when agent is done/failed

## Section 3: Component Architecture

### New Components

| Component             | File                                                         | Responsibility                                                             |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `LiveActivityStrip`   | `src/renderer/src/components/agents/LiveActivityStrip.tsx`   | Top strip — running agent pills with current action                        |
| `AgentPill`           | `src/renderer/src/components/agents/AgentPill.tsx`           | Single running agent pill (dot + name + action text)                       |
| `AgentConsole`        | `src/renderer/src/components/agents/AgentConsole.tsx`        | Terminal-style event viewer replacing AgentDetail                          |
| `ConsoleHeader`       | `src/renderer/src/components/agents/ConsoleHeader.tsx`       | Console header bar with status, actions, metadata                          |
| `ConsoleLine`         | `src/renderer/src/components/agents/ConsoleLine.tsx`         | Single console event line — colored prefix, collapsible content, timestamp |
| `CommandBar`          | `src/renderer/src/components/agents/CommandBar.tsx`          | Bottom command input with `>` prompt                                       |
| `CommandAutocomplete` | `src/renderer/src/components/agents/CommandAutocomplete.tsx` | Autocomplete popup for slash commands                                      |
| `AgentTimeline`       | `src/renderer/src/components/agents/AgentTimeline.tsx`       | Bottom Gantt-style timeline strip                                          |
| `TimelineBar`         | `src/renderer/src/components/agents/TimelineBar.tsx`         | Single agent bar in the timeline                                           |

### Modified Files

| File                  | Change                                                                |
| --------------------- | --------------------------------------------------------------------- |
| `AgentsView.tsx`      | Rewrite — three stacked zones layout                                  |
| `AgentList.tsx`       | Neon treatment — NeonCard cards, glass background, neon status colors |
| `AgentCard.tsx`       | Neon treatment — glass card, neon glow dots, accent borders           |
| `SpawnModal.tsx`      | Neon treatment — glass modal, neon chips, purple textarea             |
| `PlaygroundCard.tsx`  | Neon treatment — glass card with accent                               |
| `PlaygroundModal.tsx` | Neon treatment — glass overlay                                        |

### Removed/Replaced Components

| Component           | Replacement                                       |
| ------------------- | ------------------------------------------------- |
| `AgentDetail.tsx`   | `AgentConsole` (terminal aesthetic)               |
| `ChatRenderer.tsx`  | `ConsoleLine` rendering inside `AgentConsole`     |
| `ChatBubble.tsx`    | `ConsoleLine` with `[agent]`/`[user]` prefix      |
| `ThinkingBlock.tsx` | `ConsoleLine` with `[think]` prefix + collapsible |
| `ToolCallBlock.tsx` | `ConsoleLine` with `[tool]` prefix + collapsible  |
| `SteerInput.tsx`    | `CommandBar` with autocomplete                    |
| `HealthBar.tsx`     | Info merged into `LiveActivityStrip`              |

### New CSS File

`src/renderer/src/assets/agents-neon.css` — agent-specific neon styles:

- `.live-strip`, `.agent-pill` (glowing pills, pulse animation)
- `.agent-console`, `.console-line`, `.console-prefix--*` (terminal lines, colored prefixes)
- `.command-bar`, `.command-autocomplete` (command input, popup)
- `.agent-timeline`, `.timeline-bar` (Gantt bars, hover states)

### Reused Neon Primitives

- `NeonCard` — fleet list cards
- `NeonBadge` — status badges, model badges in console header
- `GlassPanel` — console body, command autocomplete popup
- `NeonProgress` — progress indicators in agent pills
- `neonVar()` — all accent colors throughout

## Section 4: Data Flow & State

### No New Stores

Existing stores cover all data requirements:

| Store                  | Usage                              |
| ---------------------- | ---------------------------------- |
| `useAgentHistoryStore` | Agent list, selection, log polling |
| `useAgentEventsStore`  | Real-time event stream for console |
| `useUIStore`           | View routing                       |

### Live Activity Strip

- Filters agents where `status === 'running'` from `useAgentHistoryStore`
- For each running agent, reads latest event from `useAgentEventsStore` to show current action
- Accent color assignment: cycling through neon accents based on array index

### Agent Console

- Reads `events[selectedAgentId]` from `useAgentEventsStore`
- Virtual scrolling via `@tanstack/react-virtual` (preserved)
- **IMPORTANT**: `ConsoleLine` receives paired `ChatBlock` objects, NOT raw `AgentEvent`s. The `pairEvents()` function from `ChatRenderer.tsx` (lines 31-116) must be extracted to a shared util and reused by `AgentConsole`. This function pairs `tool_call` + `tool_result` events into single `tool_pair` blocks. Without it, every tool invocation renders as two separate lines.
- Collapsible state managed locally per-line (not in store)

### Command Bar

- `/stop` → `window.api.killAgent(agentId)` (existing IPC)
- `/retry` → `window.api.sprint.update(taskId, { status: 'queued' })` (existing IPC). Only available when `agentMeta.sprintTaskId` is non-null. Disabled/hidden for adhoc agents.
- Free text → `window.api.steerAgent(agentId, message)` (existing IPC)
- `/files` → parsed from tool_call events in `useAgentEventsStore` locally (no IPC)
- `/focus <topic>` → sends as steering message with prefix
- Autocomplete items are static — no server-side completion needed

### Timeline

- Reads full `agents` array from `useAgentHistoryStore`
- Computes bar positions from `startedAt` / `finishedAt` timestamps client-side
- Time axis: last 6 hours default, zoom state managed locally
- No new IPC channels needed

### Polling & Subscriptions (unchanged)

- Agent list: poll every 5s via `fetchAgents()`
- Events: real-time via `window.api.agentEvents.onEvent()` (one-time init)
- Event history: loaded once per agent selection via `loadHistory(agentId)`

## File Locations

| What           | Where                                                        |
| -------------- | ------------------------------------------------------------ |
| View           | `src/renderer/src/views/AgentsView.tsx` (rewrite)            |
| Live strip     | `src/renderer/src/components/agents/LiveActivityStrip.tsx`   |
| Agent pill     | `src/renderer/src/components/agents/AgentPill.tsx`           |
| Console        | `src/renderer/src/components/agents/AgentConsole.tsx`        |
| Console header | `src/renderer/src/components/agents/ConsoleHeader.tsx`       |
| Console line   | `src/renderer/src/components/agents/ConsoleLine.tsx`         |
| Command bar    | `src/renderer/src/components/agents/CommandBar.tsx`          |
| Autocomplete   | `src/renderer/src/components/agents/CommandAutocomplete.tsx` |
| Timeline       | `src/renderer/src/components/agents/AgentTimeline.tsx`       |
| Timeline bar   | `src/renderer/src/components/agents/TimelineBar.tsx`         |
| CSS            | `src/renderer/src/assets/agents-neon.css`                    |
| Fleet list     | `src/renderer/src/components/agents/AgentList.tsx` (modify)  |
| Fleet card     | `src/renderer/src/components/agents/AgentCard.tsx` (modify)  |
| Spawn modal    | `src/renderer/src/components/agents/SpawnModal.tsx` (modify) |

## Non-Goals

- No new IPC channels — all data sources already exist
- No changes to agent spawning, completion, or event streaming logic
- No changes to the agent manager (main process)
- No new Zustand stores
- Light theme polish — follow-up work
- PlaygroundModal internals unchanged (just neon restyling)
