# Task Workbench — Sprint Task Creation Redesign

**Date:** 2026-03-23
**Status:** Approved
**Scope:** BDE — Renderer + Main process
**Effort:** 4-5 days

## Problem

The current task creation UX is a lightweight modal (`NewTicketModal`) with two modes (Quick / Template). It has several compounding issues:

1. **Too many steps from idea → running agent** — create → find in backlog → review spec → queue → launch is a long, disjointed journey.
2. **Quick vs Template is the wrong abstraction** — Quick hides too much (hardcoded P3, no spec control), Template is a wall of options. Users switch between two tools instead of having one that progressively reveals complexity.
3. **Poor task quality** — No guidance on what makes a good spec. Agents receive vague instructions and produce bad PRs. The title-only Quick mode generates specs asynchronously with no user review gate.
4. **No built-in research or AI assistance** — Users must context-switch to other tools to research the codebase, brainstorm approaches, or get help writing specs.
5. **No quality gates** — Tasks can be queued with empty specs, misconfigured repos, or expired auth tokens. Bad tasks waste agent cycles.

## Solution

Replace `NewTicketModal` with a **Task Workbench** — a full panel view for crafting, validating, and dispatching agent tasks. The workbench has three integrated systems:

1. **A well-designed form** with progressive disclosure — all fields are available but complexity reveals as needed
2. **Inline AI actions** on fields — "Generate Spec," "Research Codebase," "Suggest Priority"
3. **A chat sidebar (AI Copilot)** — freeform brainstorming, research, and general-purpose help, context-aware of the form state
4. **Pre-queue readiness checks** — three tiers of validation (structural, semantic, operational) that must pass before a task can be queued, analogous to pre-commit hooks for code quality

```
User opens Task Workbench (from Sprint Board or keyboard shortcut)
  ↓
Fills out form fields with AI assistance (inline actions + copilot chat)
  ↓
Readiness checks run continuously, showing pass/warn/fail
  ↓
When checks pass → split action button: Save to Backlog | Queue Now | Launch
  ↓
Task enters pipeline with high-quality spec
```

### Key Design Decisions

- **Panel view, not modal** — The workbench is a first-class view in the panel system (like Sprint, Agents, Terminal). It can coexist side-by-side with the Sprint Board. This gives it room for the form, copilot, and readiness checks without feeling cramped.
- **Single form, progressive disclosure** — No Quick/Template mode split. One form where advanced fields (priority, spec templates, task templates) expand as needed. Smart defaults mean you can submit with just a title if the readiness checks pass.
- **Readiness checks are the quality gate** — Inspired by pre-commit hooks. Agents are only as good as their instructions, so the input layer is the highest-leverage place to enforce quality. Checks run live as you edit.
- **Chat sidebar is context-aware** — The copilot knows the current form state (title, repo, spec draft). It can research the target repo, suggest spec improvements, and brainstorm. Users can "insert" copilot outputs directly into form fields.
- **Edit and create use the same view** — Opening an existing backlog task in the workbench pre-fills the form and re-runs readiness checks. Same UX for refinement and creation.
- **Claude API access via `claude` CLI** — The codebase has `@anthropic-ai/claude-agent-sdk` (for spawning agents) but no general-purpose Claude API client. The user's Claude Code subscription token (OAuth, macOS Keychain) is a CLI token, not an API key — it cannot call the Anthropic API directly. All AI features (copilot chat, semantic checks, spec generation) will shell out to the `claude` CLI in non-interactive mode (`claude -p "prompt" --output-format json`). This reuses the user's existing authentication and avoids adding a new dependency. The main process already locates the `claude` binary via `AgentConfig`.

---

## View Architecture

### New View Registration

Add `'task-workbench'` to the `View` type in `panelLayout.ts`:

```typescript
export type View =
  | 'agents'
  | 'terminal'
  | 'sprint'
  | 'pr-station'
  | 'memory'
  | 'cost'
  | 'settings'
  | 'task-workbench'
```

New files:

```
src/renderer/src/views/TaskWorkbenchView.tsx          — view wrapper
src/renderer/src/components/task-workbench/
  TaskWorkbench.tsx                                    — main layout (form + copilot split)
  WorkbenchForm.tsx                                    — the task form with all fields
  WorkbenchCopilot.tsx                                 — AI chat sidebar
  ReadinessChecks.tsx                                  — check runner + display
  WorkbenchActions.tsx                                 — split action button (Save/Queue/Launch)
  SpecEditor.tsx                                       — markdown editor with inline AI actions
  InlineAiAction.tsx                                   — reusable button+loading for field-level AI
src/renderer/src/stores/taskWorkbench.ts               — form state, copilot messages, check results
src/renderer/src/hooks/useReadinessChecks.ts           — check execution engine
```

Modified files:

```
src/renderer/src/stores/panelLayout.ts                 — add 'task-workbench' view type
src/renderer/src/App.tsx                               — register TaskWorkbenchView in view map
src/renderer/src/components/sprint/SprintCenter.tsx    — replace NewTicketModal with workbench open
src/renderer/src/components/sprint/SprintToolbar.tsx   — update "+ New Task" to open workbench
src/shared/ipc-channels.ts                             — add WorkbenchChannels
src/preload/index.ts                                   — expose workbench API
src/main/index.ts                                      — register workbench handlers
```

### Layout Structure

```
┌──────────────────────────────────────────────┬────────────────────────────┐
│  LEFT PANEL: Task Form (~65%, resizable)     │  RIGHT PANEL: AI Copilot   │
│                                              │  (~35%, collapsible)       │
│  ┌─ Header ────────────────────────────┐     │                            │
│  │  "New Task" or "Edit: {title}"      │     │  ┌─ Copilot Header ──────┐ │
│  │  [Toggle Copilot]                   │     │  │  AI Copilot      [×]  │ │
│  └─────────────────────────────────────┘     │  └───────────────────────┘ │
│                                              │                            │
│  ┌─ Core Fields ───────────────────────┐     │  ┌─ Message List ────────┐ │
│  │  Title *:  [________________________]│     │  │  (scrollable)         │ │
│  │  Repo:     [BDE ▼]                  │     │  │                       │ │
│  └─────────────────────────────────────┘     │  │  System: I can help   │ │
│                                              │  │  you craft this task. │ │
│  ┌─ Advanced Fields (expandable) ──────┐     │  │  Try asking me to     │ │
│  │  Priority: [P3 Medium ▼]           │     │  │  research the code... │ │
│  │  Template: [None ▼]                 │     │  │                       │ │
│  └─────────────────────────────────────┘     │  │  User: what files     │ │
│                                              │  │  handle auth?         │ │
│  ┌─ Spec Editor ───────────────────────┐     │  │                       │ │
│  │  Toolbar: [✨ Generate] [📋 Template]│     │  │  AI: auth-guard.ts... │ │
│  │           [🔍 Research]             │     │  │  [Insert into spec →] │ │
│  │                                     │     │  └───────────────────────┘ │
│  │  (markdown textarea, auto-growing)  │     │                            │
│  │                                     │     │  ┌─ Input ───────────────┐ │
│  └─────────────────────────────────────┘     │  │  [Ask anything...]    │ │
│                                              │  │  [Send]               │ │
│  ┌─ Readiness Checks ─────────────────┐     │  └───────────────────────┘ │
│  │  ✅ ✅ ⚠️ ✅ ❌   3/5 passing        │     │                            │
│  │  ▸ Expand details                   │     │                            │
│  └─────────────────────────────────────┘     │                            │
│                                              │                            │
│  ┌─ Actions ───────────────────────────┐     │                            │
│  │  [Save to Backlog]  [Queue Now ▼]   │     │                            │
│  └─────────────────────────────────────┘     │                            │
└──────────────────────────────────────────────┴────────────────────────────┘
```

- **Resizable split** via `react-resizable-panels` (existing dependency)
- **Copilot is collapsible** — toggle button in form header. When collapsed, form gets full width.
- **Responsive behavior** — If panel width < 600px, copilot auto-collapses to a floating action button that opens a drawer instead.

---

## Component Design

### TaskWorkbench.tsx — Main Orchestrator

**Responsibilities:**

- Manages the resizable two-column layout
- Reads `taskId` prop (null for new, string for edit)
- On mount with `taskId`: loads existing task data into store
- On mount without `taskId`: resets store to defaults
- Passes form state to copilot for context awareness

```typescript
interface TaskWorkbenchProps {
  taskId?: string | null // null = new task, string = edit existing
  onClose?: () => void // navigate back to Sprint view
}
```

### WorkbenchForm.tsx — The Task Form

**Fields (top to bottom):**

| Field         | Component      | Default            | Notes                                           |
| ------------- | -------------- | ------------------ | ----------------------------------------------- |
| Title         | `<input>`      | ""                 | Required. Auto-focused on mount.                |
| Repo          | `<select>`     | First REPO_OPTIONS | Dropdown from constants.                        |
| Priority      | `<select>`     | P3 Medium          | Inside "Advanced" expandable section.           |
| Task Template | `<select>`     | None               | Inside "Advanced" section. Loads from settings. |
| Spec          | `<SpecEditor>` | ""                 | Markdown editor with inline AI toolbar.         |

**Progressive disclosure:**

- Title and Repo are always visible
- "Advanced" section (Priority, Task Template) is collapsed by default, shown via a "More options" toggle
- Spec Editor is always visible but starts with helpful placeholder text

### SpecEditor.tsx — Markdown Editor with AI Actions

**Toolbar buttons (inline AI actions):**

| Button   | Label                  | Behavior                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generate | "✨ Generate Spec"     | New IPC `workbench:generateSpec` — shells out to `claude` CLI with the prompt from `buildQuickSpecPrompt()` (in `sprint-spec.ts`), streams the AI-written spec into the editor. Unlike the current `sprint:generatePrompt` (which is synchronous and returns only a scaffold prompt, not an actual spec), this performs real AI generation. |
| Template | "📋 From Template"     | Opens popover with 8 spec scaffolds. Reuses the existing `SCAFFOLDS` map in `sprint-spec.ts` (bugfix, feature, refactor, test, performance, ux, audit, infra) and the `TEMPLATES` in `NewTicketModal.tsx`.                                                                                                                                  |
| Research | "🔍 Research Codebase" | Sends title + repo to copilot with "research relevant files" system prompt, shows results in copilot with "Insert" button                                                                                                                                                                                                                   |

**Editor features:**

- Monospace font, auto-growing height (min 200px, max 60vh)
- Tab inserts 2 spaces (not focus change)
- Placeholder: "Describe what the agent should do. The more specific, the better the results."

### WorkbenchCopilot.tsx — AI Chat Sidebar

**Architecture:**

- Local message history in `taskWorkbench` store (not persisted across sessions)
- Each message sent includes form context as a system message:
  ```
  [Context] Title: "Fix auth token refresh", Repo: BDE, Spec draft: "## Problem\n..."
  ```
- For spec generation: uses `workbench:generateSpec` IPC channel (shells out to `claude` CLI)
- For freeform chat: uses `workbench:chat` IPC channel (shells out to `claude` CLI)

**UI:**

- Scrollable message list with user/assistant bubbles
- Input at bottom with Send button
- Each assistant message with actionable content shows an "Insert into spec →" button
- System welcome message on mount: "I can help you craft this task. Try asking me to research the codebase, brainstorm approaches, or review your spec."

**Copilot capabilities (via system prompt):**

1. **Research codebase** — "What files handle X in this repo?" → uses tool to grep/glob the target repo
2. **Brainstorm** — "What's the best approach for X?" → general reasoning
3. **Draft spec sections** — "Write the Problem section for this spec" → structured output
4. **Review spec** — "Is this spec clear enough for an agent?" → critique + suggestions
5. **Explain code** — "What does auth-guard.ts do?" → reads and explains files

### ReadinessChecks.tsx — The Quality Gate

**Display:**

- Collapsed state: horizontal bar showing pass/warn/fail icons + "3/5 passing" summary
- Expanded state: vertical list with check name, status icon, and detail message

---

## Readiness Check Engine

### Check Types and Tiers

The check engine runs in the renderer process. Structural checks run synchronously on form state. Semantic and operational checks run via IPC.

#### Tier 1: Structural Checks (instant, on every keystroke)

| Check                  | Pass                                         | Warn                              | Fail                                    |
| ---------------------- | -------------------------------------------- | --------------------------------- | --------------------------------------- |
| **Title present**      | Title is non-empty after trim                | —                                 | Empty title                             |
| **Spec present**       | Spec is non-empty (>50 chars)                | Spec is 1-50 chars ("very short") | No spec at all                          |
| **Spec has structure** | Contains at least 2 markdown headings (`##`) | Has 1 heading                     | No headings (wall of text)              |
| **Repo selected**      | Repo is set                                  | —                                 | No repo (shouldn't happen with default) |

#### Tier 2: Semantic Checks (debounced, AI-assisted via IPC)

| Check                | Pass                                                        | Warn                                     | Fail                                       |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| **Spec clarity**     | AI rates spec as "clear and actionable"                     | AI flags vague language or ambiguity     | AI rates spec as "too vague to execute"    |
| **Scope reasonable** | AI estimates task is achievable by one agent in one session | AI flags as "broad — consider splitting" | AI rates as "too large for a single agent" |
| **Files exist**      | All files referenced in spec exist in repo                  | Some files don't exist (renamed?)        | — (warn only)                              |

**Implementation:**

- New IPC channel: `workbench:checkSpec`
- Debounced at 2 seconds after last spec edit
- Runs in main process, shells out to `claude` CLI with a structured prompt asking for a JSON assessment
- Caches result until spec changes

```typescript
// IPC contract
'workbench:checkSpec': {
  args: [input: { title: string; repo: string; spec: string }]
  result: {
    clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
    scope: { status: 'pass' | 'warn' | 'fail'; message: string }
    filesExist: { status: 'pass' | 'warn'; message: string; missingFiles?: string[] }
  }
}
```

#### Tier 3: Operational Checks (on-demand, before queue/launch)

| Check                          | Pass                                           | Warn                                             | Fail                             |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| **Auth token valid**           | Token exists and not expired                   | Token expires within 1 hour                      | Token expired or missing         |
| **Repo path configured**       | `getRepoPaths()[repo]` returns a valid path    | —                                                | No path configured for this repo |
| **Git repo clean**             | Target repo has no uncommitted changes on main | Uncommitted changes present (agent may conflict) | — (warn only)                    |
| **No conflicting active task** | No other active/queued task on same repo       | Another queued task on same repo                 | Another active task on same repo |
| **Agent slots available**      | AgentManager has free slots                    | All slots occupied (task will wait in queue)     | — (warn only, queuing is fine)   |

**Implementation:**

- New IPC channel: `workbench:checkOperational`
- Runs on button click (not continuously — some checks are expensive)
- Aggregates results from `auth:status`, `git:getRepoPaths`, `agent-manager:status`

```typescript
'workbench:checkOperational': {
  args: [input: { repo: string }]
  result: {
    auth: { status: 'pass' | 'warn' | 'fail'; message: string }
    repoPath: { status: 'pass' | 'fail'; message: string; path?: string }
    gitClean: { status: 'pass' | 'warn'; message: string }
    noConflict: { status: 'pass' | 'warn' | 'fail'; message: string }
    slotsAvailable: { status: 'pass' | 'warn'; message: string; available: number; max: number }
  }
}
```

### Check Gating Rules

The split action button respects check results:

| Action                 | Required Checks                                                           |
| ---------------------- | ------------------------------------------------------------------------- |
| **Save to Backlog**    | Tier 1 title check only (just needs a name)                               |
| **Queue Now**          | All Tier 1 pass + Tier 3 operational pass (no semantic failures required) |
| **Launch Immediately** | All Tier 1 pass + Tier 2 no fails (warns OK) + Tier 3 no fails            |

Users can override warnings with a "Queue Anyway" confirmation dialog, but cannot override failures.

---

## State Management

### New Store: `taskWorkbench.ts`

```typescript
interface TaskWorkbenchState {
  // --- Form State ---
  mode: 'create' | 'edit'
  taskId: string | null // null for new, real ID for edit
  title: string
  repo: string
  priority: number
  spec: string
  taskTemplateName: string
  advancedOpen: boolean // whether Advanced section is expanded

  // --- Copilot State ---
  copilotVisible: boolean
  copilotMessages: CopilotMessage[]
  copilotLoading: boolean

  // --- Readiness State ---
  checksExpanded: boolean
  structuralChecks: CheckResult[] // updated on every form change
  semanticChecks: CheckResult[] // updated after debounced AI call
  operationalChecks: CheckResult[] // updated on-demand
  semanticLoading: boolean
  operationalLoading: boolean

  // --- Actions ---
  setField: (field: string, value: unknown) => void
  resetForm: () => void
  loadTask: (task: SprintTask) => void
  sendCopilotMessage: (message: string) => Promise<void>
  insertIntoCopilot: (text: string) => void
  runSemanticChecks: () => Promise<void>
  runOperationalChecks: () => Promise<void>
  submit: (action: 'backlog' | 'queue' | 'launch') => Promise<void>
}

interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  insertable?: boolean // show "Insert into spec" button
}

interface CheckResult {
  id: string
  label: string
  tier: 1 | 2 | 3
  status: 'pass' | 'warn' | 'fail' | 'pending'
  message: string
}
```

### Store Design Principles

- **Single store for the workbench** — form state, copilot, and checks are tightly coupled. One store avoids cross-store sync issues.
- **No cross-store calls** — The workbench store calls IPC directly for submit, which updates the sprint tasks. The sprint store picks up changes via its existing polling/SSE mechanism.
- **Stable selectors** — All array/object state is stored as top-level primitives or pre-computed arrays (no `.getX()` methods in selectors to avoid the Zustand infinite loop gotcha).

---

## IPC Channels (New)

Add to `SprintChannels` or a new `WorkbenchChannels` interface in `ipc-channels.ts`:

```typescript
export interface WorkbenchChannels {
  'workbench:chat': {
    args: [
      input: {
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
        formContext: { title: string; repo: string; spec: string }
      }
    ]
    result: { content: string }
  }
  'workbench:generateSpec': {
    args: [input: { title: string; repo: string; templateHint: string }]
    result: { spec: string }
  }
  'workbench:checkSpec': {
    args: [input: { title: string; repo: string; spec: string }]
    result: {
      clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
      scope: { status: 'pass' | 'warn' | 'fail'; message: string }
      filesExist: { status: 'pass' | 'warn'; message: string; missingFiles?: string[] }
    }
  }
  'workbench:checkOperational': {
    args: [input: { repo: string }]
    result: {
      auth: { status: 'pass' | 'warn' | 'fail'; message: string }
      repoPath: { status: 'pass' | 'fail'; message: string; path?: string }
      gitClean: { status: 'pass' | 'warn'; message: string }
      noConflict: { status: 'pass' | 'warn' | 'fail'; message: string }
      slotsAvailable: { status: 'pass' | 'warn'; message: string; available: number; max: number }
    }
  }
  'workbench:researchRepo': {
    args: [input: { query: string; repo: string }]
    result: {
      content: string // formatted text with file paths + context lines
      filesSearched: string[] // files that matched the search
      totalMatches: number // total grep hits (capped at 10 files returned)
    }
  }
}
```

### Main Process Handlers

New handler file: `src/main/handlers/workbench.ts`

All AI-powered handlers shell out to the `claude` CLI in non-interactive mode. The binary path is resolved via the existing `AgentConfig` (`config:getAgentConfig`). Auth is handled by the CLI itself (uses the user's `claude login` session).

| Handler                      | Implementation                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench:chat`             | Runs `claude -p "<system + user message>" --output-format json` with form context injected as a system preamble. Parses JSON response.                                                                                                                  |
| `workbench:generateSpec`     | Runs `claude -p "<prompt from buildQuickSpecPrompt()>" --output-format text`. Returns the generated spec markdown. Uses `execFile` with argument array (no shell injection).                                                                            |
| `workbench:checkSpec`        | Runs `claude -p "<structured assessment prompt requesting JSON>" --output-format json`. Prompt asks for clarity/scope/files ratings. Parses JSON response with fallback to `{ status: 'warn', message: 'Unable to verify' }` on parse failure.          |
| `workbench:checkOperational` | No AI — aggregates: `checkAuthStatus()` + `getRepoPaths()` + `git status` (via execFile) + query `sprint_tasks` via Supabase for tasks with `status IN ('active', 'queued')` on the same repo + `agentManager.status()`.                                |
| `workbench:researchRepo`     | Runs `grep -rn` and `find` (via `execFile`) on the target repo path for terms extracted from the query. Returns up to 10 matching file paths with surrounding context lines (3 lines before/after each match). No AI involved — pure filesystem search. |

---

## Interaction Flows

### Flow 1: Quick Task (Title → Queue)

1. User opens workbench (N key or button)
2. Types title: "Fix toast z-index above SpecDrawer"
3. Clicks "✨ Generate Spec" → spec streams in
4. Structural checks: ✅ title, ✅ spec present, ✅ has structure
5. Semantic checks (auto-run after 2s): ✅ clear, ✅ reasonable scope
6. Clicks "Queue Now" → operational checks run → all pass → task created and queued

**Time:** ~30 seconds (vs. current: create → find in backlog → wait for spec → review → queue → launch = minutes)

### Flow 2: Complex Task with Research

1. User opens workbench
2. Types title: "Rewrite auth middleware for compliance"
3. Opens copilot, asks: "What files handle auth in BDE?"
4. Copilot responds with file list and explanations
5. User clicks "Insert into spec →" on relevant parts
6. User edits spec, adds structure
7. Semantic check warns: "Scope is broad — consider splitting"
8. User refines scope based on warning
9. Clicks "Save to Backlog" (wants to review more later)

### Flow 3: Edit Existing Task

1. User clicks "Edit" on a backlog task in Sprint Board
2. Workbench opens with form pre-filled
3. Readiness checks run immediately
4. User sees ❌ "Spec is too vague to execute"
5. Uses copilot to improve spec
6. Checks pass → clicks "Queue Now"

---

## Migration from NewTicketModal

### Deprecation Plan

1. **Phase 1 (this spec):** Build Task Workbench as a new view. Wire "+ New Task" button and N key to open workbench.
2. **Phase 2 (after validation):** Remove `NewTicketModal.tsx` and related CSS. Remove Quick/Template mode code from SprintCenter.
3. **TicketEditor** (agent output bulk creation) remains unchanged — it serves a different purpose (structured bulk import, not interactive authoring).

### What Stays the Same

- `useSprintTasks.createTask()` — the store action is unchanged. Workbench calls it with the same `CreateTicketInput` shape.
- `sprint:create` IPC handler — unchanged.
- `buildQuickSpecPrompt()` function in `sprint-spec.ts` — reused by the new `workbench:generateSpec` handler to construct the prompt fed to the `claude` CLI.
- Task status transitions — unchanged (backlog → queued → active → done).
- Sprint Board Kanban — unchanged, tasks still appear there after creation.

### What Changes

- **Entry point**: "+ New Task" opens a panel with TaskWorkbenchView instead of a modal.
- **N key shortcut**: Opens workbench panel instead of modal.
- **SpecDrawer "Edit" flow**: Opens workbench pre-filled instead of inline SpecDrawer editor.
- **Form state**: Moves from local `useState` in modal to a Zustand store (persistence across panel switches).

---

## Testing Strategy

### Unit Tests (vitest)

| Test                     | File                         | Coverage                                 |
| ------------------------ | ---------------------------- | ---------------------------------------- |
| Structural check logic   | `useReadinessChecks.test.ts` | All Tier 1 checks with edge cases        |
| Store actions            | `taskWorkbench.test.ts`      | setField, resetForm, loadTask, submit    |
| Check gating rules       | `ReadinessChecks.test.ts`    | Button disabled states per check results |
| Copilot message handling | `WorkbenchCopilot.test.ts`   | Send, receive, insert into spec          |

### Integration Tests (test:main)

| Test                                 | Coverage                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `workbench:checkSpec` handler        | Mock `claude` CLI output, verify JSON parse             |
| `workbench:checkOperational` handler | Mock auth/git/supabase, verify aggregation              |
| `workbench:chat` handler             | Mock `claude` CLI output, verify form context injection |
| `workbench:researchRepo` handler     | Mock filesystem, verify grep results                    |

### Manual Testing

- [ ] Create task via workbench, verify appears in Sprint Board backlog
- [ ] Generate spec via inline AI, verify streams into editor
- [ ] Copilot chat responds with context-aware answers
- [ ] "Insert into spec" transfers copilot content to editor
- [ ] Tier 1 checks update in real-time as form changes
- [ ] Tier 2 checks run after 2s debounce on spec edit
- [ ] Tier 3 checks run on Queue/Launch button click
- [ ] "Queue Now" disabled when required checks fail
- [ ] "Launch Immediately" disabled when semantic checks fail
- [ ] Warning override: "Queue Anyway" confirmation dialog
- [ ] Edit existing task pre-fills form correctly
- [ ] Copilot collapse/expand preserves message history
- [ ] Keyboard: N opens workbench, Escape closes, Cmd+Enter submits

---

## Error Handling

| Scenario                    | Behavior                                                                    |
| --------------------------- | --------------------------------------------------------------------------- |
| Spec generation fails       | Toast error, editor remains editable with current content                   |
| Copilot chat fails          | Error message in chat, user can retry                                       |
| Semantic check API fails    | Check shows "Unable to verify" (warn, not fail) — doesn't block             |
| Operational check fails     | Check shows specific error with remediation hint                            |
| Task create IPC fails       | Toast error, form state preserved (not cleared)                             |
| Auth expired during session | Operational check catches it, shows "Run `claude login` to re-authenticate" |

---

## Non-Goals (Explicit)

- **Spec version history** — Not tracking spec drafts. Git history on the task is sufficient.
- **Collaborative editing** — Single-user workbench only.
- **Offline mode** — Requires Supabase connectivity and `claude` CLI with valid auth.
- **Custom check plugins** — Checks are hardcoded. Extensibility can come later.
- **Spec preview (rendered markdown)** — The SpecDrawer already renders markdown. The workbench editor is for authoring, not previewing. Users can open SpecDrawer alongside if they want a preview.

---

## File Inventory

### New Files (11)

```
src/renderer/src/views/TaskWorkbenchView.tsx
src/renderer/src/components/task-workbench/TaskWorkbench.tsx
src/renderer/src/components/task-workbench/WorkbenchForm.tsx
src/renderer/src/components/task-workbench/WorkbenchCopilot.tsx
src/renderer/src/components/task-workbench/ReadinessChecks.tsx
src/renderer/src/components/task-workbench/WorkbenchActions.tsx
src/renderer/src/components/task-workbench/SpecEditor.tsx
src/renderer/src/components/task-workbench/InlineAiAction.tsx
src/renderer/src/stores/taskWorkbench.ts
src/renderer/src/hooks/useReadinessChecks.ts
src/main/handlers/workbench.ts
```

### Modified Files (7)

```
src/renderer/src/stores/panelLayout.ts                 — add 'task-workbench' view type
src/renderer/src/App.tsx                               — register TaskWorkbenchView in view map
src/renderer/src/components/sprint/SprintCenter.tsx    — replace NewTicketModal with workbench open
src/renderer/src/components/sprint/SprintToolbar.tsx   — update "+ New Task" to open workbench
src/shared/ipc-channels.ts                             — add WorkbenchChannels
src/preload/index.ts                                   — expose workbench API
src/main/index.ts                                      — register workbench handlers
```

### Deprecated (Phase 2 removal)

```
src/renderer/src/components/sprint/NewTicketModal.tsx  — replaced by TaskWorkbench
```
