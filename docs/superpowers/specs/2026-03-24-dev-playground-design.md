# Dev Playground — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Per-task opt-in feature for native HTML preview rendering in BDE agent chat

## Problem

Agents building frontend UI (via the playground plugin or ad-hoc) currently write HTML files and serve them through a localhost server or `open` them in the system browser. This forces developers out of BDE to preview agent output, breaking flow and adding friction.

## Solution

When `playground_enabled` is set on a task, the agent's system prompt is augmented with playground instructions. The agent writes self-contained HTML files normally (via the Write tool). BDE's event stream parser in `run-agent.ts` detects `.html` file writes in the tool result stream and auto-emits `agent:playground` events. These render as inline cards in the agent chat — click to expand into a split modal with live preview (sandboxed iframe) and syntax-highlighted source code.

## Design Decisions

| Decision           | Choice                                               | Rationale                                                                                                                                        |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Surface location   | Inline card in agent chat → expand to modal          | Stays in context, no view switching, familiar tool-call pattern                                                                                  |
| Artifact detection | Event stream pattern matching on `.html` file writes | Agents can't call IPC directly (they're subprocesses via SDK). Detect Write tool results that target `.html` files in the message stream parser. |
| Enablement         | Per-task toggle                                      | Frontend tasks get playground, backend tasks don't waste tokens                                                                                  |
| Modal layout       | Split: preview + source                              | Devs need to see what the agent built and how                                                                                                    |
| Sandboxing         | `sandbox="allow-scripts"` iframe                     | Secure — no Node.js access, no filesystem, no navigation                                                                                         |
| File lifecycle     | Ephemeral (dies with worktree)                       | Playgrounds are previews, not artifacts. Good work lands in PRs                                                                                  |

## Architecture

### Data Flow

```
Agent writes HTML file via Write tool (normal SDK message stream)
  → run-agent.ts message loop detects tool_result for Write targeting .html file
  → Main process reads file content from worktree disk (max 5MB)
  → Main emits agent:playground event via existing agent:event IPC channel
    payload: { type: 'agent:playground', filename, html, sizeBytes, timestamp }
  → Renderer agentEvents store receives event (same path as all agent events)
  → ChatRenderer renders PlaygroundCard inline in event stream
  → User clicks card → PlaygroundModal opens
  → Sandboxed iframe renders HTML content via srcdoc
```

### Key Architectural Decision: No New IPC Channel

Agents run as subprocesses via `@anthropic-ai/claude-agent-sdk` (see `sdk-adapter.ts`). They cannot call BDE IPC channels directly. Instead, the playground detection piggybacks on the existing agent event pipeline:

1. `run-agent.ts` already processes the SDK message stream in its main loop
2. When a tool result indicates a `.html` file was written, the loop emits an `agent:playground` event through the same `agent:event` IPC channel used for all other agent events
3. No new IPC channels, no new preload bridge updates — just a new event type in the existing pipeline

### New Components

#### 1. Event Stream Detection (in `run-agent.ts`)

**Location:** `src/main/agent-manager/run-agent.ts` — in the existing message processing loop

When `task.playground_enabled === true`:

- Watch for tool results where tool name is `Write` (or equivalent file-write tools)
- Check if the output file path ends in `.html`
- Read the file content from disk (enforce 5MB size limit)
- Emit `agent:playground` event through existing `agent:event` IPC broadcast
- This requires extending `RunAgentTask` interface to include `playground_enabled`

#### 2. Agent Prompt Augmentation

**Location:** `src/main/agent-manager/run-agent.ts` — prompt construction

When `task.playground_enabled === true`, append to agent system prompt:

```
## Dev Playground

You have access to a Dev Playground for previewing frontend UI natively in BDE.
When you want to show a visual preview:

1. Write a self-contained HTML file (inline all CSS and JS, no external dependencies)
2. The preview will automatically appear inline in the BDE chat when you write .html files

Keep playgrounds focused on one component or layout at a time. Do NOT run
`open` or start a localhost server — BDE renders the HTML natively.
```

#### 3. Event Type Extension

**Location:** `src/shared/types.ts`

Add to `AgentEvent` discriminated union:

```typescript
| { type: 'agent:playground'; filename: string; html: string; sizeBytes: number; timestamp: number }
```

Also add `'agent:playground'` to the `AgentEventType` string literal union (these must stay in sync).

#### 4. Renderer Components

**PlaygroundCard** (`src/renderer/src/components/agents/PlaygroundCard.tsx`):

- Compact inline card rendered in ChatRenderer when a playground event is detected
- Shows: file icon, filename, file size, "Click to preview" hint
- Click handler opens PlaygroundModal
- Styled consistently with existing ToolCallBlock

**PlaygroundModal** (`src/renderer/src/components/agents/PlaygroundModal.tsx`):

- Full-screen overlay (~90% viewport width/height)
- Toolbar: filename, file size, Split/Preview/Source view toggle, "Open in Browser" button, close (✕)
- Left pane: sandboxed iframe (`sandbox="allow-scripts"`) rendering the HTML via `srcdoc`
- Right pane: source code display (simple `<pre><code>` with CSS-based highlighting — no new dependencies)
- View modes: Split (default), Preview only, Source only
- Keyboard: `Escape` to close
- Uses design tokens and CSS variables per project conventions
- "Open in Browser" writes HTML to a temp file via `window:openExternal` IPC, then opens it

#### 5. Data Model Changes

**SprintTask extension** (`src/shared/types.ts`):

- Add optional `playground_enabled?: boolean` field to `SprintTask` interface
- Default: `false`
- Stored in Supabase `sprint_tasks` table (new column, nullable boolean)

**RunAgentTask extension** (`src/main/agent-manager/run-agent.ts`):

- Add `playground_enabled?: boolean` to `RunAgentTask` interface (the subset of SprintTask passed to `runAgent()`)

#### 6. Task Creation UI

**Sprint Center** (`src/renderer/src/components/sprint/`):

- Add "Dev Playground" checkbox to task creation form
- Tooltip: "Enable native HTML preview rendering for frontend work"

**Task Workbench** (`src/renderer/src/views/TaskWorkbenchView.tsx`):

- Same checkbox in the task form

### Security

- Iframe uses `sandbox="allow-scripts"` — scripts run but cannot:
  - Access parent window (`allow-same-origin` NOT included)
  - Open popups or new windows
  - Submit forms
  - Navigate the top frame
- HTML rendered via `srcdoc` attribute — no localhost server needed
- No `nodeIntegration`, no `contextIsolation` bypass
- Content is fully isolated from BDE's renderer process
- File size capped at 5MB to prevent memory issues in renderer

### What This Does NOT Include

- No DevTools tabs (Console/Elements) in the modal
- No persistent storage — files are ephemeral with the worktree
- No hot-reload or file watching — a new playground card appears each time the agent writes a new .html file
- No new BDE view — lives entirely within the existing Agents view
- No new npm dependencies
- No new IPC channels — uses existing `agent:event` pipeline
- No preload bridge changes

## Implementation Tasks

### Task 1: Event Type + Detection Foundation

Add `agent:playground` to both the `AgentEvent` union and `AgentEventType` literal union in `src/shared/types.ts`. Extend `RunAgentTask` interface to include `playground_enabled`. In `run-agent.ts` message loop, add detection logic: when `playground_enabled` is true and a tool result indicates a `.html` file write, read the file (max 5MB), emit `agent:playground` event via existing `agent:event` IPC broadcast.

### Task 2: PlaygroundCard Component

Create `PlaygroundCard.tsx` in `src/renderer/src/components/agents/`. Compact card with file icon, filename, size, click hint. Integrate into `ChatRenderer.tsx` to render when `agent:playground` events appear in the stream.

### Task 3: PlaygroundModal Component

Create `PlaygroundModal.tsx` in `src/renderer/src/components/agents/`. Split modal with sandboxed iframe (left) and source display (right). Toolbar with view toggle (Split/Preview/Source), "Open in Browser" (writes temp file + opens), close button. Escape to close. Use design tokens. Source display uses `<pre><code>` with CSS-based highlighting (no new deps).

### Task 4: Per-Task Toggle + Prompt Injection

Add `playground_enabled` field to `SprintTask` type. Add checkbox to Sprint Center and Task Workbench task creation forms. In `run-agent.ts`, conditionally augment agent system prompt with playground instructions when flag is set. Update `sprint-queries.ts` field mappings and `UPDATE_ALLOWLIST`.

### Task 5: Supabase Schema Change

Add `playground_enabled` boolean column to `sprint_tasks` table via Supabase dashboard or CLI migration (NOT local `db.ts` — sprint_tasks lives in Supabase). Nullable, defaults to false.

### Task 6: Integration Testing

Test the full flow: enable playground on task → agent writes HTML → detection triggers in run-agent → playground card appears in chat → modal renders correctly → iframe is sandboxed → escape closes modal. Add unit tests for PlaygroundCard, PlaygroundModal, and the detection logic in run-agent.
