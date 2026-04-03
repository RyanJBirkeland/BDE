# TF-S2: Mode Tabs + Quick Mode

**Epic:** Ticket Flow  
**Phase:** 2 of 3  
**Depends on:** TF-S1 merged  
**Status:** Ready to implement

## Problem

There's no fast path for capturing a task idea. Every ticket requires the full modal with all fields. Ryan should be able to fire "Fix the toast z-index" in 3 seconds and move on — Paul writes the spec in the background. Currently that's impossible; the only path is the full form.

## Solution

Add a 3-tab mode switcher to `NewTicketModal`. Implement **Quick Mode** as the default tab: title + repo only, auto-spec generated in the background after save. The other two tabs (Template = current form, Design = coming in TF-S3) are added as tabs but Template tab just renders the existing form and Design tab renders a placeholder.

Also fix 2 existing gaps: add `sprint:generatePrompt` IPC handler, expose `sprint.delete()` in preload.

## Data / RPC Shapes

### New IPC: `sprint:generatePrompt`

**Handler file:** `src/main/handlers/sprint.ts`

```typescript
// Request
interface GeneratePromptRequest {
  taskId: string
  title: string
  repo: string
  templateHint: string // from detectTemplate(title) — never undefined
}

// Response
interface GeneratePromptResponse {
  taskId: string
  spec: string // may be '' on failure — never throws
  prompt: string // always has a value: generated spec or fallback to title
}
```

**Transport:** Main process makes HTTP POST directly to OpenClaw gateway `/tools/invoke`. Uses `sessions_send` tool with `sessionKey: 'bde-spec-gen'` (ephemeral session, NOT 'main'). This runs entirely in the main process — no round-trip through the renderer for background generation.

**Gateway call shape:**

```typescript
const body = {
  tool: 'sessions_send',
  args: {
    sessionKey: 'bde-spec-gen',
    message: buildQuickSpecPrompt(title, repo, templateHint),
    timeoutSeconds: 45
  }
}
const response = await fetch(`${gatewayUrl}/tools/invoke`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})
```

**Failure contract:** Handler MUST NOT throw. On any error (network, timeout, gateway down), return `{ taskId, spec: '', prompt: title }`. The task already exists in SQLite with `prompt = title` — generation failure just leaves the spec empty. No data loss.

### New preload: `sprint.generatePrompt()`

**File:** `src/preload/index.ts`

```typescript
// Add to sprint object:
generatePrompt: (args: { taskId: string; title: string; repo: string; templateHint: string }) =>
  ipcRenderer.invoke('sprint:generatePrompt', args),
```

**File:** `src/preload/index.d.ts`

```typescript
// Add to sprint interface:
generatePrompt(args: { taskId: string; title: string; repo: string; templateHint: string }): Promise<{
  taskId: string
  spec: string
  prompt: string
}>
```

## Exact Changes

### 1. New shared utility: `src/shared/template-heuristics.ts`

Create this file exactly:

```typescript
// Maps ticket title keywords to template types for auto-detection
// Used by: renderer (tab auto-suggest), main process (background spec generation)

const HEURISTIC_RULES: ReadonlyArray<{ keywords: readonly string[]; template: string }> = [
  { keywords: ['fix', 'bug', 'broken', 'crash', 'error', 'revert'], template: 'bugfix' },
  {
    keywords: ['add', 'new', 'create', 'implement', 'build', 'wire', 'integrate'],
    template: 'feature'
  },
  {
    keywords: ['refactor', 'extract', 'move', 'rename', 'clean', 'decompose', 'split'],
    template: 'refactor'
  },
  { keywords: ['test', 'coverage', 'spec', 'vitest', 'playwright', 'e2e'], template: 'test' },
  {
    keywords: ['perf', 'slow', 'optimize', 'cache', 'latency', 'debounce', 'memo'],
    template: 'performance'
  },
  {
    keywords: ['style', 'css', 'ui', 'ux', 'polish', 'design', 'layout', 'modal', 'animation'],
    template: 'ux'
  },
  { keywords: ['audit', 'review', 'check', 'eval', 'investigate'], template: 'audit' },
  {
    keywords: ['infra', 'deploy', 'ci', 'config', 'script', 'workflow', 'launchd'],
    template: 'infra'
  }
]

export function detectTemplate(title: string): string {
  const lower = title.toLowerCase()
  for (const rule of HEURISTIC_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.template
  }
  return 'feature'
}
```

### 2. `src/main/handlers/sprint.ts` — Add `sprint:generatePrompt` handler

Find where the existing sprint IPC handlers are registered (look for `ipcMain.handle('sprint:list', ...)` or similar registration pattern in sprint.ts).

Add this new handler in the same registration section:

```typescript
ipcMain.handle(
  'sprint:generatePrompt',
  async (_event, args: GeneratePromptRequest): Promise<GeneratePromptResponse> => {
    const { taskId, title, repo, templateHint } = args
    const fallback: GeneratePromptResponse = { taskId, spec: '', prompt: title }

    try {
      const { url: gatewayUrl, token: gatewayToken } = await getGatewayConfig()

      const templateScaffold = getTemplateScaffold(templateHint)
      const message = buildQuickSpecPrompt(title, repo, templateHint, templateScaffold)

      const response = await fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tool: 'sessions_send',
          args: { sessionKey: 'bde-spec-gen', message, timeoutSeconds: 45 }
        })
      })

      if (!response.ok) return fallback

      const data = (await response.json()) as {
        result?: { content?: Array<{ type: string; text: string }> }
      }
      const text = data.result?.content?.[0]?.text ?? ''
      if (!text) return fallback

      // Persist the generated spec + prompt to SQLite
      const db = getDb()
      db.prepare('UPDATE sprint_tasks SET spec = ?, prompt = ? WHERE id = ?').run(
        text,
        text,
        taskId
      )

      return { taskId, spec: text, prompt: text }
    } catch {
      return fallback
    }
  }
)
```

**Helper functions to add in sprint.ts:**

```typescript
function buildQuickSpecPrompt(
  title: string,
  repo: string,
  templateHint: string,
  scaffold: string
): string {
  return `You are writing a coding agent spec. Be precise. Name exact files. No preamble.

Task: "${title}"
Repo: ${repo}
Type: ${templateHint}

${scaffold ? `Use this structure:\n${scaffold}` : 'Use sections: Problem, Solution, Files to Change, Out of Scope'}

Rules:
- Exact file paths (e.g. src/renderer/src/components/sprint/SprintCenter.tsx)
- Exact code changes (not "update the function" but "add X to Y")
- Out of Scope: 2-3 bullet points max
- Output ONLY the spec markdown. No commentary.`
}

function getTemplateScaffold(templateHint: string): string {
  const SCAFFOLDS: Record<string, string> = {
    bugfix: `## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test`,
    feature: `## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope`,
    refactor: `## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope`,
    test: `## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n\n## Out of Scope`,
    performance: `## What's Slow\n\n## Approach\n\n## Files to Change\n\n## How to Verify`,
    ux: `## UX Problem\n\n## Target Design\n\n## Files to Change (CSS + TSX)\n\n## Out of Scope`,
    audit: `## Audit Scope\n\n## Criteria\n\n## Deliverable`,
    infra: `## What's Being Changed\n\n## Steps\n\n## Verification`
  }
  return SCAFFOLDS[templateHint] ?? SCAFFOLDS.feature
}
```

**Note:** Check how `getGatewayConfig()` and `getDb()` are called in the existing sprint.ts handlers. Use the exact same pattern — don't reinvent it. The gateway config fetch should already be in the file or imported.

### 3. `src/preload/index.ts` — Add generatePrompt + delete exposures

Find the `sprint` object in the preload (where `sprint.list`, `sprint.create`, etc. are exposed).

Add:

```typescript
generatePrompt: (args: { taskId: string; title: string; repo: string; templateHint: string }) =>
  ipcRenderer.invoke('sprint:generatePrompt', args),
delete: (id: string) => ipcRenderer.invoke('sprint:delete', id),
```

Also update `src/preload/index.d.ts` with matching type declarations (follow the existing pattern for other sprint methods).

### 4. `src/renderer/src/components/sprint/NewTicketModal.tsx` — Mode tabs + Quick Mode

#### 4a. Add mode state

At the top of the component, add:

```typescript
type TicketMode = 'quick' | 'template' | 'design'
const [mode, setMode] = useState<TicketMode>('quick')
```

#### 4b. Add mode tab switcher UI

In the modal body, BEFORE the existing form fields, add a tab switcher. Insert after the modal header and before the first form field:

```tsx
{
  /* Mode tabs */
}
;<div className="new-ticket-modal__tabs">
  <button
    className={`new-ticket-modal__tab ${mode === 'quick' ? 'new-ticket-modal__tab--active' : ''}`}
    onClick={() => setMode('quick')}
    type="button"
  >
    ⚡ Quick
  </button>
  <button
    className={`new-ticket-modal__tab ${mode === 'template' ? 'new-ticket-modal__tab--active' : ''}`}
    onClick={() => setMode('template')}
    type="button"
  >
    📋 Template
  </button>
  <button
    className={`new-ticket-modal__tab ${mode === 'design' ? 'new-ticket-modal__tab--active' : ''}`}
    onClick={() => setMode('design')}
    type="button"
  >
    🎨 Design with Paul
  </button>
</div>
```

#### 4c. Quick Mode body

Wrap the existing form fields with `{mode === 'template' && (...)}` so they only show in Template mode.

Add a new Quick Mode body that shows when `mode === 'quick'`:

```tsx
{
  mode === 'quick' && (
    <div className="new-ticket-modal__quick">
      <div className="new-ticket-modal__field">
        <label className="new-ticket-modal__label">What needs to happen? *</label>
        <input
          ref={titleRef}
          className="sprint-tasks__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
          placeholder='e.g. "Fix toast z-index above SpecDrawer"'
          autoFocus
        />
      </div>
      <div className="new-ticket-modal__field">
        <label className="new-ticket-modal__label">Repo</label>
        <select
          className="sprint-tasks__select"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="bde">BDE</option>
          <option value="life-os">life-os</option>
          <option value="feast">feast</option>
        </select>
      </div>
      <p className="new-ticket-modal__quick-hint">
        Paul will write the spec in the background. Review it in SpecDrawer before launching.
      </p>
    </div>
  )
}
```

#### 4d. Design Mode placeholder

```tsx
{
  mode === 'design' && (
    <div className="new-ticket-modal__design-placeholder">
      <p>🎨 Design with Paul is coming soon.</p>
      <p>Use Template mode for now — switch tabs above.</p>
    </div>
  )
}
```

#### 4e. Footer submit button text by mode

```tsx
// In the footer submit button:
<button className="btn btn--primary" onClick={handleSubmit} disabled={!title.trim()}>
  {mode === 'quick' ? '⚡ Save — Paul writes the spec' : 'Save to Backlog'}
</button>
```

#### 4f. handleSubmit — Quick Mode path

Modify `handleSubmit` to handle Quick Mode differently:

```typescript
const handleSubmit = async () => {
  if (!title.trim()) return

  if (mode === 'quick') {
    // Create the task with prompt = title (spec generated in background by SprintCenter)
    onCreate({
      title: title.trim(),
      repo,
      description: '',
      prompt: title.trim(),
      spec: null,
      priority: 1 // Medium — not user-visible in Quick mode
    })
    onClose()
    return
  }

  // Template mode (existing behavior)
  onCreate({
    title: title.trim(),
    repo,
    description: '',
    prompt: spec || title.trim(),
    spec: spec || null,
    priority
  })
  onClose()
}
```

### 5. `src/renderer/src/components/sprint/SprintCenter.tsx` — Background spec gen

#### 5a. Add `generatingIds` state

```typescript
const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
```

#### 5b. Modify `handleCreateTask` to trigger background generation for Quick Mode tasks

Find the existing `handleCreateTask` (or `onCreate`) callback. After a task is created and added to the tasks list, check if it came from Quick Mode (it has `spec: null`):

```typescript
const handleCreateTask = useCallback(async (input: CreateTaskInput) => {
  // ... existing optimistic insert + sprint:create call ...
  const created = await window.api.sprint.create(input)
  // ... existing setTasks update ...

  // Trigger background spec generation for Quick Mode tasks (no spec yet)
  if (!input.spec && created?.id) {
    const { detectTemplate } = await import('../../shared/template-heuristics') // dynamic import fine here
    // OR: import at top of file if preferred
    const templateHint = detectTemplate(input.title)

    setGeneratingIds((prev) => new Set(prev).add(created.id))

    window.api.sprint
      .generatePrompt({
        taskId: created.id,
        title: input.title,
        repo: input.repo,
        templateHint
      })
      .then((result) => {
        // Update local task state with generated spec
        setTasks((prev) =>
          prev.map((t) =>
            t.id === result.taskId ? { ...t, spec: result.spec || null, prompt: result.prompt } : t
          )
        )
      })
      .finally(() => {
        setGeneratingIds((prev) => {
          const next = new Set(prev)
          next.delete(created.id)
          return next
        })
      })
  }
}, [])
```

**Note:** `window.api.sprint.generatePrompt` persists the spec to SQLite inside the handler. The `.then()` above only updates local React state so the UI reflects it without a full reload.

#### 5c. Pass `generatingIds` down to KanbanBoard

```tsx
<KanbanBoard
  tasks={tasks}
  generatingIds={generatingIds}
  // ... other existing props
/>
```

### 6. `KanbanBoard.tsx` and `KanbanColumn.tsx` — Pass-through `generatingIds`

**KanbanBoard.tsx:** Add `generatingIds: Set<string>` to the props interface. Pass it down to each `KanbanColumn`.

**KanbanColumn.tsx:** Add `generatingIds: Set<string>` to the props interface. Pass `isGenerating={generatingIds.has(task.id)}` to each `TaskCard`.

These are prop pass-through only — no logic changes.

### 7. `TaskCard.tsx` — Spec generating badge

Add `isGenerating?: boolean` to the `TaskCard` props interface.

When `isGenerating` is true, show a small badge below the title:

```tsx
{
  isGenerating && (
    <span className="task-card__spec-badge task-card__spec-badge--generating">
      ✦ Writing spec...
    </span>
  )
}
```

Add CSS for this badge in sprint.css:

```css
.task-card__spec-badge--generating {
  font-size: 10px;
  color: var(--bde-accent);
  opacity: 0.7;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 0.3;
  }
}
```

### 8. CSS additions for mode tabs

Append to `sprint.css`:

```css
/* Mode tabs */
.new-ticket-modal__tabs {
  display: flex;
  gap: 4px;
  padding: 16px 24px 0;
  border-bottom: 1px solid var(--bde-border);
  margin-bottom: 4px;
}

.new-ticket-modal__tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--bde-text-dim);
  font-size: 13px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s ease;
}

.new-ticket-modal__tab:hover {
  color: var(--bde-text);
}

.new-ticket-modal__tab--active {
  color: var(--bde-text);
  border-bottom-color: var(--bde-accent);
}

.new-ticket-modal__quick {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.new-ticket-modal__quick-hint {
  font-size: 11px;
  color: var(--bde-text-dim);
  margin: 0;
}

.new-ticket-modal__design-placeholder {
  text-align: center;
  padding: 40px 24px;
  color: var(--bde-text-dim);
  font-size: 14px;
}

.new-ticket-modal__design-placeholder p {
  margin: 8px 0;
}
```

## Files to Change

| File                                                    | What Changes                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `src/shared/template-heuristics.ts`                     | **NEW** — `detectTemplate(title)` keyword mapping              |
| `src/main/handlers/sprint.ts`                           | Add `sprint:generatePrompt` handler + helper functions         |
| `src/preload/index.ts`                                  | Add `sprint.generatePrompt()` and `sprint.delete()`            |
| `src/preload/index.d.ts`                                | Type declarations for new methods                              |
| `src/renderer/src/components/sprint/NewTicketModal.tsx` | Mode tabs, Quick Mode body, Design placeholder, submit by mode |
| `src/renderer/src/components/sprint/SprintCenter.tsx`   | `generatingIds` state, background spec gen trigger             |
| `src/renderer/src/components/sprint/KanbanBoard.tsx`    | `generatingIds` prop pass-through                              |
| `src/renderer/src/components/sprint/KanbanColumn.tsx`   | `generatingIds` prop pass-through                              |
| `src/renderer/src/components/sprint/TaskCard.tsx`       | `isGenerating` prop + badge                                    |
| `src/renderer/src/assets/sprint.css`                    | Mode tab CSS + generating badge CSS                            |

## Out of Scope

- Design Mode implementation (TF-S3)
- Streaming spec generation
- Repo context injection (file tree in prompt)
- Sprint Zustand store extraction
- Markdown preview in modal

## PR Command

```bash
git add -A && git commit -m "feat: Quick Mode ticket creation — mode tabs, background spec gen, generating badge" && git push origin HEAD && gh api repos/RyanJBirkeland/BDE/pulls --method POST -f title="feat: Quick Mode — capture tickets in seconds, Paul writes spec in background" -f body="Adds 3-tab mode switcher to NewTicketModal. Quick Mode (default): title + repo only, task saved instantly, Paul auto-generates spec in background using title keyword detection. Template Mode: existing form. Design Mode: placeholder (coming next). Also: sprint.delete() preload gap fixed." -f head="\$(git branch --show-current)" -f base=main --jq ".html_url"
```
