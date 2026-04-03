# Agents View UI Polish — Design Spec

**Date:** 2026-03-23
**Goal:** Redesign the Agents view as a chat-first Claude Code GUI with IDE-dense styling, tabbed content views, split sidebar, and inline new-session experience.

---

## Design Decisions

| Decision           | Choice                                                 | Rationale                                              |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| Primary experience | Chat-first, sprint agents secondary                    | Ad-hoc sessions are the exciting use case              |
| Visual style       | Claude.ai polish + VS Code density                     | Rich but compact — development tool, not consumer chat |
| Chat layout        | IDE-Dense — no avatars, grouped tool blocks, tabs      | Efficient, developer-focused                           |
| Tab structure      | Chat (interleaved) / Tools (inspector) / Files (diffs) | Chat is primary, Tools and Files for drilling down     |
| Sidebar            | Sessions at top, Queue below, visually separated       | Both visible without tab switching                     |
| New session        | Empty state in chat panel (no modal)                   | Quick "start chatting" flow like Claude.ai             |

---

## Layout Architecture

### Sidebar (left panel, resizable)

```
┌─────────────────────┐
│ AGENTS          [+]  │  ← aurora header, + button creates new session
├─────────────────────┤
│ SESSIONS (2)         │  ← section header, count
│ ● research mobile... │  ← active: green dot, selected highlight
│ ○ fix auth middle... │  ← done: gray dot
├─────────────────────┤
│ QUEUE (1 active)     │  ← section header
│ ◉ refactor sprint... │  ← amber dot for active queue task
│ ○ add unit tests...  │  ← queued: dim
└─────────────────────┘
```

**Sessions section:** Ad-hoc agents (`source: 'adhoc'`). Sorted by most recent. Running sessions at top with green pulse dot.

**Queue section:** Agent Manager tasks (`source: 'bde'`). Shows status: queued (dim), active (amber), done (gray), failed (red).

**Divider:** 1px horizontal line between sections.

**Card content:** Task title (truncated), metadata line (model · repo · duration/time ago).

**Clicking "+"** or clicking empty area when no sessions → scrolls to / focuses the new session form in the main panel.

### Main Panel — Active Session

```
┌─────────────────────────────────────────────┐
│ ● research mobile-first   sonnet · life-os  │
│                          [Chat] Tools Files ■│  ← header + tabs + stop
├─────────────────────────────────────────────┤
│                                              │
│ I'll analyze the Life OS codebase for       │  ← agent text, no avatar
│ mobile responsiveness.                       │
│                                              │
│ ┌─ Glob  src/**/*.css         12 files ─┐   │  ← tool block, grouped
│ │  Read  src/styles/global.css      ✓   │   │
│ │  Read  src/pages/Dashboard.css    ✓   │   │
│ └───────────────────────────────────────┘   │
│                                              │
│ Found 3 issues:                              │
│ 1. No viewport meta tag                     │
│ 2. Hardcoded widths in Dashboard.css         │
│ 3. Missing media queries                     │
│ ─────────────────────────────────────────── │  ← thin separator before user
│ You · 7:18 PM                                │
│ Fix those issues. Start with the viewport.   │
│                                              │
├─────────────────────────────────────────────┤
│ Message Claude...                        [↑] │  ← input + send
│ ⌘↵ Send  ⇧↵ Newline                        │  ← keyboard hints
└─────────────────────────────────────────────┘
```

### Main Panel — New Session (Empty State)

When no session is selected or "+" is clicked:

```
┌─────────────────────────────────────────────┐
│                                              │
│              [C]  (gradient avatar)           │
│     What would you like to work on?          │
│     Start a Claude Code session in any repo  │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Describe what you'd like to do...   │    │  ← textarea
│  └─────────────────────────────────────┘    │
│                                              │
│  📁 life-os ▾   [haiku] [sonnet] [opus]  [↑]│  ← repo + model + send
│                                              │
└─────────────────────────────────────────────┘
```

- Centered vertically in the panel
- Textarea auto-expands
- Repo dropdown from configured repos
- Model chips (same as current SpawnModal)
- Send button activates when text is non-empty
- On submit: creates ad-hoc session, switches to active session view
- Task history from localStorage still available (show on textarea focus)

---

## Tab Content

### Chat Tab (default)

Full interleaved stream — the primary view:

- **Agent text:** No avatar. Plain text with markdown rendering (code blocks, bold, lists). Line-height 1.5, `sm` font.
- **User messages:** Prefixed with "You" label in accent color + timestamp. Separated from agent text by a thin divider line.
- **Tool calls:** Grouped into blocks with left border (cyan for completed, amber for running). Each tool is one row: tool name (bold, cyan) + summary/path + result indicator (✓ green, ✗ red, "running..." amber). Blocks are collapsible — click to expand input/output.
- **Errors:** Red background block with error message.
- **Rate limits:** Inline dim text "Rate limited (attempt N) — retrying in Ns"
- **Completion:** "Completed — $X.XXXX · Ns" or "Failed (exit N) — ..." in dim text.

**Auto-scroll:** Follows bottom when user is at bottom. Shows "↓ New messages" indicator when scrolled up and new content arrives.

### Tools Tab

Detailed tool call inspector:

- Chronological list of every tool call
- Each row: timestamp | tool name | summary | status badge
- Click to expand: full input JSON + full output JSON, syntax-highlighted
- Filter by tool name (dropdown or search)
- Running tools pulse with amber indicator

### Files Tab

Files touched during the session:

- List of file paths, grouped by action: Read / Edited / Created
- Edited files show inline diff (green/red lines)
- Click file path to expand full content or diff
- Count badges on section headers

---

## Component Changes

### New Components

| Component            | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `NewSessionForm.tsx` | Centered empty-state form replacing SpawnModal for ad-hoc           |
| `SessionList.tsx`    | Sidebar section for ad-hoc sessions                                 |
| `QueueList.tsx`      | Sidebar section for sprint queue agents                             |
| `ChatTab.tsx`        | Interleaved chat stream (replaces ChatRenderer)                     |
| `ToolsTab.tsx`       | Tool call inspector view                                            |
| `FilesTab.tsx`       | Files touched view with diffs                                       |
| `ToolBlock.tsx`      | Grouped tool calls with collapsible detail (replaces ToolCallBlock) |
| `UserMessage.tsx`    | User message with label + timestamp                                 |
| `AgentText.tsx`      | Agent text with markdown rendering                                  |
| `SessionHeader.tsx`  | Header bar with session info + tabs + stop button                   |

### Modified Components

| Component         | Changes                                                         |
| ----------------- | --------------------------------------------------------------- |
| `AgentsView.tsx`  | New layout: sidebar sections + main panel with tabs/empty state |
| `AgentList.tsx`   | Split into SessionList + QueueList                              |
| `AgentDetail.tsx` | Replaced by tabbed view (ChatTab/ToolsTab/FilesTab)             |
| `AgentCard.tsx`   | Simplified — remove source icon, adjust for section context     |
| `SteerInput.tsx`  | Polish: rounded input, send button, keyboard hints              |
| `HealthBar.tsx`   | Move into sidebar or remove (queue section header shows counts) |

### Removed Components

| Component           | Reason                                                |
| ------------------- | ----------------------------------------------------- |
| `SpawnModal.tsx`    | Replaced by NewSessionForm (inline empty state)       |
| `ChatRenderer.tsx`  | Replaced by ChatTab with new rendering                |
| `ChatBubble.tsx`    | Replaced by AgentText + UserMessage (no bubble style) |
| `ThinkingBlock.tsx` | Keep but restyle to match new density                 |

### CSS

- New `agents-view.css` replacing inline styles + existing `agents.css`
- Follow BDE design tokens, glass morphism patterns
- All colors from CSS variables, no hardcoded hex

---

## Interaction Details

### Spawning a New Session

1. User sees empty state (NewSessionForm) or clicks "+"
2. Types task, selects repo/model
3. Cmd+Enter or click send
4. Form calls `spawnAdhocAgent()` via existing IPC path
5. New session appears in Sessions sidebar, auto-selected
6. Main panel switches to active session view with Chat tab
7. Events stream in as agent works

### Steering (Follow-up Messages)

1. User types in input at bottom of Chat tab
2. Cmd+Enter sends via `agent:steer` IPC → `session.send(message)`
3. User message appears in chat stream with "You" label
4. Agent response streams in below

### Stopping a Session

1. Click stop button (■) in session header
2. Calls `agent:kill` IPC → `session.close()`
3. Completion event emitted, session marked done
4. Session stays in sidebar under Sessions (done state)

### Viewing Queue Agents

1. Click a queue agent in the Queue sidebar section
2. Main panel shows same tabbed view (Chat/Tools/Files)
3. No steer input shown (queue agents are autonomous)
4. Header shows sprint task info instead of session info

---

## Out of Scope

- Markdown rendering library (use existing or add in implementation)
- JSON syntax highlighting (use pre-formatted for now, can enhance later)
- Session resume/continue (future feature)
- Drag-and-drop reordering in sidebar
- Multi-session tabs (only one session visible at a time)
