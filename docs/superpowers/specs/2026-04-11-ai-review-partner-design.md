# AI Review Partner — Design

**Date:** 2026-04-11
**Owner:** Ryan
**Status:** Draft — awaiting review
**Scope:** Backend wiring + auto-review + per-file findings data model + frontend store/components for the AI Review Partner panel inside Code Review. Inline diff annotations (rendering per-file comments anchored to diff lines) are explicitly deferred to a v2 follow-up.

---

## 1. Context

The Code Review view was visually redesigned in [`2026-04-10-code-review-redesign-design.md`](./2026-04-10-code-review-redesign-design.md). That spec introduced `AIAssistantPanel.tsx` as a three-panel-layout component (FileTree | DiffViewer | AIAssistant), but §10 of that spec explicitly deferred AI streaming plumbing:

> **AI streaming plumbing.** This spec describes the visual contract for `AIAssistantPanel`; the IPC channel, prompt composition, and SDK wiring are an implementation concern and are specified in the implementation plan, not here.

This spec is that implementation concern. `AIAssistantPanel.tsx` currently renders as visual scaffolding — the input field, quick-action chips, and message list exist but `handleSubmit()`, `handleChipClick()`, and most of `handleMenuAction()` are stubbed with `TODO: CR Redesign follow-up epic`. The job of this spec is to replace those stubs with real wiring and to upgrade the panel from a passive chat UI into an **AI Review Partner** that proactively reviews changes on task open.

The updated design direction comes from a new Figma mockup (`figma.com/design/Uc0WyGXwZNwHGfgui6pe75`, node `1:2`) that extends the prior layout with:

- **Auto-review metrics**: three cards at the top of the panel showing Quality score (0–100), Issues count, and Files count.
- **Opening message**: the assistant seeds the chat with a summary of the review on first open.
- **Per-file status indicators** in the file tree — warning dot (issues), green check (clean), none (unreviewed).
- **Per-file "AI Reviewed" badge and comment count** on the diff header.
- **Top-bar consolidation**: the existing `Ship It / Merge Locally / Squash / Create PR / Revise / Discard` buttons collapse into a single `Approve ▾` dropdown, with a separate `AI Partner` toggle to show/hide the right panel.

## 2. Goals & Non-Goals

**Goals**

- **G1.** Wire `AIAssistantPanel` to live SDK streaming via a new `review:chatStream` IPC channel following the established Task Workbench copilot pattern. Extend the shared `runSdkStreaming()` utility with a small optional `model` field on `SdkStreamingOptions` so the reviewer chat can run on Opus (the current hardcoded `'claude-sonnet-4-5'` becomes the default when `model` is omitted — existing call sites are unaffected).
- **G2.** Run an automatic structured review when a task is selected in Code Review, producing a quality score, issues count, per-file findings, and an opening message — cached by `{taskId, commitSha}` so re-opening is instant.
- **G3.** Store per-file findings (including inline-comment data) in v1 even though comment rendering ships in v2, so the v2 follow-up is purely a renderer change.
- **G4.** Give the review chat access to `Read`, `Grep`, and `Glob` tools scoped to the task's worktree, so follow-up questions can actually inspect the branch's code.
- **G5.** Add file-tree status indicators and file-header badges that read from the per-file findings.
- **G6.** Consolidate the top-bar action buttons into a single `Approve ▾` dropdown, add the `AI Partner` toggle, and add a branch bar showing `<branch> → <target>` per the Figma.
- **G7.** Honor BDE's architectural patterns throughout: `safeHandle()` for IPC, `createLogger()` for logging, repository pattern for data access, `buildAgentPrompt()` for prompt composition, Zustand store per domain, design tokens over hardcoded values.

**Non-Goals**

- **N1.** Inline AI comments rendered in the diff body. The data exists in v1 but the `ChangesTab`/`PlainDiffContent` annotation layer is a v2 follow-up spec.
- **N2.** Per-file re-review. v1 reviews the whole diff in one pass; the "Re-review" action invalidates the whole cache row for the task.
- **N3.** Changing the diff rendering pipeline, the review queue, or the terminal-service flow.
- **N4.** Theme or token changes. This spec reuses existing `--bde-*` tokens and the three-panel geometry from the prior spec.
- **N5.** E2E tests for the chat streaming path. Unit + integration coverage is required; Playwright tests are best-effort and can be deferred if they prove flaky.
- **N6.** Large-diff truncation. v1 sends the full diff to the model and relies on the SDK to error if context is exceeded. Truncation is YAGNI until it bites.

## 3. Relationship to the Prior Spec

This spec **supersedes** four decisions from `2026-04-10-code-review-redesign-design.md`:

| Prior spec decision                                                                                    | This spec revises to                                                                                 | Reason                                                                            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| §5.5 — assistant is silent on open; discovery via chips                                                | Auto-review fires on task selection, debounced 2s, cached by commit SHA                              | New Figma design makes metrics + opening message the primary affordance           |
| §5.2 — TopBar right zone has `Ship It`, `Merge Locally`, `Create PR`, kebab                            | TopBar right zone has `AI Partner` toggle + single `Approve ▾` dropdown containing all prior actions | Figma consolidation — prior actions remain functional, only the container changes |
| §5.5 — quick-action chips are `Summarize diff`, `Risks?`, `Explain selected file`                      | Chips are `Explain security issues`, `Performance analysis`, `Suggest improvements`                  | Figma labels                                                                      |
| §5.5 — `Show agent history` / `Clear thread` / `New thread` are visual scaffolding with no-op handlers | These menu items get real handlers (read from store, clear task messages, reset thread)              | Wiring phase                                                                      |

All other decisions from the prior spec (three-panel geometry, `256/flex/384` widths, design tokens, motion rules, accessibility patterns) carry forward unchanged.

The filename `AIAssistantPanel.tsx` is preserved from the prior spec for continuity — the panel's capability expands but its location in the import graph does not move.

## 4. Architecture Overview

```
           ┌─────────────────────────────────────────────┐
           │             CodeReviewView                  │
           │  ┌──────────┐ ┌─────────┐ ┌──────────────┐  │
           │  │ FileTree │ │  Diff   │ │ AIAssistant  │  │
           │  │ (badges) │ │ Viewer  │ │    Panel     │  │
           │  └──────────┘ └─────────┘ └──────┬───────┘  │
           └─────────────────────────────────┼───────────┘
                                             │
                                             ▼
                          ┌──────────────────────────────┐
                          │ useReviewPartnerStore         │
                          │ (Zustand)                     │
                          │  reviewByTask[taskId]         │
                          │  messagesByTask[taskId]       │
                          │  panelOpen                    │
                          └──────────────┬────────────────┘
                                         │ window.api.review.*
                                         ▼
                          ┌──────────────────────────────┐
                          │ IPC handlers (main)           │
                          │  review:autoReview            │
                          │  review:chatStream            │
                          │  review:chatChunk (push)      │
                          │  review:chatAbort             │
                          └──────────────┬────────────────┘
                                         │
                                 ┌───────┴────────┐
                                 ▼                ▼
                      ┌───────────────────┐  ┌──────────────────┐
                      │ ReviewService     │  │ runSdkStreaming  │
                      │ (business logic)  │──▶│ (shared utility) │
                      └────────┬──────────┘  └──────────────────┘
                               │
                               ▼
                      ┌───────────────────┐
                      │ IReviewRepository │──▶ SQLite: task_reviews
                      │ (data access)     │    keyed {taskId, commitSha}
                      └───────────────────┘
```

**Pattern mapping — nothing is invented:**

| New piece               | Pattern followed                                    | Reference                                          |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `ReviewService`         | Service layer                                       | `src/main/services/task-terminal-service.ts`       |
| `IReviewRepository`     | Repository pattern                                  | `src/main/data/sprint-task-repository.ts`          |
| `review:chatStream` IPC | Workbench copilot streaming                         | `src/main/handlers/workbench.ts`                   |
| `review:autoReview` IPC | Synthesizer single-turn structured output           | `buildSynthesizerPrompt()` in `prompt-composer.ts` |
| `buildReviewerPrompt()` | New agent type in existing composer                 | `src/main/agent-manager/prompt-composer.ts`        |
| `useReviewPartnerStore` | Zustand-per-domain                                  | `src/renderer/src/stores/taskWorkbench.ts`         |
| `task_reviews` table    | Migration at bottom of `db.ts`                      | `src/main/db.ts`                                   |
| Handler file            | `safeHandle()` + `createLogger('review-assistant')` | `src/main/handlers/workbench.ts`                   |
| File-tree badges        | Component primitive in `code-review/`               | `src/renderer/src/components/code-review/`         |

Zero new npm dependencies. All new code composes from `runSdkStreaming`, `buildAgentPrompt`, `safeHandle`, `createLogger`, `ISprintTaskRepository`, Zustand, and existing design tokens.

## 5. Data Layer

### 5.1 SQLite schema

New migration appended to `src/main/db.ts` (version is assigned at write time, not hardcoded — verified via `PRAGMA user_version`):

```sql
CREATE TABLE IF NOT EXISTS task_reviews (
  task_id         TEXT    NOT NULL,
  commit_sha      TEXT    NOT NULL,
  quality_score   INTEGER NOT NULL,
  issues_count    INTEGER NOT NULL,
  files_count     INTEGER NOT NULL,
  opening_message TEXT    NOT NULL,
  findings_json   TEXT    NOT NULL,
  raw_response    TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (task_id, commit_sha)
);
CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id);
```

Per the CLAUDE.md SQLite gotcha, this multi-statement SQL is assigned to a `const sql` variable first and passed to the `better-sqlite3` multi-statement runner on the following line (see any multi-statement migration in `db.ts` for the established pattern).

### 5.2 Shared types

New file: `src/shared/review-types.ts`

```ts
export type FindingSeverity = 'high' | 'medium' | 'low'
export type FindingCategory = 'security' | 'performance' | 'correctness' | 'style'

export interface InlineComment {
  line: number // post-change (right-side) line number
  severity: FindingSeverity
  category: FindingCategory
  message: string
}

export interface FileFinding {
  path: string
  status: 'clean' | 'issues'
  commentCount: number
  comments: InlineComment[] // stored in v1, rendered in v2
}

export interface ReviewFindings {
  perFile: FileFinding[]
}

export interface ReviewResult {
  qualityScore: number // 0-100
  issuesCount: number // server-computed aggregate
  filesCount: number // server-computed aggregate
  openingMessage: string
  findings: ReviewFindings
  model: string // e.g. 'claude-opus-4-6'
  createdAt: number // ms since epoch
}
```

### 5.3 Repository

New file: `src/main/data/review-repository.ts`

```ts
export interface IReviewRepository {
  getCached(taskId: string, commitSha: string): ReviewResult | null
  setCached(
    taskId: string,
    commitSha: string,
    result: ReviewResult,
    rawResponse: string,
  ): void
  invalidate(taskId: string): void
}

export function createReviewRepository(db: Database): IReviewRepository { ... }
```

**`getCached` behavior:**

- Returns `null` on cache miss.
- Parses `findings_json` defensively (`try/catch` around `JSON.parse`). On parse failure, logs a warning, deletes the corrupt row, returns `null` (treated as miss — triggers a fresh review).

**`setCached` behavior:** single-row upsert via `INSERT OR REPLACE`.

**`invalidate` behavior:** `DELETE FROM task_reviews WHERE task_id = ?` — removes every commit-SHA-keyed row for the task. Used by the "Re-review" menu action.

## 6. Service Layer

New file: `src/main/services/review-service.ts`

```ts
export interface ReviewServiceDeps {
  repo: IReviewRepository
  taskRepo: ISprintTaskRepository
  logger: Logger
  resolveWorktreePath: (taskId: string) => Promise<string>
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  getDiff: (worktreePath: string) => Promise<string>
  runSdkOnce: (prompt: string, options: SdkOnceOptions) => Promise<string>
}

export interface ReviewService {
  reviewChanges(taskId: string, opts?: { force?: boolean }): Promise<ReviewResult>
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService
```

**`reviewChanges(taskId, opts)` flow:**

1. Fetch task via `taskRepo.getTask(taskId)`; throw if not found.
2. Reject if `task.status !== 'review'` — the partner only reviews tasks in review status.
3. Resolve the worktree path via `resolveWorktreePath(taskId)`.
4. Get HEAD SHA via `getHeadCommitSha(worktreePath)`.
5. If `!opts.force`, call `repo.getCached(taskId, headSha)`; return immediately on hit.
6. Fetch the diff via `getDiff(worktreePath)`.
7. **Empty-diff short-circuit**: if the diff is empty, build and return a synthetic result without firing the SDK:
   ```ts
   { qualityScore: 100, issuesCount: 0, filesCount: 0,
     openingMessage: 'No changes detected on this branch.',
     findings: { perFile: [] }, model: '(none)', createdAt: Date.now() }
   ```
8. Build the prompt via `buildAgentPrompt({ agentType: 'reviewer', mode: 'review', task, diff })`.
9. Call `deps.runSdkOnce(prompt, { model: 'claude-opus-4-6', maxTurns: 1, tools: [] })` — no tools for the review pass. (The option is named `tools` in `SdkStreamingOptions`, not `allowedTools`.)
10. Parse the response via `parseReviewResponse(raw)` (strips markdown fences, `JSON.parse`, validates shape). On parse failure, retry the parse once; if still failing, log the raw response and throw `MalformedReviewError`.
11. Compute aggregates: `filesCount = perFile.length`, `issuesCount = count of high+medium-severity comments`.
12. Persist via `repo.setCached(...)`.
13. Return the assembled `ReviewResult`.

**Single responsibility**: each dependency is a narrow interface so unit tests can swap in fakes without standing up Electron, SQLite, or the SDK.

**`runSdkOnce`** is a new small helper exported from `src/main/sdk-streaming.ts` alongside `runSdkStreaming()`. It calls the Agent SDK's `query()` with `maxTurns: 1, tools: []` and returns the collected text, sharing the same `SdkStreamingOptions` shape (minus streaming-only callbacks) so the `model` field extension benefits both helpers. Pinning the location up-front avoids bike-shedding in the plan phase.

## 7. Prompt Layer

`src/main/agent-manager/prompt-composer.ts` gains a new `'reviewer'` agent type. Per CLAUDE.md: _"All spawn paths must use `buildAgentPrompt()` instead of inline prompt assembly"_.

**Extending the existing `BuildPromptInput` interface** — not introducing a parallel discriminated union. The existing interface is flat-with-optional-fields and I honor that style:

```ts
// src/main/agent-manager/prompt-composer.ts — add 'reviewer' to AgentType
export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer' | 'reviewer'

// And extend BuildPromptInput with reviewer-only optional fields:
export interface BuildPromptInput {
  agentType: AgentType
  // ... existing fields unchanged ...

  // Reviewer-only (unused by other agent types):
  reviewerMode?: 'review' | 'chat' // required when agentType === 'reviewer'
  diff?: string // reviewer review-mode only
  reviewSeed?: ReviewResult // reviewer chat-mode only
}
```

**`buildAgentPrompt()` routes** to one of two new helpers based on `input.reviewerMode`:

- `buildReviewerPrompt(input)` — for `reviewerMode === 'review'`. Tools: none. Output: JSON only. System prompt ends with:

  ```
  Respond with ONLY a valid JSON object matching this schema — no markdown fences, no prose:
  {
    "qualityScore": <integer 0-100>,
    "openingMessage": "<2-4 sentence summary, written as if speaking to the reviewer>",
    "perFile": [
      {
        "path": "<file path as shown in the diff>",
        "status": "clean" | "issues",
        "comments": [
          {
            "line": <right-side line number>,
            "severity": "high" | "medium" | "low",
            "category": "security" | "performance" | "correctness" | "style",
            "message": "<single-sentence finding>"
          }
        ]
      }
    ]
  }
  ```

- `buildReviewerChatPrompt(input)` — for `reviewerMode === 'chat'`. Tools: `Read`, `Grep`, `Glob`. Includes `taskContent`, the diff, the prior auto-review's `openingMessage` and quality score (from `reviewSeed`), and the conversation history from `messages`. The system prompt instructs the model to answer questions about the change, inspect files via tools when needed, and cite specific file paths and line numbers where possible.

Both helpers share a small internal helper `formatTaskContext(input)` that produces the `title`, `spec`, `repo`, and `branch` block — analogous to the existing per-agent-type helpers in `prompt-composer.ts`.

## 8. IPC Layer

### 8.1 New channels in `src/shared/ipc-channels.ts`

```ts
'review:autoReview' // invoke    (taskId, force?) → ReviewResult
'review:chatStream' // invoke    ({taskId, messages}) → { streamId }
'review:chatChunk' // main→rend ({streamId, chunk?, done, error?, toolUse?})
'review:chatAbort' // invoke    (streamId) → void
```

### 8.2 Handler file

New file: `src/main/handlers/review-assistant.ts`

- All handlers wrapped in `safeHandle()` (non-negotiable per CLAUDE.md).
- `createLogger('review-assistant')` for all logging — no `console.*`.
- `review:autoReview` handler: ~15 lines. Validates `taskId`, calls `reviewService.reviewChanges(taskId, { force })`, returns the result.
- `review:chatStream` handler follows the Workbench copilot pattern from `src/main/handlers/workbench.ts:332-407`:
  1. Validate params.
  2. Resolve worktree path and prior auto-review via the repository.
  3. Build the prompt via `buildAgentPrompt({ agentType: 'reviewer', mode: 'chat', ... })`.
  4. Generate a `streamId`.
  5. Call `runSdkStreaming(prompt, onChunk, activeStreams, streamId, timeout, { cwd: worktreePath, tools: ['Read', 'Grep', 'Glob'], model: 'claude-opus-4-6', onToolUse })`. The `model` field requires the small extension to `SdkStreamingOptions` described in G1 — without it the chat runs on the hardcoded Sonnet default and a follow-up correction would be needed.
  6. `onChunk` pushes `review:chatChunk` events via `webContents.send(...)` with the stream ID and chunk text.
  7. On completion, push a final chunk with `done: true, fullText`.
  8. On error, push a chunk with `error: string` and clean up.
- `review:chatAbort` handler: looks up the stream ID in `activeStreams` and calls `.close()`, per the `runSdkStreaming` abort contract.
- Handler registration added to `src/main/index.ts` alongside the other handlers.

### 8.3 Preload bridge

`src/preload/index.ts` gains:

```ts
review: {
  autoReview: (taskId: string, force?: boolean) => Promise<ReviewResult>,
  chatStream: (params: {
    taskId: string
    messages: PartnerMessage[]
  }) => Promise<{ streamId: string }>,
  onChatChunk: (
    listener: (evt: Event, chunk: ChatChunk) => void,
  ) => () => void,
  abortChat: (streamId: string) => Promise<void>,
}
```

Mirrors `window.api.workbench.*` exactly so the renderer subscription pattern is identical.

## 9. Frontend: Store

New file: `src/renderer/src/stores/reviewPartner.ts`

```ts
interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: ReviewResult
  error?: string
}

interface PartnerMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
}

interface ReviewPartnerStore {
  panelOpen: boolean
  togglePanel: () => void

  reviewByTask: Record<string, ReviewState>
  messagesByTask: Record<string, PartnerMessage[]>
  activeStreamByTask: Record<string, string | null>

  autoReview: (taskId: string, opts?: { force?: boolean }) => Promise<void>
  sendMessage: (taskId: string, content: string) => Promise<void>
  abortStream: (taskId: string) => Promise<void>
  clearMessages: (taskId: string) => void
  appendQuickAction: (taskId: string, prompt: string) => void
}
```

**Persistence:**

- `messagesByTask` → localStorage under `bde:review-partner-messages`, capped at 100 messages per task, LRU eviction across at most 20 tasks. Stricter than workbench's 200/∞ because reviews are more numerous and most become stale once the task ships.
- `panelOpen` → localStorage under `bde:review-partner-open` (boolean).
- `reviewByTask` → **memory only**. The backend is already the source of truth via SQLite cache. On mount, the store calls `autoReview(taskId)` which hits the cache and returns instantly.
- `activeStreamByTask` → memory only. Stream IDs are ephemeral per-session.

**Action semantics:**

- `autoReview(taskId, opts)`:
  - If `status === 'loading'`, no-op.
  - Sets `status: 'loading'`.
  - Calls `window.api.review.autoReview(taskId, opts?.force)`.
  - On success, sets `status: 'ready'` and the result.
  - On error, sets `status: 'error'` with the error string.
  - If after completion the user has already appended messages to this task's thread, the opening message is not re-seeded (idempotency guard).

- `sendMessage(taskId, content)`:
  - Appends a user message.
  - Appends an empty streaming assistant message.
  - Calls `window.api.review.chatStream({ taskId, messages })`, stores the returned `streamId` in `activeStreamByTask`.
  - Subscribes to `onChatChunk`; for chunks matching the current stream ID, appends to the streaming message's content.
  - On `done`, clears streaming flag and `activeStreamByTask[taskId]`.
  - On `error` chunk, appends error text to the streaming message and clears the streaming flag.

- `abortStream(taskId)`:
  - If `activeStreamByTask[taskId]`, calls `window.api.review.abortChat(streamId)`.
  - Marks the in-flight message as finalized with whatever content it has.

## 10. Frontend: Components

| File                                            | Status     | Purpose                                                                               |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `components/code-review/AIAssistantPanel.tsx`   | **Modify** | Replaces stub handlers with real wiring; consumes `useReviewPartnerStore`             |
| `components/code-review/ReviewMetricsRow.tsx`   | **New**    | Three cards — Quality score / Issues / Files                                          |
| `components/code-review/ReviewMessageList.tsx`  | **New**    | Streaming-aware chat message list                                                     |
| `components/code-review/ReviewQuickActions.tsx` | **New**    | Three action chips with Figma labels                                                  |
| `components/code-review/ReviewChatInput.tsx`    | **New**    | Textarea, send/abort button, auto-grow                                                |
| `components/code-review/TopBar.tsx`             | **Modify** | Adds `AI Partner` toggle, adds branch bar, swaps action buttons for `Approve ▾`       |
| `components/code-review/ApproveDropdown.tsx`    | **New**    | Popover consolidating Merge Locally / Squash / Create PR / Request Revision / Discard |
| `components/code-review/BranchBar.tsx`          | **New**    | `<branch> → <target>` display in top bar                                              |
| `components/code-review/AIFileStatusBadge.tsx`  | **New**    | Small dot (warning/check/none) used in the file tree                                  |
| `components/code-review/AIReviewedBadge.tsx`    | **New**    | Pill badge on the file header                                                         |
| `components/code-review/FileTreePanel.tsx`      | **Modify** | Reads per-file findings from store; renders `AIFileStatusBadge` for each row          |
| `components/code-review/DiffViewerPanel.tsx`    | **Modify** | Adds `AIReviewedBadge` + comment count to the header for the selected file            |
| `stores/reviewPartner.ts`                       | **New**    | Zustand store — see §9                                                                |
| `hooks/useAutoReview.ts`                        | **New**    | Debounced auto-review trigger on task selection                                       |
| `shared/review-types.ts`                        | **New**    | Shared type definitions                                                               |

**Quick action behavior:** chips dispatch `appendQuickAction(taskId, prompt)` which injects a canned user message and triggers `sendMessage()` without requiring the user to type. Canned prompts:

- **Explain security issues** → `"Walk me through any security risks you see in this diff. Cite specific files and lines where possible."`
- **Performance analysis** → `"Analyze this change for performance regressions or improvements. Focus on hot paths and allocations."`
- **Suggest improvements** → `"What would you change about this diff before merging? Rank suggestions by impact."`

## 11. Frontend: Orchestration

### 11.1 Auto-review trigger

New hook: `src/renderer/src/hooks/useAutoReview.ts`

```ts
export function useAutoReview(taskId: string | null, taskStatus: TaskStatus | null) {
  const autoReview = useReviewPartnerStore((s) => s.autoReview)
  useEffect(() => {
    // Guard: only fire for tasks in review status. Avoids consistent
    // rejection paths on tasks selected from stale queue rows.
    if (!taskId || taskStatus !== 'review') return
    const handle = setTimeout(() => {
      autoReview(taskId).catch(() => {
        // errors are surfaced via store.error; swallow here
      })
    }, 2000)
    return () => clearTimeout(handle)
  }, [taskId, taskStatus, autoReview])
}
```

`CodeReviewView` mounts this hook with the current `selectedTaskId` **and** the selected task's `status` (read from the existing sprint tasks store). The `taskStatus !== 'review'` guard is the explicit front-line filter; the service-layer rejection at §6 step 2 remains as a defense-in-depth check. Rapid task switches cancel the pending fire. The 2000 ms debounce is small enough to feel responsive on intentional selection, large enough to absorb `j`/`k` scrolling through the review queue.

### 11.2 Mid-stream task switch

When `selectedTaskId` changes and `activeStreamByTask[previousId]` is set, a cleanup effect calls `abortStream(previousId)`. The chunk subscription also filters chunks by `streamId` against the current active stream — any chunks arriving after an abort are ignored.

### 11.3 Panel toggle

The `AI Partner` button in the TopBar calls `useReviewPartnerStore.togglePanel()`. Panel state persists across sessions via the localStorage entry. Auto-review fires regardless of panel visibility — the metric cards populate in memory and are immediately available on next open.

## 12. Layout & Accessibility

### 12.1 Layout

Three-column grid inside `CodeReviewView`, consistent with the prior spec's `256 / flex / 384` widths. When `panelOpen === false`, the right column is removed and the diff viewer expands. The collapse transitions use pure CSS width transitions from the prior spec.

Under ≤1120 px the right panel becomes a collapsed rail with an expand chevron; clicking expands it as a right-docked overlay above the diff (same pattern as the prior spec §4.3).

### 12.2 Accessibility (per CLAUDE.md)

- Panel: `role="complementary"`, `aria-label="AI Review Partner"`.
- Message list: `role="log"`, `aria-live="polite"`, `aria-atomic="false"`.
- Streaming messages: `aria-busy="true"` while growing.
- Metric cards: each `role="status"` with `aria-label="Quality score 92 out of 100"` / `aria-label="3 issues found"` / `aria-label="8 files changed"`.
- `ApproveDropdown`: `role="menu"` with `role="menuitem"` children, arrow-key navigation, `Escape` to close.
- Close button: `aria-label="Close AI Review Partner"`.
- File tree badges: `aria-label="File has issues"` / `aria-label="File reviewed clean"`.
- `AI Partner` toggle: `aria-pressed` reflects panel open state.

## 13. Error Handling

| Failure                                   | Handling                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK error (rate limit, network, auth)     | `ReviewState.status = 'error'`; panel header shows inline error with `Retry`; nothing cached                                                                                                |
| Model returns malformed JSON              | Strip markdown fences, retry parse once, throw `MalformedReviewError` (declared in `src/main/services/review-service.ts` alongside the service factory) if still fails; raw response logged |
| Empty diff                                | Service returns synthetic "No changes detected" result without SDK call                                                                                                                     |
| Worktree missing / stale                  | Service throws `WorktreeMissingError` (declared in `src/main/services/review-service.ts` alongside the service factory); panel shows "Worktree not found" with disabled Re-review           |
| Cache row corrupt                         | Repository logs, deletes the row, returns `null` → treated as cache miss                                                                                                                    |
| Chat stream mid-response failure          | Error chunk emitted with `error: string`; streaming message bubble shows error inline, prior messages preserved                                                                             |
| User abort (new task selected)            | `abortStream()` called; streaming message finalized at current content; not treated as an error                                                                                             |
| Rate limit                                | Distinctive error message: `"Claude Code rate limit reached. Try again shortly."`                                                                                                           |
| Timeout (`runSdkStreaming` default 180 s) | Error chunk emitted; treated as stream error                                                                                                                                                |

All errors logged via `createLogger('review-assistant')` with task and stream context. IPC boundary errors surface via `safeHandle()`'s automatic handling.

## 14. Edge Cases

1. **Rapid task switching** — 2 s debounce on auto-review fires only the last stable selection.
2. **Mid-stream task switch** — previous stream aborted; chunks filtered by stream ID so orphan chunks can't leak into the wrong task.
3. **Panel reopened for cached task** — SQLite cache returns instantly; no re-fire.
4. **Task not in review status** — service rejects with clear error; hook guards fire.
5. **Multi-task cache coexistence** — store holds reviews for up to 20 tasks; LRU eviction beyond that.
6. **Forward-compat schema drift** — `findings_json` parsed defensively; unknown fields ignored; missing optional fields defaulted.
7. **Markdown-fenced JSON** — parser strips ` ```json` and ` ``` ` fences before `JSON.parse`.
8. **New commit on branch** — cache keyed by commit SHA; new commit → natural miss → fresh review.
9. **Task terminal transition cleanup (deferred)** — messages for `done`/`cancelled`/`failed` tasks accumulate in localStorage. With the 100-messages-per-task cap and 20-task LRU, total footprint stays under 1 MB. No cleanup logic in v1; revisit only if localStorage pressure becomes real.
10. **No task selected** — panel shows empty state placeholder; `AI Partner` toggle still functional.
11. **Auto-review while panel closed** — cards populate in memory and appear instantly on next open; no network re-fetch.

## 15. Testing

### 15.1 Main process (`npm run test:main`)

| Target                                | Cases                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReviewRepository`              | Round-trip get/set; cache miss; `invalidate` clears all SHAs for a task; corrupt `findings_json` returns `null` and deletes the row                                                 |
| `reviewService.reviewChanges`         | Cache hit short-circuits SDK; `force: true` bypasses cache; empty diff short-circuit; malformed JSON retry-then-fail; aggregate computation (issuesCount from high+medium severity) |
| `parseReviewResponse`                 | Raw JSON; JSON with markdown fences; JSON with leading/trailing prose; rejects invalid shapes                                                                                       |
| `buildReviewerPrompt` (review mode)   | Contains task spec, diff, schema instructions; does not include conversation history                                                                                                |
| `buildReviewerChatPrompt` (chat mode) | Includes messages, review seed context, tools declared, `cwd` passed                                                                                                                |
| IPC `review:autoReview` handler       | Calls service, returns result; `safeHandle` wraps error; force flag passed through                                                                                                  |
| IPC `review:chatStream` handler       | Calls `runSdkStreaming` with correct options; chunks emitted via `webContents.send`; abort path clears `activeStreams`                                                              |

Repository tests use `new Database(':memory:')` with the migration applied. Service tests use fakes for all deps — no SDK, no SQLite, no file IO.

### 15.2 Renderer (`npm test`)

| Target                              | Cases                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `useReviewPartnerStore.autoReview`  | idle → loading → ready; error path; idempotent re-fire                                                    |
| `useReviewPartnerStore.sendMessage` | User message append; streaming message builds from chunks; abort cancellation; error chunk renders inline |
| `useAutoReview` hook                | Debounces 2 s; task change clears pending; unmount cleans up                                              |
| `AIAssistantPanel`                  | Empty / loading / ready / error render variants                                                           |
| `ReviewMetricsRow`                  | Three cards with numbers and correct `aria-label`                                                         |
| `ReviewQuickActions`                | Chip click dispatches canned prompt                                                                       |
| `ApproveDropdown`                   | Arrow-key nav; `Escape` close; action dispatch                                                            |
| `AIFileStatusBadge`                 | Warning / check / none variants                                                                           |
| `FileTreePanel` (modified)          | Renders `AIFileStatusBadge` for files with findings; no badge for unreviewed files                        |
| `DiffViewerPanel` (modified)        | Shows `AIReviewedBadge` + comment count when the selected file has a finding                              |

Per the pinned memory rule, Zustand state is set via `useReviewPartnerStore.setState()` **before** `render()` in tests.

### 15.3 E2E (`npm run test:e2e`) — best-effort, deferrable

- Open Code Review, select a task with a seeded cache row, assert metrics populate instantly.
- Toggle the `AI Partner` button off and on, verify panel visibility and persistence.
- Send a chat message with a mocked IPC chunk stream, verify message bubble renders and streaming flag clears on `done`.

### 15.4 Coverage

New files inherit the existing `npm run test:coverage` threshold from `vitest.config.ts`. The threshold is **not** modified by this spec; any new file must pull its own weight.

## 16. Out of Scope / Deferred

- **Inline AI comments rendered in the diff body.** Data is stored from v1; the annotation layer in `PlainDiffContent.tsx` / `ChangesTab.tsx` ships as a v2 follow-up spec that reads the already-stored findings.
- **Large-diff truncation.** Rely on the SDK to error if context is exceeded. Add only if it becomes a problem.
- **Per-file re-review.** Re-review always invalidates the whole task's cache.
- **Cross-task review comparison.** No "compare reviews for task A and task B" feature.
- **Exporting reviews.** No markdown export, PDF, or permalink.
- **Historical review trend charts.** Dashboard integration is out of scope.
- **Chat message cleanup on task terminal transitions.** Messages persist until LRU eviction. Revisit only if localStorage pressure bites.
- **Message search.** No "search my past review conversations."
- **Review-queue batch actions for AI.** Single-task only.

## 17. Success Criteria

- Selecting a task in Code Review fires an auto-review within 2 seconds (debounced) when no cache is present; cached reviews render instantly.
- Metric cards display Quality / Issues / Files with numbers sourced from the review row.
- The opening message from the review seeds the chat thread as an assistant message.
- Clicking any quick action injects a canned user message and streams an assistant response via `review:chatStream`.
- Chat messages stream character-by-character (or chunk-by-chunk) via `review:chatChunk`.
- Assistant has live access to `Read` / `Grep` / `Glob` tools scoped to the task's worktree; tool invocations are visible in the message stream (via the existing `onToolUse` event pattern).
- `AI Partner` toggle shows/hides the right panel with CSS transitions; state persists across sessions.
- `Approve ▾` dropdown contains `Merge Locally`, `Squash & Merge`, `Create PR`, `Request Revision`, `Discard`, with the same behaviors they have today in `ReviewActions.tsx`.
- File tree rows show warning/check badges for files with findings; unreviewed files render no badge.
- File header shows `AI Reviewed` badge + comment count when a finding exists for the selected file.
- `Re-review` menu action invalidates the cache and triggers a fresh review.
- `typecheck`, `lint`, `test`, `test:main` all pass. Coverage thresholds unchanged.
- No `console.*` calls in new code; all logging via `createLogger('review-assistant')`.
- No hardcoded colors, spacing, or radii in new CSS; everything resolves through `--bde-*` tokens.
- Both `theme-pro-dark` and `theme-pro-light` render correctly without per-theme overrides.
- `prefers-reduced-motion` disables the streaming cursor animation.
- Keyboard navigation works through the `ApproveDropdown` with arrow keys and `Escape`.
- Accessibility: all new interactive elements have `aria-label`; streaming messages are announced via `aria-live="polite"`.

---

_Pair this design doc with a follow-up implementation plan (use `superpowers:writing-plans`) that sequences the backend wiring, then the store and components, then the top-bar and file-tree decorations, then tests. Each slice should leave the app buildable and the existing visual scaffolding intact._
