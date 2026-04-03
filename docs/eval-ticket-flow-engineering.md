# Engineering Evaluation: Ticket Creation Flow

> **Author:** Engineering Eval (Claude)
> **Date:** 2026-03-16
> **Status:** PROPOSAL — ready for review
> **Companion docs:** [PM eval](eval-ticket-flow-pm.md) · [UX eval](eval-ticket-flow-ux.md)
> **Scope:** NewTicketModal, SpecDrawer, sprint IPC surface, AI integration, and the technical plan for Quick/Template/Design modes

---

## 1. Current State: What Exists Today

### 1.1 Component Inventory

| Component           | File                                                  | LOC  | Purpose                                                                    | State Model                   |
| ------------------- | ----------------------------------------------------- | ---- | -------------------------------------------------------------------------- | ----------------------------- |
| **SprintCenter**    | `src/renderer/src/components/sprint/SprintCenter.tsx` | ~250 | Root orchestrator — owns all sprint state, wires all IPC, renders layout   | Local `useState` (no Zustand) |
| **KanbanBoard**     | `…/sprint/KanbanBoard.tsx`                            | ~120 | `@dnd-kit` DnD context, 4 columns, drag overlay                            | Props only                    |
| **KanbanColumn**    | `…/sprint/KanbanColumn.tsx`                           | ~80  | Single droppable column, sortable context, motion animations               | Props + `useReducedMotion`    |
| **TaskCard**        | `…/sprint/TaskCard.tsx`                               | ~130 | Draggable card, action buttons by status, repo badge, spec dot             | Props only                    |
| **AgentStatusChip** | `…/sprint/AgentStatusChip.tsx`                        | ~50  | Live elapsed-time ticker for running agents                                | Props + `setInterval`         |
| **NewTicketModal**  | `…/sprint/NewTicketModal.tsx`                         | 255  | Modal form: title, repo, priority, template chips, spec textarea, Ask Paul | Local `useState`              |
| **SpecDrawer**      | `…/sprint/SpecDrawer.tsx`                             | ~300 | Slide-in spec viewer/editor, markdown renderer, Ask Paul, push-to-sprint   | Local `useState`              |
| **LogDrawer**       | `…/sprint/LogDrawer.tsx`                              | ~200 | Slide-in agent output viewer, steer input, stream-json parsing             | Local `useState` + polling    |
| **PRSection**       | `…/sprint/PRSection.tsx`                              | ~40  | Collapsible container for PRList                                           | `localStorage` toggle         |
| **PRList**          | `…/sprint/PRList.tsx`                                 | ~200 | Fetches open PRs via GitHub REST, merge button with confirmation           | Local `useState` + polling    |

### 1.2 IPC Surface (Sprint-Related)

| Channel                  | Direction            | Handler File                        | Preload Method                          | Wired?                                                                        |
| ------------------------ | -------------------- | ----------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `sprint:list`            | invoke               | `src/main/handlers/sprint.ts`       | `window.api.sprint.list()`              | Yes                                                                           |
| `sprint:create`          | invoke               | `sprint.ts`                         | `window.api.sprint.create(task)`        | Yes                                                                           |
| `sprint:update`          | invoke               | `sprint.ts`                         | `window.api.sprint.update(id, patch)`   | Yes                                                                           |
| `sprint:delete`          | invoke               | `sprint.ts`                         | **NOT exposed** in preload              | Handler exists, no preload method                                             |
| `sprint:read-spec-file`  | invoke               | `sprint.ts`                         | `window.api.sprint.readSpecFile(path)`  | Yes                                                                           |
| `sprint:readLog`         | invoke               | `sprint.ts`                         | `window.api.sprint.readLog(agentId)`    | Yes (return type mismatch: handler returns `nextByte`, preload type omits it) |
| `sprint:external-change` | push (main→renderer) | File watcher in `src/main/index.ts` | `window.api.onExternalSprintChange(cb)` | Yes                                                                           |
| `gateway:invoke`         | invoke               | `gateway-handlers.ts`               | `window.api.invokeTool(tool, args)`     | Yes — used by Ask Paul                                                        |

### 1.3 AI Integration — How "Ask Paul" Works Today

**NewTicketModal** (line 96-126):

```
User clicks "Ask Paul" →
  builds system prompt with title + repo + current notes →
  window.api.invokeTool('sessions_send', { sessionKey: 'main', message, timeoutSeconds: 30 }) →
  IPC to main process 'gateway:invoke' handler →
  HTTP POST to OpenClaw gateway /tools/invoke →
  gateway routes to main agent session →
  response: { ok, result: { content: [{ type, text }] } } →
  extract text → setSpec(text)
```

Key characteristics:

- **One-shot**: Single request/response. No conversation state.
- **Blocking**: UI shows "Generating..." / "Paul is writing your spec..." in textarea. No streaming.
- **Silent failure**: `catch {}` swallows all errors (line 121). User sees nothing on failure.
- **Session reuse**: Sends to `sessionKey: 'main'` — the main agent session. This pollutes the main session's conversation history.
- **Template-unaware**: The system prompt (line 100-106) does not include the selected template structure. Template selection and AI generation are independent paths.

**SpecDrawer** has an identical "Ask Paul" implementation with the same characteristics.

### 1.4 Template System

Templates are defined as a `const TEMPLATES: Record<string, { label: string; spec: string }>` in `NewTicketModal.tsx` (lines 25-50). Six templates: Feature, Bug Fix, Refactor, Audit, UX Polish, Infra.

- Selecting a template calls `setSpec(TEMPLATES[key].spec)` — **destructive overwrite**, no confirmation
- Toggling the same template again clears the spec to `''`
- Templates are not used by the AI generation prompt

### 1.5 Data Model

**`SprintTask`** (from `src/shared/types.ts`):

```typescript
interface SprintTask {
  id: string
  title: string
  repo: string
  prompt: string | null // Agent-facing instruction
  priority: number // 0=High, 1=Medium, 2=Low
  status: 'backlog' | 'queued' | 'active' | 'done'
  description: string | null // Dead field — never populated from UI
  spec: string | null // Markdown specification
  agent_run_id: string | null
  pr_number: number | null
  pr_status: 'open' | 'merged' | 'closed' | 'draft' | null
  pr_url: string | null
  column_order: number // Present in type but not used for ordering
  started_at: string | null
  completed_at: string | null
  updated_at: string
  created_at: string
}
```

**`CreateTaskInput`** (from `src/main/handlers/sprint.ts`):

```typescript
interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  description?: string
  spec?: string
  priority?: number
  status?: string
}
```

The `sprint:create` handler defaults `prompt` to `spec ?? title` if not provided. The `description` field is accepted but the `sprint_tasks` table does not have a `description` column — it has `notes` instead. The `description` value is silently dropped.

### 1.6 Store Architecture

**No Zustand store exists for sprint state.** All state lives in `SprintCenter` via `useState`:

- `tasks: SprintTask[]`
- `repoFilter: string | null`
- `selectedTask: SprintTask | null`
- `logDrawerTask: SprintTask | null`
- `loading: boolean`
- `modalOpen: boolean`
- `prMergedMap: Record<string, boolean>`

This means no other view can read sprint state. Cross-view coordination (e.g., Sessions view showing the current active task) is impossible without prop drilling or DOM events.

### 1.7 CSS Status

**No CSS rules exist for any `.new-ticket-modal__*` class.** Zero results from searching all `.css` files. The modal renders using:

- `.glass-modal` base class (from the design system)
- `.elevation-3` shadow class
- `.sprint-tasks__input` / `.sprint-tasks__select` (borrowed from an older sprint panel)
- Template chip active state (`.new-ticket-modal__chip--active`) has no style definition

The modal is functional only because the glass-modal base and browser defaults happen to produce a reasonable layout.

---

## 2. What Is Broken or Incomplete

### 2.1 Critical Issues

| Issue                           | Location                                                         | Impact                                                                   |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **No CSS for modal**            | Missing `.new-ticket-modal__*` rules in any stylesheet           | Layout depends on browser defaults; template chip active state invisible |
| **Ask Paul fails silently**     | `NewTicketModal.tsx:121` — empty `catch {}`                      | User waits up to 30s, sees nothing on failure                            |
| **Template + AI don't compose** | `NewTicketModal.tsx:100-106` — prompt ignores `selectedTemplate` | Template selection has no effect on AI-generated spec                    |
| **Main session pollution**      | `sessionKey: 'main'` in Ask Paul call                            | Spec generation messages appear in the main agent conversation history   |

### 2.2 Functional Gaps

| Gap                                   | Detail                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| **No quick-capture mode**             | Every ticket requires the full modal with all fields visible |
| **No conversational refinement**      | One-shot generation only; no way to iterate with Paul        |
| **No streaming**                      | Entire spec appears at once after up to 30s wait             |
| **No spec quality signal**            | No feedback on whether a spec is agent-ready                 |
| **No draft persistence**              | Closing the modal discards all work with no confirmation     |
| **Template overwrite is destructive** | Selecting a template replaces spec content with no undo      |
| **`sprint:delete` not in preload**    | Handler exists, no `window.api.sprint.delete()` method       |
| **`description` field is dead**       | Passed as `''` on create, never stored or displayed          |
| **`column_order` unused**             | In the type but not used for within-column ordering          |

---

## 3. Technical Plan: Three Ticket Creation Modes

### 3.1 Mode Architecture Overview

The existing `NewTicketModal` becomes a **mode container** with three tab states:

```
NewTicketModal (mode container)
├── QuickModeContent      — title + repo → auto-spec
├── TemplateModeContent   — current form, refined
└── DesignModeContent     — split-panel chat + spec preview
```

A new local state `mode: 'quick' | 'template' | 'design'` controls which content component renders. The mode tabs are always visible at the top. Default mode: `quick`.

The modal's outer shell (overlay, animation, header, close button) stays the same. Only the body content switches by mode.

---

### 3.2 QUICK MODE — "Capture and Go"

#### Behavior

1. User sees only: title input (auto-focused) + repo select + "Save to Backlog" button
2. Priority defaults to `1` (Medium), not user-visible
3. On submit: `sprint:create` fires with `{ title, repo, prompt: title, priority: 1 }`
4. Card appears in Backlog immediately (optimistic)
5. **Background spec generation**: After the task is created and the modal closes, a new IPC call `sprint:generatePrompt` fires asynchronously. The card shows a shimmer/loading badge until the spec arrives.
6. When the generated spec returns, `sprint:update(taskId, { spec, prompt })` persists it. The card badge clears.

#### New IPC Handler: `sprint:generatePrompt`

```typescript
// Channel: sprint:generatePrompt
// File: src/main/handlers/sprint.ts

interface GeneratePromptInput {
  taskId: string
  title: string
  repo: string
  templateHint?: string // auto-detected from title heuristics
}

interface GeneratePromptResult {
  taskId: string
  spec: string
  prompt: string
}
```

**Implementation:**

- Main process handler receives the request
- Reads gateway config, POSTs to `/tools/invoke` with tool `sessions_send`
- System prompt includes: title, repo, detected template structure (from heuristic), instruction to output spec markdown
- Uses a **dedicated ephemeral message** (not `sessionKey: 'main'`) — sends with `sessionKey: 'bde-spec-gen'` or uses `sessions_spawn` with `mode: 'run'` to avoid polluting the main session
- Returns the generated spec text
- On failure, returns `{ taskId, spec: '', prompt: title }` — the task remains with `prompt = title`, no data loss

**Title Heuristic → Template Mapping:**

```typescript
// File: src/shared/template-heuristics.ts (new, ~30 LOC)

const HEURISTIC_RULES: Array<{ keywords: string[]; template: string }> = [
  { keywords: ['fix', 'bug', 'broken', 'crash', 'error'], template: 'bugfix' },
  { keywords: ['add', 'new', 'create', 'implement', 'build'], template: 'feature' },
  { keywords: ['refactor', 'extract', 'move', 'rename', 'clean'], template: 'refactor' },
  { keywords: ['test', 'coverage', 'spec'], template: 'test' },
  { keywords: ['perf', 'slow', 'optimize', 'cache', 'latency'], template: 'performance' },
  { keywords: ['style', 'css', 'ui', 'ux', 'polish', 'design'], template: 'ux' },
  { keywords: ['audit', 'review', 'check'], template: 'audit' },
  { keywords: ['infra', 'deploy', 'ci', 'config', 'script'], template: 'infra' }
]

export function detectTemplate(title: string): string {
  const lower = title.toLowerCase()
  for (const rule of HEURISTIC_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.template
  }
  return 'feature' // default
}
```

#### Component: `QuickModeContent`

Not a new file — implemented as a conditional render block inside `NewTicketModal.tsx`, gated by `mode === 'quick'`. Approximately 30 lines of JSX (title input, repo select, submit button).

#### Card Loading State

`TaskCard.tsx` needs a minor addition: when a task has `prompt === title` and `spec === null`, show a subtle shimmer or "Spec generating..." badge. This clears automatically when the next poll picks up the updated task.

Alternatively, SprintCenter can track `generatingTaskIds: Set<string>` in local state and pass it down. When `sprint:generatePrompt` resolves, remove the ID from the set and call `sprint:update`.

---

### 3.3 TEMPLATE MODE — "Structured Spec Builder"

#### Changes from Current Behavior

Template Mode is the current NewTicketModal behavior with three fixes:

**Fix 1: Template-aware AI generation**

When a template is selected and the user clicks "Ask Paul", the system prompt includes the template scaffold:

```typescript
// In handleAskPaul():
const templateStructure = selectedTemplate ? TEMPLATES[selectedTemplate].spec : null

const systemPrompt = templateStructure
  ? `You are writing a spec for a ${TEMPLATES[selectedTemplate!].label} task.
Use EXACTLY this structure:
${templateStructure}

Fill in each section based on:
- Title: "${title}"
- Repo: ${repo}
- User's notes: ${spec || '(none)'}

Be specific. Name exact files. Describe exact changes. Output only the spec markdown.`
  : `You are a senior engineer writing a coding agent spec...` // current freeform prompt
```

This is a **prompt change only** — no new IPC, no new components.

**Fix 2: Destructive overwrite confirmation**

When the user has edited the spec (dirty state) and clicks a template chip, show a lightweight inline confirmation:

```typescript
const handleSelectTemplate = (key: string) => {
  if (selectedTemplate === key) {
    setSelectedTemplate(null)
    setSpec('')
    return
  }
  if (spec.trim() && spec !== TEMPLATES[selectedTemplate ?? '']?.spec) {
    if (!confirm('Replace current spec with template?')) return
  }
  setSelectedTemplate(key)
  setSpec(TEMPLATES[key].spec)
}
```

This uses the native `confirm()` dialog for simplicity. A custom inline confirmation can be added later.

**Fix 3: Error feedback for Ask Paul**

Replace the silent `catch {}` with a toast:

```typescript
catch (err) {
  toast.error('Spec generation failed — try again')
}
```

#### Template Roster Expansion

Add two new templates to the `TEMPLATES` const:

```typescript
test: {
  label: 'Test Coverage',
  spec: `## What to Test\n<!-- Component or module under test -->\n\n## Test Strategy\n<!-- Unit / integration / e2e -->\n\n## Files to Create\n\n## Coverage Target\n\n## Out of Scope`,
},
performance: {
  label: 'Performance',
  spec: `## What's Slow\n<!-- Describe the bottleneck -->\n\n## Current Metrics\n<!-- Before measurement -->\n\n## Target Metrics\n<!-- After target -->\n\n## Approach\n\n## Files to Change\n\n## How to Verify`,
},
```

#### Component Impact

No new components. Changes are confined to `NewTicketModal.tsx`:

- Add mode tabs at the top of the modal body
- Gate the full form (repo, priority, templates, spec, Ask Paul) behind `mode === 'template'`
- Fix the three issues above

---

### 3.4 DESIGN MODE — "Conversational Spec Design with Paul"

#### Architecture

Design Mode renders a split-panel layout inside the modal: chat thread on the left, live spec preview on the right. The conversation is ephemeral — stored in component state, discarded on close or save.

```
DesignModeContent (local state owner)
├── DesignChat (left panel)
│   ├── message list (scrollable)
│   └── input bar (Enter to send, Shift+Enter for newline)
└── DesignSpecPreview (right panel)
    └── rendered markdown (same renderer as SpecDrawer)
```

#### Conversation State

```typescript
interface DesignMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// In DesignModeContent:
const [messages, setMessages] = useState<DesignMessage[]>([OPENING_MESSAGE])
const [specDraft, setSpecDraft] = useState('')
const [sending, setSending] = useState(false)
const [title, setTitle] = useState('')
```

**`OPENING_MESSAGE`** is a static assistant message — no AI call needed:

```typescript
const OPENING_MESSAGE: DesignMessage = {
  role: 'assistant',
  content:
    'What are you thinking about building? Describe the feature or problem in your own words.',
  timestamp: Date.now()
}
```

#### AI Transport

Each user message sends the **full conversation history** to the gateway:

```typescript
const sendDesignMessage = async (userText: string) => {
  const updated = [...messages, { role: 'user', content: userText, timestamp: Date.now() }]
  setMessages(updated)
  setSending(true)

  const systemPrompt = buildDesignSystemPrompt(repo)
  const conversationText = updated
    .map((m) => `${m.role === 'user' ? 'User' : 'Paul'}: ${m.content}`)
    .join('\n\n')

  const fullMessage = `${systemPrompt}\n\n---\n\nConversation so far:\n${conversationText}\n\nPaul:`

  try {
    const result = await window.api.invokeTool('sessions_send', {
      sessionKey: 'bde-design-mode', // dedicated session, not 'main'
      message: fullMessage,
      timeoutSeconds: 30
    })
    const text = result?.result?.content?.[0]?.text ?? ''
    if (text) {
      setMessages((prev) => [...prev, { role: 'assistant', content: text, timestamp: Date.now() }])
      extractSpec(text) // parse spec from response
    }
  } catch {
    toast.error('Paul is unavailable — try again')
  } finally {
    setSending(false)
  }
}
```

**Why `sessions_send` and not `chat.send` (WebSocket)?**

`sessions_send` is the existing one-shot IPC path used by both NewTicketModal and SpecDrawer today. It requires no new infrastructure. The WebSocket `chat.send` path is used by `MessageInput` for live streaming in SessionsView, but Design Mode doesn't need streaming for v1 — the responses are short (2-3 paragraphs). If streaming is desired later, we can switch to `chat.send` via `GatewayClient`.

**Dedicated session key:** Using `sessionKey: 'bde-design-mode'` instead of `'main'` prevents polluting the main agent conversation. The gateway treats this as a separate ephemeral session. If the session doesn't exist, the gateway creates it on first message.

#### Spec Extraction

Paul's responses may contain spec markdown. The right panel needs to extract and display the latest spec. Two approaches:

**Approach A — Fenced block convention (recommended for v1):**

The system prompt instructs Paul to wrap specs in a `~~~spec` fence:

```
When you propose a spec, wrap it in a ~~~spec fence block. Example:
~~~spec
## Problem
...
## Solution
...
~~~
```

Extraction:

```typescript
function extractSpec(assistantText: string): void {
  const match = assistantText.match(/~~~spec\n([\s\S]*?)~~~/)
  if (match?.[1]) {
    setSpecDraft(match[1].trim())
  }
}
```

The right panel renders `specDraft` using the same `renderMarkdown` function from SpecDrawer (or a shared version extracted to a utility).

**Approach B — Structured JSON output:**

Not recommended for v1. Adds complexity without clear benefit. The fenced block approach is simpler and more reliable with current LLM output.

#### System Prompt

```typescript
function buildDesignSystemPrompt(repo: string): string {
  return `You are Paul, a senior product engineer helping design a coding task for BDE (Birkeland Development Environment).

Your job: understand what the user wants to build, ask 2-3 clarifying questions, then propose a spec. Be concise.

Guidelines:
- Ask about: scope (in/out), data model, files affected, edge cases
- Max 3 questions per turn
- After 2-3 user messages, propose a full spec
- Wrap specs in a ~~~spec fence block
- Use the appropriate template structure (Feature, Bug Fix, Refactor, etc.)
- Be specific: name exact files, describe exact changes
- Target repo: ${repo}
- When the user requests changes, output the FULL updated spec (not a diff)
- Propose a concise ticket title in your spec proposal

Do not ask for confirmation to proceed — just do it.`
}
```

#### Auto-Title Extraction

When Paul proposes a spec, the response should include a suggested title. Extract it:

```typescript
// Look for "Title: ..." or "## Title\n..." in the response
function extractTitle(assistantText: string): string | null {
  const match = assistantText.match(/(?:Title|Ticket):\s*(.+)/i)
  return match?.[1]?.trim() ?? null
}
```

The extracted title populates a title field in the Design Mode footer. The user can edit it before saving.

#### Save Flow

"Save Spec to Backlog" button:

```typescript
const handleDesignSave = () => {
  const finalTitle = title.trim() || 'Untitled task'
  onCreate({
    title: finalTitle,
    repo,
    description: '',
    spec: specDraft,
    priority
  })
  onClose()
}
```

The button is disabled when `specDraft` is empty (Paul hasn't proposed a spec yet).

#### Discard Confirmation

When `messages.length > 1` (user has sent at least one message) and the user clicks close or Escape:

```typescript
if (mode === 'design' && messages.length > 1) {
  if (!confirm('Discard this design conversation?')) return
}
onClose()
```

---

## 4. IPC Changes

### 4.1 New Handlers

| Channel                 | File                          | Parameters                               | Return                     | Purpose                                   |
| ----------------------- | ----------------------------- | ---------------------------------------- | -------------------------- | ----------------------------------------- |
| `sprint:generatePrompt` | `src/main/handlers/sprint.ts` | `{ taskId, title, repo, templateHint? }` | `{ taskId, spec, prompt }` | Background spec generation for Quick Mode |

Implementation: The handler calls the gateway `/tools/invoke` endpoint directly from the main process (same pattern as `gateway:invoke`), using `sessions_send` with `sessionKey: 'bde-spec-gen'`. This avoids round-tripping through the renderer for background generation.

### 4.2 New Preload Exposures

| Method                                   | Channel                 | Parameters                                                               |
| ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `window.api.sprint.generatePrompt(args)` | `sprint:generatePrompt` | `{ taskId: string, title: string, repo: string, templateHint?: string }` |
| `window.api.sprint.delete(id)`           | `sprint:delete`         | `id: string`                                                             |

The `sprint.delete()` exposure is a gap fix — the handler already exists but has no preload method.

### 4.3 Modified Handlers

None. The existing `sprint:create` and `sprint:update` handlers are sufficient. The `gateway:invoke` handler already supports arbitrary tool calls.

---

## 5. Store Changes

### 5.1 No New Zustand Store Required for v1

The three modes can be implemented entirely with local `useState` inside `NewTicketModal`. This matches the existing pattern — SprintCenter and all sprint components use local state exclusively.

### 5.2 SprintCenter Local State Additions

```typescript
// Track tasks with background spec generation in progress
const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
```

This set is passed to `KanbanBoard` → `KanbanColumn` → `TaskCard` so cards can show a loading indicator.

### 5.3 Future: Sprint Zustand Store (Out of Scope)

Extracting sprint state to a Zustand store (`src/renderer/src/stores/sprint.ts`) would enable:

- Cross-view access to active task state
- Shared `generatingIds` without prop drilling
- Cleaner separation of data-fetching from rendering

This is architectural improvement and should be its own PR after the three modes ship.

---

## 6. Component Breakdown

### 6.1 Modified Components

| Component              | Changes                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NewTicketModal.tsx** | Add mode tabs (`quick` / `template` / `design`), gate form sections by mode, fix template-aware Ask Paul prompt, add error toast on Ask Paul failure, add template overwrite confirmation, add Test Coverage and Performance templates, render `QuickModeContent` or `DesignModeContent` by mode |
| **SprintCenter.tsx**   | Add `generatingIds` state, wire `sprint:generatePrompt` call after Quick Mode create, pass `generatingIds` to KanbanBoard                                                                                                                                                                        |
| **TaskCard.tsx**       | Add shimmer/badge when `generatingIds.has(task.id)`                                                                                                                                                                                                                                              |

### 6.2 New Components

| Component             | File                                                       | Purpose                                         | LOC Estimate        |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ------------------- |
| **DesignModeContent** | `src/renderer/src/components/sprint/DesignModeContent.tsx` | Split-panel chat + spec preview for Design Mode | ~200                |
| **DesignChat**        | Inline in DesignModeContent (not a separate file)          | Message list + input bar                        | ~80 (part of above) |
| **DesignSpecPreview** | Inline in DesignModeContent (not a separate file)          | Rendered markdown preview panel                 | ~40 (part of above) |

`DesignModeContent` is the only new file. The chat message list and spec preview are simple enough to be inline JSX blocks, not separate components. If the file exceeds 300 LOC, split then.

### 6.3 New Shared Utilities

| File                                | Purpose                                              | LOC Estimate |
| ----------------------------------- | ---------------------------------------------------- | ------------ |
| `src/shared/template-heuristics.ts` | `detectTemplate(title)` — keyword → template mapping | ~30          |

The `TEMPLATES` const stays in `NewTicketModal.tsx` — it's only used there and in the system prompt for Ask Paul. Moving it to a shared file is premature until a second consumer exists.

---

## 7. Files to Change (Explicit List)

### New Files

| File                                                       | Purpose                                 |
| ---------------------------------------------------------- | --------------------------------------- |
| `src/renderer/src/components/sprint/DesignModeContent.tsx` | Design Mode split-panel UI              |
| `src/shared/template-heuristics.ts`                        | Title heuristic → template type mapping |

### Modified Files

| File                                                    | What Changes                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/NewTicketModal.tsx` | Mode tabs, Quick/Template/Design content switching, template-aware Ask Paul prompt, error toast, overwrite confirmation, 2 new templates |
| `src/renderer/src/components/sprint/SprintCenter.tsx`   | `generatingIds` state, `handleQuickCreate` with background `sprint:generatePrompt` call, pass `generatingIds` to children                |
| `src/renderer/src/components/sprint/TaskCard.tsx`       | Accept `isGenerating?: boolean` prop, render shimmer/badge                                                                               |
| `src/renderer/src/components/sprint/KanbanBoard.tsx`    | Pass-through `generatingIds` prop to KanbanColumn                                                                                        |
| `src/renderer/src/components/sprint/KanbanColumn.tsx`   | Pass-through `generatingIds` prop to TaskCard                                                                                            |
| `src/main/handlers/sprint.ts`                           | Add `sprint:generatePrompt` handler                                                                                                      |
| `src/preload/index.ts`                                  | Add `sprint.generatePrompt()` and `sprint.delete()` methods                                                                              |
| `src/preload/index.d.ts`                                | Type declarations for new preload methods                                                                                                |

### CSS (New or Modified)

| File                                                     | What                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Existing sprint CSS file (or new `new-ticket-modal.css`) | All `.new-ticket-modal__*` class rules: mode tabs, template chip active state, spec editor, Design Mode split-panel layout |

### Test Files (New or Modified)

| File                                                                            | What                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/__tests__/NewTicketModal.test.tsx`          | Add tests for: mode switching, Quick Mode submit, template-aware Ask Paul, error toast, overwrite confirmation |
| `src/renderer/src/components/sprint/__tests__/DesignModeContent.test.tsx` (new) | Conversation flow, spec extraction, save, discard confirmation                                                 |
| `src/shared/__tests__/template-heuristics.test.ts` (new)                        | `detectTemplate` keyword matching                                                                              |

---

## 8. Implementation Sequence

### Phase 1: Template Mode Fixes (1 PR)

1. Fix Ask Paul prompt to include selected template structure
2. Add error toast on Ask Paul failure
3. Add template overwrite confirmation
4. Add Test Coverage and Performance templates
5. Add CSS for `.new-ticket-modal__*` classes (all modal styling)
6. Update existing tests

**Risk:** Low. Prompt and UI changes only. No new IPC.

### Phase 2: Mode Tabs + Quick Mode (1 PR)

1. Add mode tab switcher UI to NewTicketModal
2. Implement Quick Mode content (title + repo only)
3. Add `sprint:generatePrompt` handler + preload exposure
4. Wire background spec generation in SprintCenter
5. Add `isGenerating` shimmer to TaskCard
6. Add `sprint.delete()` preload exposure (gap fix, while touching preload)
7. Add `src/shared/template-heuristics.ts`
8. Write tests

**Risk:** Medium. New IPC handler. Background async flow. Need to handle gateway unavailability gracefully.

**Dependency:** Phase 1 (for template-aware prompt reuse in `sprint:generatePrompt`).

### Phase 3: Design Mode (1 PR)

1. Create `DesignModeContent.tsx` with split-panel layout
2. Implement conversation state + AI send flow
3. Implement spec extraction (fenced block parsing)
4. Implement auto-title extraction
5. Add discard confirmation on close
6. CSS for split-panel layout
7. Write tests

**Risk:** Medium-high. Conversation UX is novel for this codebase. Prompt engineering for Paul's conversational flow needs iteration. Gateway latency may make the experience feel slow without streaming.

**Dependency:** Phase 2 (for mode tabs infrastructure).

---

## 9. Out of Scope for First PR

- **Streaming responses** — `sessions_send` is request/response. Streaming requires switching to `chat.send` via WebSocket and managing partial message state. Valuable but adds complexity.
- **Repo context injection** — Fetching file tree to include in Paul's system prompt. Adds latency and token cost. Save for v2.
- **Sprint Zustand store extraction** — Architectural improvement, not a prerequisite.
- **Markdown preview toggle in Template Mode** — The SpecDrawer already has a rendered view. Adding a preview toggle to the modal is a nice-to-have.
- **Draft persistence (localStorage)** — Prevents accidental loss on modal close. Low effort but separate concern.
- **Duplicate title detection** — Low urgency with a small task count.
- **Section-by-section spec refinement** — Complex interaction model for Template Mode. Design Mode covers this use case conversationally.
- **Spec quality scoring** — Analyzing spec completeness and providing a readiness signal. Requires defining quality criteria and running analysis. Future feature.
- **`column_order` persistence** — The DB column exists but within-column reorder is not persisted. Separate ticket.
- **`description` / `notes` field cleanup** — Dead fields in the data model. Housekeeping, not blocking.

---

## 10. Decision Log

| Decision                                                           | Rationale                                                                                                                    | Alternative Considered                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Local state, not Zustand** for mode + conversation               | Matches existing sprint architecture (all local state). Avoids premature abstraction.                                        | Zustand sprint store — deferred to future PR.                                 |
| **`sessions_send` for Design Mode AI** (not WebSocket `chat.send`) | Zero new infrastructure. One-shot is sufficient for 2-3 paragraph responses.                                                 | `chat.send` via GatewayClient — needed only if streaming is required.         |
| **Dedicated session keys** (`bde-spec-gen`, `bde-design-mode`)     | Prevents polluting main agent session history. Gateway creates sessions lazily.                                              | Reuse `main` session — rejected due to history pollution.                     |
| **`sprint:generatePrompt` in main process**                        | Background generation should not depend on the renderer staying open. Main process can complete the HTTP call independently. | Renderer-side `invokeTool` — works but ties generation to renderer lifecycle. |
| **Fenced block spec extraction** (not structured JSON)             | Simpler, more robust with current LLM output. JSON parsing from LLM output is fragile.                                       | Structured JSON with schema — over-engineered for v1.                         |
| **Single new component file** (`DesignModeContent.tsx`)            | Under 300 LOC estimate. Split only if it grows.                                                                              | Separate files for chat/preview — premature decomposition.                    |
| **`confirm()` for destructive actions**                            | Native, zero dependencies, adequate for solo-dev tool.                                                                       | Custom modal — adds component count without proportional UX benefit.          |
| **Template heuristics in shared**                                  | Used by both renderer (auto-suggest) and main (background generation).                                                       | Inline in each file — violates DRY.                                           |
