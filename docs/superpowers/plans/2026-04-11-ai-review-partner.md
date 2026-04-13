# AI Review Partner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `AIAssistantPanel` stubs to real SDK streaming, add an auto-running structured reviewer that produces per-file findings (cached by commit SHA), and decorate the Code Review file tree and diff header with per-file AI status indicators.

**Architecture:** New service + repository in main, new Zustand store + debounced hook in renderer, two new IPC channels (`review:autoReview` invoke, `review:chatStream` invoke + `review:chatChunk` push), reviewer becomes a new agent type in `prompt-composer.ts`, small optional extension to `SdkStreamingOptions` so reviewer chat can run on Claude Opus 4.6. Reuses existing `runSdkStreaming`, `safeHandle`, `createLogger`, `ISprintTaskRepository`, and the three-panel Code Review layout from the prior 2026-04-10 redesign spec.

**Tech Stack:** TypeScript strict, Electron (main + preload + renderer), React + Zustand, `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, vitest (renderer + main), Playwright (best-effort E2E).

**Spec:** [`docs/superpowers/specs/2026-04-11-ai-review-partner-design.md`](../specs/2026-04-11-ai-review-partner-design.md)

---

## File Structure

### New files

**Shared:**

- `src/shared/review-types.ts` — `FindingSeverity`, `FindingCategory`, `InlineComment`, `FileFinding`, `ReviewFindings`, `ReviewResult`, `PartnerMessage`, `ChatChunk`.

**Main process:**

- `src/main/migrations/v046-add-task-reviews-table.ts` — SQLite migration.
- `src/main/data/review-repository.ts` — `IReviewRepository` + `createReviewRepository()`.
- `src/main/data/review-repository.test.ts` — repository unit tests.
- `src/main/services/review-service.ts` — `ReviewService`, `createReviewService()`, `parseReviewResponse()`, `WorktreeMissingError`, `MalformedReviewError`.
- `src/main/services/review-service.test.ts` — service unit tests.
- `src/main/handlers/review-assistant.ts` — IPC handlers (`review:autoReview`, `review:chatStream`, `review:chatAbort`).
- `src/main/handlers/review-assistant.test.ts` — handler integration tests.

**Renderer:**

- `src/renderer/src/stores/reviewPartner.ts` — Zustand store.
- `src/renderer/src/stores/reviewPartner.test.ts` — store unit tests.
- `src/renderer/src/hooks/useAutoReview.ts` — debounced auto-review trigger.
- `src/renderer/src/hooks/useAutoReview.test.ts` — hook unit tests.
- `src/renderer/src/components/code-review/AIFileStatusBadge.tsx`
- `src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx`
- `src/renderer/src/components/code-review/AIReviewedBadge.tsx`
- `src/renderer/src/components/code-review/BranchBar.tsx`
- `src/renderer/src/components/code-review/ReviewMetricsRow.tsx`
- `src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx`
- `src/renderer/src/components/code-review/ReviewQuickActions.tsx`
- `src/renderer/src/components/code-review/ReviewChatInput.tsx`
- `src/renderer/src/components/code-review/ReviewMessageList.tsx`
- `src/renderer/src/components/code-review/ApproveDropdown.tsx`
- `src/renderer/src/components/code-review/ApproveDropdown.test.tsx`

### Modified files

- `src/main/sdk-streaming.ts` — add optional `model` field to `SdkStreamingOptions`, add new `runSdkOnce()` helper.
- `src/main/agent-manager/prompt-composer.ts` — add `'reviewer'` to `AgentType`, extend `BuildPromptInput` with `reviewerMode/diff/reviewSeed`, add `buildReviewerPrompt` and `buildReviewerChatPrompt`, route in `buildAgentPrompt()`.
- `src/main/index.ts` — register review-assistant handlers, wire dependencies.
- `src/shared/ipc-channels.ts` — add 4 new channel constants.
- `src/preload/index.ts` — add `window.api.review.*` bridge.
- `src/renderer/src/components/code-review/AIAssistantPanel.tsx` — replace stub handlers with store wiring.
- `src/renderer/src/components/code-review/TopBar.tsx` — add `BranchBar`, AI Partner toggle, `ApproveDropdown`.
- `src/renderer/src/components/code-review/FileTreePanel.tsx` — render `AIFileStatusBadge` per row.
- `src/renderer/src/components/code-review/DiffViewerPanel.tsx` — render `AIReviewedBadge` + comment count for selected file.
- `src/renderer/src/views/CodeReviewView.tsx` — mount `useAutoReview`, thread `panelOpen` to layout grid.

### Skill references

- @superpowers:test-driven-development — used throughout; write failing tests first, implement minimal pass, refactor.
- @superpowers:verification-before-completion — used in Task I1 before claiming the plan is complete.

---

## Phase A — Foundation (types, migration, repository)

### Task A1: Shared review types

**Files:**

- Create: `src/shared/review-types.ts`

- [ ] **Step 1: Create the shared types file**

Write exactly:

```ts
// src/shared/review-types.ts

export type FindingSeverity = 'high' | 'medium' | 'low'
export type FindingCategory = 'security' | 'performance' | 'correctness' | 'style'

export interface InlineComment {
  /** Right-side (post-change) line number in the diff. */
  line: number
  severity: FindingSeverity
  category: FindingCategory
  /** Single-sentence finding. */
  message: string
}

export interface FileFinding {
  path: string
  status: 'clean' | 'issues'
  commentCount: number
  /** Stored in v1, rendered in a v2 follow-up. */
  comments: InlineComment[]
}

export interface ReviewFindings {
  perFile: FileFinding[]
}

export interface ReviewResult {
  /** 0-100, higher is better. */
  qualityScore: number
  /** Server-computed aggregate of high+medium severity comments across files. */
  issuesCount: number
  /** Server-computed aggregate — `findings.perFile.length`. */
  filesCount: number
  /** 2-4 sentence summary used to seed the chat thread. */
  openingMessage: string
  findings: ReviewFindings
  /** Model identifier, e.g. 'claude-opus-4-6'. */
  model: string
  /** Milliseconds since epoch. */
  createdAt: number
}

export interface PartnerMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** True while chunks are still arriving for this message. */
  streaming?: boolean
}

/** Wire shape pushed over the `review:chatChunk` IPC channel. */
export interface ChatChunk {
  streamId: string
  chunk?: string
  done?: boolean
  fullText?: string
  error?: string
  toolUse?: { name: string; input: Record<string, unknown> }
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors. If errors reference missing imports in _other_ files, ignore — nothing else references this file yet.

- [ ] **Step 3: Commit**

```bash
git add src/shared/review-types.ts
git commit -m "feat: add shared review types for AI Review Partner"
```

---

### Task A2: SQLite migration — `task_reviews` table

**Files:**

- Create: `src/main/migrations/v046-add-task-reviews-table.ts`

Reference pattern: `src/main/migrations/v045-add-cache-token-columns-to-agent-run-turns-for-ful.ts`

- [ ] **Step 0: Verify the next migration version number**

```bash
ls src/main/migrations/ | sort | tail -3
```

Expected: the highest existing version is v045 at plan-writing time. If a newer migration (v046 or higher) has landed since, bump the file name _and_ the `version` export in Step 1 to the next unused number. Do NOT trust the hardcoded `46` blindly.

- [ ] **Step 1: Create the migration file**

Write exactly:

```ts
// src/main/migrations/v046-add-task-reviews-table.ts
import type Database from 'better-sqlite3'

export const version = 46
export const description = 'Add task_reviews table for AI Review Partner cache'

export const up: (db: Database.Database) => void = (db) => {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS task_reviews (
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
    )`
  ).run()

  db.prepare('CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id)').run()
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run main tests to confirm migration loader picks it up**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run
```

Expected: all tests pass. Migration loader discovers the new file automatically via the glob in `db.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/main/migrations/v046-add-task-reviews-table.ts
git commit -m "feat: add task_reviews table migration (v046)"
```

---

### Task A3: Review repository (TDD)

**Files:**

- Create: `src/main/data/review-repository.ts`
- Create: `src/main/data/review-repository.test.ts`

Reference pattern: `src/main/data/sprint-task-repository.ts` (interface + factory shape).

- [ ] **Step 1: Write the failing test file**

Write `src/main/data/review-repository.test.ts`:

```ts
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'
import { createReviewRepository, type IReviewRepository } from './review-repository'
import type { ReviewResult } from '../../shared/review-types'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.prepare(
    `CREATE TABLE IF NOT EXISTS task_reviews (
      task_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      quality_score INTEGER NOT NULL,
      issues_count INTEGER NOT NULL,
      files_count INTEGER NOT NULL,
      opening_message TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, commit_sha)
    )`
  ).run()
  return db
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    qualityScore: 92,
    issuesCount: 3,
    filesCount: 8,
    openingMessage: 'Looks good overall, few issues to address.',
    findings: {
      perFile: [
        {
          path: 'src/foo.ts',
          status: 'issues',
          commentCount: 2,
          comments: [
            { line: 10, severity: 'high', category: 'security', message: 'XSS' },
            { line: 20, severity: 'low', category: 'style', message: 'Name' }
          ]
        }
      ]
    },
    model: 'claude-opus-4-6',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

describe('review-repository', () => {
  let db: Database.Database
  let repo: IReviewRepository

  beforeEach(() => {
    db = makeDb()
    repo = createReviewRepository(db)
  })

  it('returns null on cache miss', () => {
    expect(repo.getCached('task-1', 'abc123')).toBeNull()
  })

  it('round-trips a set then get', () => {
    const result = makeResult()
    repo.setCached('task-1', 'abc123', result, '{"raw":true}')
    const got = repo.getCached('task-1', 'abc123')
    expect(got).not.toBeNull()
    expect(got?.qualityScore).toBe(92)
    expect(got?.findings.perFile[0]?.path).toBe('src/foo.ts')
    expect(got?.findings.perFile[0]?.comments[0]?.severity).toBe('high')
  })

  it('differentiates rows by commit sha', () => {
    repo.setCached('task-1', 'sha-a', makeResult({ qualityScore: 80 }), 'raw-a')
    repo.setCached('task-1', 'sha-b', makeResult({ qualityScore: 95 }), 'raw-b')
    expect(repo.getCached('task-1', 'sha-a')?.qualityScore).toBe(80)
    expect(repo.getCached('task-1', 'sha-b')?.qualityScore).toBe(95)
  })

  it('upserts on set when a row already exists for the same key', () => {
    repo.setCached('task-1', 'abc', makeResult({ qualityScore: 50 }), 'raw1')
    repo.setCached('task-1', 'abc', makeResult({ qualityScore: 75 }), 'raw2')
    expect(repo.getCached('task-1', 'abc')?.qualityScore).toBe(75)
  })

  it('invalidate removes every sha for a task', () => {
    repo.setCached('task-1', 'sha-a', makeResult(), 'raw')
    repo.setCached('task-1', 'sha-b', makeResult(), 'raw')
    repo.setCached('task-2', 'sha-c', makeResult(), 'raw')
    repo.invalidate('task-1')
    expect(repo.getCached('task-1', 'sha-a')).toBeNull()
    expect(repo.getCached('task-1', 'sha-b')).toBeNull()
    expect(repo.getCached('task-2', 'sha-c')).not.toBeNull()
  })

  it('returns null and deletes the row when findings_json is corrupt', () => {
    db.prepare(
      `INSERT INTO task_reviews
       (task_id, commit_sha, quality_score, issues_count, files_count,
        opening_message, findings_json, raw_response, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('task-x', 'sha-x', 90, 0, 1, 'msg', '{not valid json', 'raw', 'm', 0)
    expect(repo.getCached('task-x', 'sha-x')).toBeNull()
    const row = db.prepare('SELECT * FROM task_reviews WHERE task_id = ?').get('task-x')
    expect(row).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/data/review-repository.test.ts
```

Expected: FAIL with `Cannot find module './review-repository'`.

- [ ] **Step 3: Implement the repository**

Write `src/main/data/review-repository.ts`:

```ts
import type Database from 'better-sqlite3'
import type { ReviewResult } from '../../shared/review-types'
import { createLogger } from '../logger'

const log = createLogger('review-repository')

export interface IReviewRepository {
  getCached(taskId: string, commitSha: string): ReviewResult | null
  setCached(taskId: string, commitSha: string, result: ReviewResult, rawResponse: string): void
  invalidate(taskId: string): void
}

interface Row {
  task_id: string
  commit_sha: string
  quality_score: number
  issues_count: number
  files_count: number
  opening_message: string
  findings_json: string
  raw_response: string
  model: string
  created_at: number
}

export function createReviewRepository(db: Database.Database): IReviewRepository {
  const getStmt = db.prepare<[string, string]>(
    'SELECT * FROM task_reviews WHERE task_id = ? AND commit_sha = ?'
  )
  const upsertStmt = db.prepare<
    [string, string, number, number, number, string, string, string, string, number]
  >(
    `INSERT OR REPLACE INTO task_reviews
     (task_id, commit_sha, quality_score, issues_count, files_count,
      opening_message, findings_json, raw_response, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const deleteRowStmt = db.prepare<[string, string]>(
    'DELETE FROM task_reviews WHERE task_id = ? AND commit_sha = ?'
  )
  const invalidateStmt = db.prepare<[string]>('DELETE FROM task_reviews WHERE task_id = ?')

  return {
    getCached(taskId, commitSha) {
      const row = getStmt.get(taskId, commitSha) as Row | undefined
      if (!row) return null
      try {
        const findings = JSON.parse(row.findings_json)
        return {
          qualityScore: row.quality_score,
          issuesCount: row.issues_count,
          filesCount: row.files_count,
          openingMessage: row.opening_message,
          findings,
          model: row.model,
          createdAt: row.created_at
        }
      } catch (err) {
        log.warn(`Corrupt findings_json for task=${taskId} sha=${commitSha}; deleting row`, {
          err: (err as Error).message
        })
        deleteRowStmt.run(taskId, commitSha)
        return null
      }
    },

    setCached(taskId, commitSha, result, rawResponse) {
      upsertStmt.run(
        taskId,
        commitSha,
        result.qualityScore,
        result.issuesCount,
        result.filesCount,
        result.openingMessage,
        JSON.stringify(result.findings),
        rawResponse,
        result.model,
        result.createdAt
      )
    },

    invalidate(taskId) {
      invalidateStmt.run(taskId)
    }
  }
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/data/review-repository.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/data/review-repository.ts src/main/data/review-repository.test.ts
git commit -m "feat: add review repository with corrupt-row recovery"
```

---

## Phase B — Prompt composer + SDK extension

### Task B1: Extend `SdkStreamingOptions` with `model` + add `runSdkOnce`

**Files:**

- Modify: `src/main/sdk-streaming.ts`

- [ ] **Step 1: Read the existing file to plan the edits**

```bash
cat src/main/sdk-streaming.ts
```

Expected: note the `SdkStreamingOptions` interface and the hardcoded `model: 'claude-sonnet-4-5'` in `runSdkStreaming`.

- [ ] **Step 2: Add the `model` field to `SdkStreamingOptions`**

Find the `SdkStreamingOptions` interface and add this property _after_ `settingSources`:

```ts
  /**
   * Override the default SDK model. If omitted, defaults to Sonnet 4.5.
   * Example: 'claude-opus-4-6' for the review partner chat.
   */
  model?: string
```

- [ ] **Step 3: Use the new `model` option in `runSdkStreaming`**

Find this line in the `query()` call:

```ts
      model: 'claude-sonnet-4-5',
```

Replace with:

```ts
      model: options.model ?? 'claude-sonnet-4-5',
```

- [ ] **Step 4: Add the `runSdkOnce` helper at the end of the file**

Append after `runSdkStreaming`:

```ts
/**
 * Single-shot SDK call with no streaming callback — collects the full text and
 * returns it. Intended for JSON-mode agents (e.g. the reviewer auto-review pass)
 * where chunk-by-chunk rendering is not needed.
 *
 * @param prompt - The prompt to send
 * @param options - SDK options; `tools: []` disables all tools
 * @param timeoutMs - Timeout in milliseconds (default: 120 seconds)
 */
export async function runSdkOnce(
  prompt: string,
  options: SdkStreamingOptions = {},
  timeoutMs = 120_000
): Promise<string> {
  // Reuse runSdkStreaming by supplying a no-op onChunk. Tracking map is local.
  const activeStreams = new Map<string, { close: () => void }>()
  const streamId = `once-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return runSdkStreaming(prompt, () => {}, activeStreams, streamId, timeoutMs, options)
}
```

- [ ] **Step 5: Run typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Run main tests — confirm no regression in existing `runSdkStreaming` call sites**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/sdk-streaming.ts
git commit -m "feat(sdk): add optional model option + runSdkOnce helper"
```

---

### Task B2: Add `'reviewer'` agent type to prompt composer

**Files:**

- Modify: `src/main/agent-manager/prompt-composer.ts`
- Create: `src/main/agent-manager/prompt-composer.reviewer.test.ts`

- [ ] **Step 1: Write the failing test file**

Write `src/main/agent-manager/prompt-composer.reviewer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAgentPrompt } from './prompt-composer'
import type { ReviewResult } from '../../shared/review-types'

const reviewSeed: ReviewResult = {
  qualityScore: 92,
  issuesCount: 3,
  filesCount: 8,
  openingMessage: 'Overall solid. A few items to address.',
  findings: { perFile: [] },
  model: 'claude-opus-4-6',
  createdAt: 0
}

describe('buildAgentPrompt — reviewer', () => {
  describe('review mode (JSON output, no tools)', () => {
    it('contains the JSON schema instructions', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec\nImprove auth flow.',
        diff: 'diff --git a/file.ts b/file.ts\n+ new line',
        branch: 'feat/auth'
      })
      expect(prompt).toContain('qualityScore')
      expect(prompt).toContain('perFile')
      expect(prompt).toContain('openingMessage')
      expect(prompt).toContain('"security" | "performance" | "correctness" | "style"')
    })

    it('includes the task spec content', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec\nImprove auth flow.',
        diff: '+ newline',
        branch: 'feat/auth'
      })
      expect(prompt).toContain('Improve auth flow.')
    })

    it('includes the diff', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec',
        diff: 'UNIQUE_DIFF_MARKER_ABC123',
        branch: 'feat/x'
      })
      expect(prompt).toContain('UNIQUE_DIFF_MARKER_ABC123')
    })
  })

  describe('chat mode (tools enabled, conversation history)', () => {
    it('includes the prior auto-review seed context', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [{ role: 'user', content: 'What are the risks?' }],
        reviewSeed
      })
      expect(prompt).toContain('Overall solid. A few items to address.')
      expect(prompt).toContain('92')
    })

    it('includes the conversation history', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [
          { role: 'user', content: 'UNIQUE_USER_MARKER_42' },
          { role: 'assistant', content: 'UNIQUE_ASSISTANT_MARKER_43' }
        ],
        reviewSeed
      })
      expect(prompt).toContain('UNIQUE_USER_MARKER_42')
      expect(prompt).toContain('UNIQUE_ASSISTANT_MARKER_43')
    })

    it('does NOT include the JSON schema instructions', () => {
      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [{ role: 'user', content: 'Hi' }],
        reviewSeed
      })
      expect(prompt).not.toContain('Respond with ONLY a valid JSON object')
    })
  })
})
```

- [ ] **Step 2: Run the test — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/agent-manager/prompt-composer.reviewer.test.ts
```

Expected: FAIL — likely type errors because `'reviewer'`, `reviewerMode`, `diff`, and `reviewSeed` aren't yet in `BuildPromptInput`.

- [ ] **Step 3: Extend `AgentType` and `BuildPromptInput`**

In `src/main/agent-manager/prompt-composer.ts`:

Find:

```ts
export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer'
```

Replace with:

```ts
export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer' | 'reviewer'
```

Find the end of the `BuildPromptInput` interface (the line with `priorScratchpad?: string`) and append, _inside_ the interface, before the closing brace:

```ts
  // Reviewer-only fields
  reviewerMode?: 'review' | 'chat'
  diff?: string
  reviewSeed?: import('../../shared/review-types').ReviewResult
```

- [ ] **Step 4: Add the two reviewer prompt builders**

Before the `buildAgentPrompt` function (around the other `build*Prompt` helpers), add:

```ts
function buildReviewerPrompt(input: BuildPromptInput): string {
  if (input.reviewerMode === 'chat') return buildReviewerChatPrompt(input)
  return buildReviewerReviewPrompt(input)
}

function buildReviewerReviewPrompt(input: BuildPromptInput): string {
  const { taskContent = '', diff = '', branch = '' } = input

  return `${SPEC_DRAFTING_PREAMBLE}

## Role
You are the BDE Code Review Partner running a one-shot structured review pass. You do NOT write code. You analyze a git diff and emit a single JSON object describing what you see.

## Task Context
Branch: ${branch}

${taskContent}

## Diff
\`\`\`diff
${diff}
\`\`\`

## Output Format
Respond with ONLY a valid JSON object matching this schema — no markdown fences, no prose outside the JSON, no commentary:
\`\`\`
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
\`\`\`

Be rigorous: flag real issues, skip stylistic nitpicks unless they rise to "medium" severity. A clean file should have an empty "comments" array. Quality score should reflect the whole diff, not just issues — a clean 2-line change is a 98, not a 92.`
}

function buildReviewerChatPrompt(input: BuildPromptInput): string {
  const { taskContent = '', diff = '', branch = '', messages = [], reviewSeed } = input

  const seedBlock = reviewSeed
    ? `## Prior Review Summary
Quality Score: ${reviewSeed.qualityScore}/100
Opening: ${reviewSeed.openingMessage}
`
    : ''

  const history = messages.map((m) => `**${m.role}:** ${m.content}`).join('\n\n')

  return `${SPEC_DRAFTING_PREAMBLE}

## Role
You are the BDE Code Review Partner answering follow-up questions about a branch that is under review. You have Read, Grep, and Glob access to the working tree — use them to inspect files when the diff alone is insufficient. You do NOT write or modify code.

Cite specific file paths and line numbers where possible. Be concrete and brief.

## Task Context
Branch: ${branch}

${taskContent}

${seedBlock}

## Diff
\`\`\`diff
${diff}
\`\`\`

## Conversation
${history}`
}
```

- [ ] **Step 5: Route `'reviewer'` in `buildAgentPrompt()`**

Find the `switch (input.agentType)` inside `buildAgentPrompt()` and add a case:

```ts
    case 'reviewer':
      return buildReviewerPrompt(input)
```

- [ ] **Step 6: Run the test — confirm it passes**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/agent-manager/prompt-composer.reviewer.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 7: Run the full main test suite — confirm no regression**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/agent-manager/prompt-composer.ts src/main/agent-manager/prompt-composer.reviewer.test.ts
git commit -m "feat: add reviewer agent type with review + chat prompt builders"
```

---

## Phase C — Service layer

### Task C1: Error classes + `parseReviewResponse` helper (TDD)

**Files:**

- Create: `src/main/services/review-service.ts` (partial — just errors + parser)
- Create: `src/main/services/review-service.test.ts` (partial — just parser tests)

- [ ] **Step 1: Write the failing test file**

Write `src/main/services/review-service.test.ts`:

````ts
import { describe, it, expect } from 'vitest'
import { parseReviewResponse, MalformedReviewError } from './review-service'

describe('parseReviewResponse', () => {
  const validJson = JSON.stringify({
    qualityScore: 92,
    openingMessage: 'Looks good.',
    perFile: [
      {
        path: 'src/foo.ts',
        status: 'issues',
        comments: [{ line: 10, severity: 'high', category: 'security', message: 'XSS' }]
      }
    ]
  })

  it('parses plain JSON', () => {
    const out = parseReviewResponse(validJson)
    expect(out.qualityScore).toBe(92)
    expect(out.perFile[0]?.path).toBe('src/foo.ts')
  })

  it('strips ```json fences', () => {
    const out = parseReviewResponse('```json\n' + validJson + '\n```')
    expect(out.qualityScore).toBe(92)
  })

  it('strips plain ``` fences', () => {
    const out = parseReviewResponse('```\n' + validJson + '\n```')
    expect(out.qualityScore).toBe(92)
  })

  it('strips leading/trailing prose', () => {
    const out = parseReviewResponse('Here is the review:\n' + validJson + '\nHope that helps!')
    expect(out.qualityScore).toBe(92)
  })

  it('throws MalformedReviewError on non-JSON', () => {
    expect(() => parseReviewResponse('not json at all')).toThrow(MalformedReviewError)
  })

  it('throws on missing required fields', () => {
    expect(() => parseReviewResponse('{"qualityScore": 92}')).toThrow(MalformedReviewError)
  })

  it('throws on qualityScore out of range', () => {
    const bad = JSON.stringify({
      qualityScore: 150,
      openingMessage: 'bad',
      perFile: []
    })
    expect(() => parseReviewResponse(bad)).toThrow(MalformedReviewError)
  })
})
````

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/services/review-service.test.ts
```

Expected: FAIL — `Cannot find module './review-service'`.

- [ ] **Step 3: Create `review-service.ts` with error classes and parser**

Write `src/main/services/review-service.ts`:

````ts
import type { ReviewFindings, FileFinding } from '../../shared/review-types'

export class WorktreeMissingError extends Error {
  constructor(public readonly path: string) {
    super(`Worktree not found at ${path}`)
    this.name = 'WorktreeMissingError'
  }
}

export class MalformedReviewError extends Error {
  constructor(
    message: string,
    public readonly rawResponse?: string
  ) {
    super(message)
    this.name = 'MalformedReviewError'
  }
}

/** Parsed shape returned by the reviewer model — not yet aggregated. */
export interface ParsedReview {
  qualityScore: number
  openingMessage: string
  perFile: FileFinding[]
}

/**
 * Strip markdown fences, locate the JSON object in the model output, and
 * validate its shape. Throws `MalformedReviewError` on any failure.
 */
export function parseReviewResponse(raw: string): ParsedReview {
  const cleaned = stripFences(raw)
  const jsonText = extractFirstJsonObject(cleaned)
  if (!jsonText) {
    throw new MalformedReviewError('No JSON object found in model response', raw)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new MalformedReviewError(`JSON.parse failed: ${(err as Error).message}`, raw)
  }

  return validateParsedReview(parsed, raw)
}

function stripFences(raw: string): string {
  let out = raw.trim()
  // ```json\n...\n```
  const fenceMatch = out.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenceMatch) out = (fenceMatch[1] ?? '').trim()
  return out
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function validateParsedReview(value: unknown, raw: string): ParsedReview {
  if (!value || typeof value !== 'object') {
    throw new MalformedReviewError('Response is not an object', raw)
  }
  const v = value as Record<string, unknown>

  if (typeof v.qualityScore !== 'number') {
    throw new MalformedReviewError('qualityScore missing or non-numeric', raw)
  }
  if (v.qualityScore < 0 || v.qualityScore > 100) {
    throw new MalformedReviewError('qualityScore out of range 0-100', raw)
  }
  if (typeof v.openingMessage !== 'string' || !v.openingMessage.trim()) {
    throw new MalformedReviewError('openingMessage missing or empty', raw)
  }
  if (!Array.isArray(v.perFile)) {
    throw new MalformedReviewError('perFile missing or not an array', raw)
  }

  const perFile: FileFinding[] = v.perFile.map((entry: unknown, idx: number) => {
    if (!entry || typeof entry !== 'object') {
      throw new MalformedReviewError(`perFile[${idx}] not an object`, raw)
    }
    const f = entry as Record<string, unknown>
    if (typeof f.path !== 'string') {
      throw new MalformedReviewError(`perFile[${idx}].path missing`, raw)
    }
    if (f.status !== 'clean' && f.status !== 'issues') {
      throw new MalformedReviewError(`perFile[${idx}].status invalid`, raw)
    }
    const comments = Array.isArray(f.comments) ? f.comments : []
    return {
      path: f.path,
      status: f.status,
      commentCount: comments.length,
      comments: comments.map((c: unknown, ci: number) => {
        if (!c || typeof c !== 'object') {
          throw new MalformedReviewError(`perFile[${idx}].comments[${ci}] not an object`, raw)
        }
        const cc = c as Record<string, unknown>
        return {
          line: typeof cc.line === 'number' ? cc.line : 0,
          severity:
            cc.severity === 'high' || cc.severity === 'medium' || cc.severity === 'low'
              ? cc.severity
              : 'low',
          category:
            cc.category === 'security' ||
            cc.category === 'performance' ||
            cc.category === 'correctness' ||
            cc.category === 'style'
              ? cc.category
              : 'correctness',
          message: typeof cc.message === 'string' ? cc.message : ''
        }
      })
    }
  })

  return {
    qualityScore: Math.round(v.qualityScore),
    openingMessage: v.openingMessage,
    perFile
  }
}

export type { ReviewFindings }
````

- [ ] **Step 4: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/services/review-service.test.ts
```

Expected: all 7 parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/review-service.ts src/main/services/review-service.test.ts
git commit -m "feat: add review-service error classes + parseReviewResponse"
```

---

### Task C2: `ReviewService.reviewChanges` (TDD)

**Files:**

- Modify: `src/main/services/review-service.ts` (add the service factory)
- Modify: `src/main/services/review-service.test.ts` (add the flow tests)

- [ ] **Step 1: Extend the test file with service tests**

Append to `src/main/services/review-service.test.ts`:

```ts
import { createReviewService, WorktreeMissingError } from './review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { ReviewResult } from '../../shared/review-types'

function makeFakeRepo(): IReviewRepository & { _set: Record<string, ReviewResult> } {
  const _set: Record<string, ReviewResult> = {}
  return {
    _set,
    getCached: (taskId, sha) => _set[`${taskId}:${sha}`] ?? null,
    setCached: (taskId, sha, result) => {
      _set[`${taskId}:${sha}`] = result
    },
    invalidate: (taskId) => {
      for (const k of Object.keys(_set)) {
        if (k.startsWith(taskId + ':')) delete _set[k]
      }
    }
  }
}

function makeTask() {
  return {
    id: 'task-1',
    title: 'Fix auth',
    spec: '# Spec\nFix auth.',
    repo: 'bde',
    branch: 'feat/auth',
    status: 'review' as const
  }
}

function makeFakeTaskRepo(task = makeTask()) {
  return {
    getTask: (id: string) => (id === task.id ? task : null)
  } as any
}

function baseDeps(overrides: Partial<any> = {}) {
  return {
    repo: makeFakeRepo(),
    taskRepo: makeFakeTaskRepo(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    resolveWorktreePath: async () => '/tmp/fake-worktree',
    getHeadCommitSha: async () => 'sha-abc',
    getDiff: async () => 'diff --git a/x b/x\n+ change',
    runSdkOnce: async () =>
      JSON.stringify({
        qualityScore: 88,
        openingMessage: 'Looks good.',
        perFile: [
          {
            path: 'src/foo.ts',
            status: 'issues',
            comments: [
              { line: 10, severity: 'high', category: 'security', message: 'XSS' },
              { line: 20, severity: 'medium', category: 'correctness', message: 'Off-by-one' },
              { line: 30, severity: 'low', category: 'style', message: 'Name' }
            ]
          },
          { path: 'src/bar.ts', status: 'clean', comments: [] }
        ]
      }),
    ...overrides
  }
}

describe('reviewService.reviewChanges', () => {
  it('returns the cached result without hitting the SDK', async () => {
    const repo = makeFakeRepo()
    const cached: ReviewResult = {
      qualityScore: 77,
      issuesCount: 0,
      filesCount: 1,
      openingMessage: 'From cache.',
      findings: { perFile: [] },
      model: 'claude-opus-4-6',
      createdAt: 0
    }
    repo._set['task-1:sha-abc'] = cached

    let sdkCalled = false
    const svc = createReviewService(
      baseDeps({
        repo,
        runSdkOnce: async () => {
          sdkCalled = true
          return '{}'
        }
      })
    )

    const result = await svc.reviewChanges('task-1')
    expect(result.openingMessage).toBe('From cache.')
    expect(sdkCalled).toBe(false)
  })

  it('force:true bypasses the cache', async () => {
    const repo = makeFakeRepo()
    repo._set['task-1:sha-abc'] = {
      qualityScore: 1,
      issuesCount: 0,
      filesCount: 0,
      openingMessage: 'Stale.',
      findings: { perFile: [] },
      model: 'x',
      createdAt: 0
    }

    const svc = createReviewService(baseDeps({ repo }))
    const result = await svc.reviewChanges('task-1', { force: true })
    expect(result.openingMessage).toBe('Looks good.')
  })

  it('short-circuits on empty diff without calling the SDK', async () => {
    let sdkCalled = false
    const svc = createReviewService(
      baseDeps({
        getDiff: async () => '',
        runSdkOnce: async () => {
          sdkCalled = true
          return '{}'
        }
      })
    )
    const result = await svc.reviewChanges('task-1')
    expect(sdkCalled).toBe(false)
    expect(result.qualityScore).toBe(100)
    expect(result.filesCount).toBe(0)
    expect(result.openingMessage).toContain('No changes')
  })

  it('computes aggregates: filesCount and issuesCount (high+medium only)', async () => {
    const svc = createReviewService(baseDeps())
    const result = await svc.reviewChanges('task-1')
    expect(result.filesCount).toBe(2)
    // One high + one medium = 2 (the low-severity one does not count)
    expect(result.issuesCount).toBe(2)
  })

  it('persists the result to the cache', async () => {
    const repo = makeFakeRepo()
    const svc = createReviewService(baseDeps({ repo }))
    await svc.reviewChanges('task-1')
    expect(repo._set['task-1:sha-abc']).toBeDefined()
    expect(repo._set['task-1:sha-abc']?.qualityScore).toBe(88)
  })

  it('throws on malformed model response after one retry', async () => {
    const svc = createReviewService(baseDeps({ runSdkOnce: async () => 'not json, twice' }))
    await expect(svc.reviewChanges('task-1')).rejects.toThrow()
  })

  it('rejects when task is not in review status', async () => {
    const task = { ...makeTask(), status: 'queued' as const }
    const svc = createReviewService(baseDeps({ taskRepo: makeFakeTaskRepo(task) }))
    await expect(svc.reviewChanges('task-1')).rejects.toThrow(/review status/)
  })

  it('throws WorktreeMissingError when worktree resolver rejects', async () => {
    const svc = createReviewService(
      baseDeps({
        resolveWorktreePath: async () => {
          throw new WorktreeMissingError('/tmp/missing')
        }
      })
    )
    await expect(svc.reviewChanges('task-1')).rejects.toThrow(WorktreeMissingError)
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/services/review-service.test.ts
```

Expected: FAIL — `createReviewService` not exported.

- [ ] **Step 3: Implement `createReviewService`**

Append to `src/main/services/review-service.ts`:

```ts
import type { IReviewRepository } from '../data/review-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { SdkStreamingOptions } from '../sdk-streaming'
import type { ReviewResult, FileFinding } from '../../shared/review-types'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'

export interface ReviewServiceDeps {
  repo: IReviewRepository
  taskRepo: ISprintTaskRepository
  logger: Logger
  resolveWorktreePath: (taskId: string) => Promise<string>
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  getDiff: (worktreePath: string) => Promise<string>
  runSdkOnce: (prompt: string, options: SdkStreamingOptions) => Promise<string>
}

export interface ReviewService {
  reviewChanges(taskId: string, opts?: { force?: boolean }): Promise<ReviewResult>
}

const REVIEWER_MODEL = 'claude-opus-4-6'

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { repo, taskRepo, logger, resolveWorktreePath, getHeadCommitSha, getDiff, runSdkOnce } =
    deps

  return {
    async reviewChanges(taskId, opts) {
      const task = taskRepo.getTask(taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      if (task.status !== 'review') {
        throw new Error(`Task ${taskId} is not in review status (current: ${task.status})`)
      }

      const worktreePath = await resolveWorktreePath(taskId)
      const headSha = await getHeadCommitSha(worktreePath)

      if (!opts?.force) {
        const cached = repo.getCached(taskId, headSha)
        if (cached) {
          logger.info(`Cache hit for task=${taskId} sha=${headSha}`)
          return cached
        }
      }

      const diff = await getDiff(worktreePath)

      if (!diff.trim()) {
        logger.info(`Empty diff for task=${taskId} — synthetic result`)
        const synthetic: ReviewResult = {
          qualityScore: 100,
          issuesCount: 0,
          filesCount: 0,
          openingMessage: 'No changes detected on this branch.',
          findings: { perFile: [] },
          model: '(none)',
          createdAt: Date.now()
        }
        return synthetic
      }

      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: task.spec ?? task.title,
        branch: task.branch ?? '',
        diff
      })

      logger.info(`Firing auto-review for task=${taskId} sha=${headSha}`)
      let raw: string
      try {
        raw = await runSdkOnce(prompt, {
          model: REVIEWER_MODEL,
          maxTurns: 1,
          tools: []
        })
      } catch (err) {
        logger.error(`Review SDK call failed for task=${taskId}`, { err })
        throw err
      }

      let parsed
      try {
        parsed = parseReviewResponse(raw)
      } catch (firstErr) {
        logger.warn(`Parse failed once for task=${taskId} — retrying`)
        try {
          parsed = parseReviewResponse(raw)
        } catch (secondErr) {
          logger.error(`Parse failed twice for task=${taskId}`, {
            err: (secondErr as Error).message
          })
          throw secondErr
        }
      }

      const aggregates = aggregate(parsed.perFile)
      const result: ReviewResult = {
        qualityScore: parsed.qualityScore,
        issuesCount: aggregates.issuesCount,
        filesCount: aggregates.filesCount,
        openingMessage: parsed.openingMessage,
        findings: { perFile: parsed.perFile },
        model: REVIEWER_MODEL,
        createdAt: Date.now()
      }

      repo.setCached(taskId, headSha, result, raw)
      return result
    }
  }
}

function aggregate(perFile: FileFinding[]): {
  filesCount: number
  issuesCount: number
} {
  let issuesCount = 0
  for (const f of perFile) {
    for (const c of f.comments) {
      if (c.severity === 'high' || c.severity === 'medium') issuesCount++
    }
  }
  return { filesCount: perFile.length, issuesCount }
}
```

- [ ] **Step 4: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/services/review-service.test.ts
```

Expected: all 15 tests pass (7 parser + 8 service).

- [ ] **Step 5: Run the full main suite — confirm no regression**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/review-service.ts src/main/services/review-service.test.ts
git commit -m "feat: add reviewService.reviewChanges with cache + aggregation"
```

---

## Phase D — IPC layer

### Task D1: Add typed channels + preload bridge

**Files:**

- Modify: `src/shared/ipc-channels/sprint-channels.ts`
- Modify: `src/shared/ipc-channels/index.ts`
- Modify: `src/preload/index.ts`

**Pattern reference:** The IPC channel system uses per-domain interface maps keyed by channel name, with `{ args: [...], result: ... }` entries. `safeHandle()` and the renderer's `typedInvoke()` derive types from the aggregated `IpcChannelMap`. Adding new channels = adding entries to a domain interface + including that interface in the `IpcChannelMap` intersection.

- [ ] **Step 1: Read the existing review-related channel interface for shape reference**

```bash
grep -n "ReviewChannels\|ReviewPartnerChannels" src/shared/ipc-channels/sprint-channels.ts
```

Expected: `ReviewChannels` exists. You're adding a sibling `ReviewPartnerChannels` interface — don't merge into the existing one, they serve different concerns (the existing `ReviewChannels` covers the review lifecycle, the new interface covers the AI partner feature).

- [ ] **Step 2: Add `ReviewPartnerChannels` interface to sprint-channels.ts**

At the top of `src/shared/ipc-channels/sprint-channels.ts`, add the import if not already present:

```ts
import type { ReviewResult, PartnerMessage } from '../review-types'
```

Then append the new interface alongside the other exports (placement: after the existing `ReviewChannels` block):

```ts
export interface ReviewPartnerChannels {
  'review:autoReview': {
    args: [taskId: string, force: boolean]
    result: ReviewResult
  }
  'review:chatStream': {
    args: [
      input: {
        taskId: string
        messages: PartnerMessage[]
      }
    ]
    result: { streamId: string }
  }
  'review:chatAbort': {
    args: [streamId: string]
    result: void
  }
}
```

Note: `review:chatChunk` is a main→renderer **push** event (not an invoke), so it does NOT belong in this interface. The preload bridge handles push subscriptions via `ipcRenderer.on`.

- [ ] **Step 3: Export the new interface from `src/shared/ipc-channels/index.ts`**

Find the existing re-export block:

```ts
export type {
  SprintChannels,
  ReviewChannels,
  TemplateChannels,
  ...
} from './sprint-channels'
```

Add `ReviewPartnerChannels` to that list.

Then find the `IpcChannelMap` intersection at the bottom of the file and add:

```ts
  & import('./sprint-channels').ReviewPartnerChannels
```

…inserted in the chain alongside the existing `ReviewChannels` intersection.

- [ ] **Step 4: Typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors. If TypeScript complains that `review-types.ts` isn't found from `sprint-channels.ts`, the relative path should be `../review-types` from inside the `ipc-channels/` subdirectory.

- [ ] **Step 5: Add the `review` namespace to the preload bridge**

Open `src/preload/index.ts`. Find the existing `workbench` entry on `window.api` and add a sibling `review` entry that follows the same shape:

```ts
review: {
  autoReview: (taskId: string, force?: boolean) =>
    ipcRenderer.invoke('review:autoReview', taskId, force ?? false) as Promise<
      import('../shared/review-types').ReviewResult
    >,
  chatStream: (params: {
    taskId: string
    messages: import('../shared/review-types').PartnerMessage[]
  }) =>
    ipcRenderer.invoke('review:chatStream', params) as Promise<{ streamId: string }>,
  onChatChunk: (
    listener: (evt: unknown, chunk: import('../shared/review-types').ChatChunk) => void
  ) => {
    ipcRenderer.on('review:chatChunk', listener as never)
    return () => ipcRenderer.removeListener('review:chatChunk', listener as never)
  },
  abortChat: (streamId: string) =>
    ipcRenderer.invoke('review:chatAbort', streamId) as Promise<void>,
},
```

Also update the `Window.api` type declaration in the same file — add the matching `review` interface. Mirror the shape of the `workbench` declarations that already exist.

- [ ] **Step 6: Typecheck again**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-channels/sprint-channels.ts \
        src/shared/ipc-channels/index.ts \
        src/preload/index.ts
git commit -m "feat: add ReviewPartnerChannels + preload bridge"
```

---

### Task D2: Handler file with `safeHandle` + pure logic (TDD)

**Files:**

- Create: `src/main/handlers/review-assistant.ts`
- Create: `src/main/handlers/review-assistant.test.ts`

**Pattern reference:** `src/main/handlers/workbench.ts` — all handlers use `safeHandle('channel:name', async (e, input) => { ... })` from `../ipc-utils`. `safeHandle` is a typed wrapper that:

1. Derives `args` and `result` types from `IpcChannelMap[channel]`
2. Uses the module-level `ipcMain` — no `ipcMain` parameter needed
3. Automatically logs unhandled errors

Because `safeHandle` is tightly coupled to the module-level `ipcMain`, the handler file **cannot** take `ipcMain` as a dependency injection — the module imports it and calls `safeHandle` directly during registration. This is why we factor the logic into pure testable functions first, then wrap them in `safeHandle` calls.

- [ ] **Step 1: Write the failing test for the pure logic functions**

Write `src/main/handlers/review-assistant.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleAutoReview, handleChatStream, buildChatStreamDeps } from './review-assistant'
import type { ReviewService } from '../services/review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { ReviewResult, PartnerMessage, ChatChunk } from '../../shared/review-types'

function fakeResult(): ReviewResult {
  return {
    qualityScore: 88,
    issuesCount: 1,
    filesCount: 1,
    openingMessage: 'ok',
    findings: { perFile: [] },
    model: 'claude-opus-4-6',
    createdAt: 0
  }
}

function fakeTask() {
  return {
    id: 'task-1',
    title: 'Fix auth',
    spec: '# Spec',
    repo: 'bde',
    branch: 'feat/auth',
    status: 'review' as const,
    worktree_path: '/tmp/wt'
  } as any
}

describe('handleAutoReview', () => {
  it('delegates to reviewService.reviewChanges', async () => {
    const reviewChanges = vi.fn().mockResolvedValue(fakeResult())
    const svc: ReviewService = { reviewChanges }
    const result = await handleAutoReview(svc, 'task-1', false)
    expect(reviewChanges).toHaveBeenCalledWith('task-1', { force: false })
    expect(result.qualityScore).toBe(88)
  })

  it('passes force flag through', async () => {
    const reviewChanges = vi.fn().mockResolvedValue(fakeResult())
    await handleAutoReview({ reviewChanges }, 'task-x', true)
    expect(reviewChanges).toHaveBeenCalledWith('task-x', { force: true })
  })

  it('rejects when reviewService throws', async () => {
    const reviewChanges = vi.fn().mockRejectedValue(new Error('nope'))
    await expect(handleAutoReview({ reviewChanges }, 'task-y', false)).rejects.toThrow('nope')
  })
})

describe('handleChatStream', () => {
  it('starts a stream and emits chunks + done', async () => {
    const chunks: ChatChunk[] = []
    const sender = { send: (_ch: string, payload: ChatChunk) => chunks.push(payload) }
    const deps = {
      taskRepo: { getTask: () => fakeTask() } as unknown as ISprintTaskRepository,
      reviewRepo: {
        getCached: () => fakeResult(),
        setCached: () => {},
        invalidate: () => {}
      } as IReviewRepository,
      getHeadCommitSha: async () => 'sha-abc',
      buildChatPrompt: vi.fn().mockReturnValue('BUILT_PROMPT'),
      runSdkStreaming: vi.fn(
        async (
          _prompt: string,
          onChunk: (c: string) => void,
          _map: Map<string, { close: () => void }>,
          _id: string,
          _t: number,
          _opts: any
        ) => {
          onChunk('hello ')
          onChunk('world')
          return 'hello world'
        }
      ),
      activeStreams: new Map<string, { close: () => void }>()
    }
    const input: { taskId: string; messages: PartnerMessage[] } = {
      taskId: 'task-1',
      messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 0 }]
    }

    const { streamId } = await handleChatStream(deps, input, sender as any)
    // Streaming runs asynchronously after the return — flush microtasks
    await new Promise((r) => setImmediate(r))

    expect(streamId).toMatch(/^review-/)
    expect(deps.buildChatPrompt).toHaveBeenCalled()
    const promptArg = deps.buildChatPrompt.mock.calls[0]?.[0]
    expect(promptArg?.agentType).toBe('reviewer')
    expect(promptArg?.reviewerMode).toBe('chat')
    expect(promptArg?.reviewSeed).toBeDefined() // seed lookup confirmed
    expect(chunks.some((c) => c.chunk === 'hello ')).toBe(true)
    expect(chunks.some((c) => c.done === true)).toBe(true)
  })

  it('emits error chunk when runSdkStreaming throws', async () => {
    const chunks: ChatChunk[] = []
    const sender = { send: (_c: string, p: ChatChunk) => chunks.push(p) }
    const deps = {
      taskRepo: { getTask: () => fakeTask() } as unknown as ISprintTaskRepository,
      reviewRepo: {
        getCached: () => null,
        setCached: () => {},
        invalidate: () => {}
      } as IReviewRepository,
      getHeadCommitSha: async () => 'sha-abc',
      buildChatPrompt: () => 'prompt',
      runSdkStreaming: async () => {
        throw new Error('rate limit')
      },
      activeStreams: new Map<string, { close: () => void }>()
    }
    await handleChatStream(deps, { taskId: 'task-1', messages: [] }, sender as any)
    await new Promise((r) => setImmediate(r))
    expect(chunks.some((c) => c.error?.includes('rate limit'))).toBe(true)
  })

  it('throws when task is not found', async () => {
    const sender = { send: () => {} }
    const deps = {
      taskRepo: { getTask: () => null } as unknown as ISprintTaskRepository,
      reviewRepo: { getCached: () => null, setCached: () => {}, invalidate: () => {} },
      getHeadCommitSha: async () => 'sha',
      buildChatPrompt: () => '',
      runSdkStreaming: async () => '',
      activeStreams: new Map()
    }
    await expect(
      handleChatStream(deps, { taskId: 'missing', messages: [] }, sender as any)
    ).rejects.toThrow(/not found/i)
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/handlers/review-assistant.test.ts
```

Expected: FAIL — `Cannot find module './review-assistant'`.

- [ ] **Step 3: Implement the handler module**

Write `src/main/handlers/review-assistant.ts`:

```ts
import type { WebContents } from 'electron'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'
import { runSdkStreaming } from '../sdk-streaming'
import type { ReviewService } from '../services/review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { ChatChunk, PartnerMessage, ReviewResult } from '../../shared/review-types'

const log = createLogger('review-assistant')

// ---------- Pure logic functions (testable without ipcMain) ----------

/** autoReview handler body — extracted for unit testing. */
export async function handleAutoReview(
  svc: Pick<ReviewService, 'reviewChanges'>,
  taskId: string,
  force: boolean
): Promise<ReviewResult> {
  log.info(`review:autoReview task=${taskId} force=${force}`)
  return svc.reviewChanges(taskId, { force })
}

export interface ChatStreamDeps {
  taskRepo: ISprintTaskRepository
  reviewRepo: IReviewRepository
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  buildChatPrompt: typeof buildAgentPrompt
  runSdkStreaming: typeof runSdkStreaming
  activeStreams: Map<string, { close: () => void }>
}

/**
 * chatStream handler body — extracted for unit testing. Returns immediately
 * with the streamId; streaming runs asynchronously and pushes chunks to the
 * sender via `review:chatChunk`.
 */
export async function handleChatStream(
  deps: ChatStreamDeps,
  input: { taskId: string; messages: PartnerMessage[] },
  sender: Pick<WebContents, 'send'> | null
): Promise<{ streamId: string }> {
  const streamId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  log.info(`review:chatStream task=${input.taskId} stream=${streamId}`)

  const task = deps.taskRepo.getTask(input.taskId)
  if (!task) throw new Error(`Task not found: ${input.taskId}`)
  if (!task.worktree_path) {
    throw new Error(`Task ${input.taskId} has no worktree path`)
  }

  // Look up the cached review to pass as reviewSeed — gives the chat model
  // access to the structured auto-review state, not just visible messages.
  let reviewSeed: ReviewResult | undefined
  try {
    const headSha = await deps.getHeadCommitSha(task.worktree_path)
    reviewSeed = deps.reviewRepo.getCached(input.taskId, headSha) ?? undefined
  } catch (err) {
    log.warn(`Could not load review seed for task=${input.taskId}`, {
      err: (err as Error).message
    })
  }

  const prompt = deps.buildChatPrompt({
    agentType: 'reviewer',
    reviewerMode: 'chat',
    taskContent: task.spec ?? task.title,
    branch: task.branch ?? '',
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    reviewSeed
  })

  void (async () => {
    try {
      const full = await deps.runSdkStreaming(
        prompt,
        (chunk) => {
          const payload: ChatChunk = { streamId, chunk }
          sender?.send('review:chatChunk', payload)
        },
        deps.activeStreams,
        streamId,
        180_000,
        {
          cwd: task.worktree_path!,
          tools: ['Read', 'Grep', 'Glob'],
          model: 'claude-opus-4-6',
          onToolUse: (event) => {
            const payload: ChatChunk = { streamId, toolUse: event }
            sender?.send('review:chatChunk', payload)
          }
        }
      )
      const done: ChatChunk = { streamId, done: true, fullText: full }
      sender?.send('review:chatChunk', done)
    } catch (err) {
      log.error(`review:chatStream failed stream=${streamId}`, {
        err: (err as Error).message
      })
      const payload: ChatChunk = { streamId, error: (err as Error).message }
      sender?.send('review:chatChunk', payload)
    }
  })()

  return { streamId }
}

/** Build the ChatStreamDeps bag from the registration inputs. */
export function buildChatStreamDeps(input: {
  taskRepo: ISprintTaskRepository
  reviewRepo: IReviewRepository
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  activeStreams: Map<string, { close: () => void }>
}): ChatStreamDeps {
  return {
    ...input,
    buildChatPrompt: buildAgentPrompt,
    runSdkStreaming
  }
}

// ---------- Registration (wraps the pure functions in safeHandle) ----------

export interface ReviewAssistantRegistrationInput {
  reviewService: ReviewService
  chatStreamDeps: ChatStreamDeps
}

export function registerReviewAssistantHandlers(input: ReviewAssistantRegistrationInput): void {
  safeHandle('review:autoReview', async (_e, taskId, force) => {
    return handleAutoReview(input.reviewService, taskId, force)
  })

  safeHandle('review:chatStream', async (e, chatInput) => {
    return handleChatStream(input.chatStreamDeps, chatInput, e.sender)
  })

  safeHandle('review:chatAbort', async (_e, streamId) => {
    log.info(`review:chatAbort stream=${streamId}`)
    const entry = input.chatStreamDeps.activeStreams.get(streamId)
    if (entry) entry.close()
  })
}
```

- [ ] **Step 4: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run src/main/handlers/review-assistant.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Typecheck + full main tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck && npm run test:main -- --run
```

Expected: zero type errors, all tests pass. If TypeScript complains about `safeHandle('review:autoReview', ...)` arg types, the channel entries in `sprint-channels.ts` (Task D1) need correcting — the channel map is the source of truth for handler types.

- [ ] **Step 6: Commit**

```bash
git add src/main/handlers/review-assistant.ts src/main/handlers/review-assistant.test.ts
git commit -m "feat: add review-assistant handlers via safeHandle"
```

---

### Task D3: Wire handlers into `src/main/index.ts`

**Files:**

- Modify: `src/main/index.ts`

**Pattern reference:** `task.worktree_path` is a column on the `SprintTask` row — confirmed in use at `src/main/handlers/review.ts:132` (`if (!task.worktree_path) throw new Error(...)`). Use this field as the canonical worktree path. Do NOT invoke `agentManager.getWorktreePath(taskId)` — no such method exists.

- [ ] **Step 1: Read the file to find the existing registration block**

```bash
grep -n "register" src/main/index.ts | head -20
```

Expected: a sequence of `register*Handlers` calls — find one nearby (e.g. `registerWorkbenchHandlers`) and add the review registration next to it.

- [ ] **Step 2: Import the handler factory and the dependencies**

Near the top of `src/main/index.ts`, add:

```ts
import { registerReviewAssistantHandlers, buildChatStreamDeps } from './handlers/review-assistant'
import { createReviewRepository } from './data/review-repository'
import { createReviewService } from './services/review-service'
import { runSdkOnce } from './sdk-streaming'
```

- [ ] **Step 3: Build the worktree resolver closure**

Since `task.worktree_path` is the canonical source, create a single helper used by both the service and the chat-stream deps:

```ts
function resolveWorktreePathViaRepo(taskId: string): string {
  const task = sprintTaskRepository.getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  if (!task.worktree_path) {
    throw new Error(`Task ${taskId} has no worktree_path`)
  }
  return task.worktree_path
}
```

(Replace `sprintTaskRepository` with the actual identifier used in the file — typically created earlier as `const sprintTaskRepository = createSprintTaskRepository(db)`.)

- [ ] **Step 4: Register the review handlers**

After the sprint-task repository is created, add:

```ts
const reviewRepo = createReviewRepository(db)
const reviewServiceLogger = createLogger('review-service')

const getHeadCommitSha = async (worktreePath: string): Promise<string> => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

const reviewService = createReviewService({
  repo: reviewRepo,
  taskRepo: sprintTaskRepository,
  logger: reviewServiceLogger,
  resolveWorktreePath: async (taskId) => resolveWorktreePathViaRepo(taskId),
  getHeadCommitSha,
  getDiff: async (worktreePath) => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'diff', 'main...HEAD'], {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout
  },
  runSdkOnce
})

const reviewActiveStreams = new Map<string, { close: () => void }>()
registerReviewAssistantHandlers({
  reviewService,
  chatStreamDeps: buildChatStreamDeps({
    taskRepo: sprintTaskRepository,
    reviewRepo,
    getHeadCommitSha,
    activeStreams: reviewActiveStreams
  })
})
```

Note: the exact names of `db` and `sprintTaskRepository` may differ — replace with whatever identifiers the existing registrations use.

- [ ] **Step 5: Typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors. Fix any identifier mismatches by grepping the file for the canonical names.

- [ ] **Step 6: Main tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run test:main -- --run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: register review-assistant handlers in main"
```

---

## Phase E — Renderer store + hook

### Task E1: Zustand store scaffold (TDD)

**Files:**

- Create: `src/renderer/src/stores/reviewPartner.ts`
- Create: `src/renderer/src/stores/reviewPartner.test.ts`

Reference pattern: `src/renderer/src/stores/taskWorkbench.ts` for persistence + shape conventions.

- [ ] **Step 1: Write the failing test**

Write `src/renderer/src/stores/reviewPartner.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReviewPartnerStore } from './reviewPartner'
import type { ReviewResult, ChatChunk } from '../../../shared/review-types'

function freshResult(): ReviewResult {
  return {
    qualityScore: 90,
    issuesCount: 2,
    filesCount: 3,
    openingMessage: 'Nice work overall.',
    findings: { perFile: [] },
    model: 'claude-opus-4-6',
    createdAt: Date.now()
  }
}

// Ambient mock for window.api.review — set per test
function mockApi(overrides: Partial<any> = {}) {
  const api: any = {
    review: {
      autoReview: vi.fn().mockResolvedValue(freshResult()),
      chatStream: vi.fn().mockResolvedValue({ streamId: 'stream-1' }),
      onChatChunk: vi.fn().mockReturnValue(() => {}),
      abortChat: vi.fn().mockResolvedValue(undefined),
      ...overrides.review
    }
  }
  ;(window as any).api = api
  return api
}

describe('useReviewPartnerStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useReviewPartnerStore.setState({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {}
    })
  })

  describe('panel toggle', () => {
    it('flips panelOpen', () => {
      useReviewPartnerStore.getState().togglePanel()
      expect(useReviewPartnerStore.getState().panelOpen).toBe(true)
      useReviewPartnerStore.getState().togglePanel()
      expect(useReviewPartnerStore.getState().panelOpen).toBe(false)
    })
  })

  describe('autoReview', () => {
    it('transitions idle → loading → ready and stores the result', async () => {
      mockApi()
      const states: string[] = []
      const unsub = useReviewPartnerStore.subscribe((s) => {
        const st = s.reviewByTask['task-1']?.status
        if (st) states.push(st)
      })
      await useReviewPartnerStore.getState().autoReview('task-1')
      unsub()
      expect(states).toContain('loading')
      const final = useReviewPartnerStore.getState().reviewByTask['task-1']
      expect(final?.status).toBe('ready')
      expect(final?.result?.qualityScore).toBe(90)
    })

    it('sets status:error when autoReview rejects', async () => {
      mockApi({ review: { autoReview: vi.fn().mockRejectedValue(new Error('boom')) } })
      await useReviewPartnerStore.getState().autoReview('task-1')
      const final = useReviewPartnerStore.getState().reviewByTask['task-1']
      expect(final?.status).toBe('error')
      expect(final?.error).toContain('boom')
    })

    it('seeds messagesByTask with the opening message on first success', async () => {
      mockApi()
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(1)
      expect(msgs[0]?.role).toBe('assistant')
      expect(msgs[0]?.content).toBe('Nice work overall.')
    })

    it('does not re-seed the opening message if user has already added messages', async () => {
      mockApi()
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [
            { id: 'u1', role: 'user', content: 'Hi', timestamp: 0 },
            { id: 'a1', role: 'assistant', content: 'Hello', timestamp: 1 }
          ]
        }
      })
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(2)
      expect(msgs[0]?.content).toBe('Hi')
    })

    // Note: after clearMessages(taskId), messagesByTask[taskId] becomes [],
    // so a subsequent autoReview (triggered by "Re-review") WILL re-seed the
    // opening message. This is intentional — "Clear thread" is meant to give
    // the user a fresh start, and seeding the new review is part of that.
    it('re-seeds opening message after clearMessages', async () => {
      mockApi()
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: 'u1', role: 'user', content: 'Old', timestamp: 0 }]
        }
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      await useReviewPartnerStore.getState().autoReview('task-1')
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(1)
      expect(msgs[0]?.role).toBe('assistant')
      expect(msgs[0]?.content).toBe('Nice work overall.')
    })
  })

  describe('sendMessage', () => {
    it('appends a user message and a streaming assistant message', async () => {
      const chunkListeners: Array<(e: unknown, c: ChatChunk) => void> = []
      mockApi({
        review: {
          autoReview: vi.fn().mockResolvedValue(freshResult()),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-1' }),
          onChatChunk: vi.fn((cb: any) => {
            chunkListeners.push(cb)
            return () => {}
          }),
          abortChat: vi.fn().mockResolvedValue(undefined)
        }
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'What are the risks?')

      let msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs).toHaveLength(2)
      expect(msgs[0]?.role).toBe('user')
      expect(msgs[0]?.content).toBe('What are the risks?')
      expect(msgs[1]?.role).toBe('assistant')
      expect(msgs[1]?.streaming).toBe(true)

      // Simulate streamed chunks
      chunkListeners[0]?.({}, { streamId: 's-1', chunk: 'The ' })
      chunkListeners[0]?.({}, { streamId: 's-1', chunk: 'risks are…' })
      chunkListeners[0]?.({}, { streamId: 's-1', done: true, fullText: 'The risks are…' })

      msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs[1]?.content).toBe('The risks are…')
      expect(msgs[1]?.streaming).toBeFalsy()
    })

    it('sets error text on the streaming message when an error chunk arrives', async () => {
      const chunkListeners: Array<(e: unknown, c: ChatChunk) => void> = []
      mockApi({
        review: {
          autoReview: vi.fn(),
          chatStream: vi.fn().mockResolvedValue({ streamId: 's-2' }),
          onChatChunk: vi.fn((cb: any) => {
            chunkListeners.push(cb)
            return () => {}
          }),
          abortChat: vi.fn()
        }
      })
      await useReviewPartnerStore.getState().sendMessage('task-1', 'Hi')
      chunkListeners[0]?.({}, { streamId: 's-2', error: 'Claude Code rate limit reached.' })
      const msgs = useReviewPartnerStore.getState().messagesByTask['task-1'] ?? []
      expect(msgs[1]?.content).toContain('rate limit')
      expect(msgs[1]?.streaming).toBeFalsy()
    })
  })

  describe('clearMessages', () => {
    it('removes all messages for a task', () => {
      useReviewPartnerStore.setState({
        messagesByTask: {
          'task-1': [{ id: '1', role: 'user', content: 'x', timestamp: 0 }]
        }
      })
      useReviewPartnerStore.getState().clearMessages('task-1')
      expect(useReviewPartnerStore.getState().messagesByTask['task-1']).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/stores/reviewPartner.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Write `src/renderer/src/stores/reviewPartner.ts`:

```ts
import { create } from 'zustand'
import type { ReviewResult, PartnerMessage, ChatChunk } from '../../../shared/review-types'

const MESSAGES_STORAGE_KEY = 'bde:review-partner-messages'
const PANEL_OPEN_KEY = 'bde:review-partner-open'
const MAX_MESSAGES_PER_TASK = 100
const MAX_TASKS_IN_LOCAL_STORAGE = 20

export interface ReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: ReviewResult
  error?: string
}

interface PersistedMessages {
  messagesByTask: Record<string, PartnerMessage[]>
  lruOrder: string[] // taskIds, most recently touched last
}

export interface ReviewPartnerStore {
  panelOpen: boolean
  togglePanel: () => void

  reviewByTask: Record<string, ReviewState>
  messagesByTask: Record<string, PartnerMessage[]>
  activeStreamByTask: Record<string, string | null>

  autoReview: (taskId: string, opts?: { force?: boolean }) => Promise<void>
  sendMessage: (taskId: string, content: string) => Promise<void>
  abortStream: (taskId: string) => Promise<void>
  clearMessages: (taskId: string) => void
  appendQuickAction: (taskId: string, prompt: string) => Promise<void>
}

function loadMessages(): PersistedMessages {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY)
    if (!raw) return { messagesByTask: {}, lruOrder: [] }
    const parsed = JSON.parse(raw)
    return {
      messagesByTask: parsed.messagesByTask ?? {},
      lruOrder: parsed.lruOrder ?? []
    }
  } catch {
    return { messagesByTask: {}, lruOrder: [] }
  }
}

function saveMessages(messagesByTask: Record<string, PartnerMessage[]>): void {
  try {
    const lruOrder = Object.keys(messagesByTask)
    const trimmed: Record<string, PartnerMessage[]> = {}
    const keepIds = lruOrder.slice(-MAX_TASKS_IN_LOCAL_STORAGE)
    for (const id of keepIds) {
      const msgs = messagesByTask[id] ?? []
      trimmed[id] = msgs.slice(-MAX_MESSAGES_PER_TASK)
    }
    localStorage.setItem(
      MESSAGES_STORAGE_KEY,
      JSON.stringify({ messagesByTask: trimmed, lruOrder: keepIds })
    )
  } catch {
    // localStorage full or unavailable — swallow
  }
}

function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function savePanelOpen(value: boolean): void {
  try {
    localStorage.setItem(PANEL_OPEN_KEY, value ? '1' : '0')
  } catch {
    // noop
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const initial = loadMessages()

export const useReviewPartnerStore = create<ReviewPartnerStore>((set, get) => ({
  panelOpen: loadPanelOpen(),
  reviewByTask: {},
  messagesByTask: initial.messagesByTask,
  activeStreamByTask: {},

  togglePanel: () => {
    const next = !get().panelOpen
    set({ panelOpen: next })
    savePanelOpen(next)
  },

  async autoReview(taskId, opts) {
    const prev = get().reviewByTask[taskId]
    if (prev?.status === 'loading') return

    set((s) => ({
      reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'loading' } }
    }))

    try {
      const result = await window.api.review.autoReview(taskId, opts?.force ?? false)
      set((s) => {
        const existingMessages = s.messagesByTask[taskId] ?? []
        // Only seed if the user hasn't started a conversation yet
        const messages =
          existingMessages.length === 0
            ? [
                {
                  id: newId('seed'),
                  role: 'assistant' as const,
                  content: result.openingMessage,
                  timestamp: Date.now()
                }
              ]
            : existingMessages
        const nextMsgs = { ...s.messagesByTask, [taskId]: messages }
        saveMessages(nextMsgs)
        return {
          reviewByTask: { ...s.reviewByTask, [taskId]: { status: 'ready', result } },
          messagesByTask: nextMsgs
        }
      })
    } catch (err) {
      set((s) => ({
        reviewByTask: {
          ...s.reviewByTask,
          [taskId]: { status: 'error', error: (err as Error).message }
        }
      }))
    }
  },

  async sendMessage(taskId, content) {
    const userMsg: PartnerMessage = {
      id: newId('u'),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    const streamingMsg: PartnerMessage = {
      id: newId('a'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true
    }

    set((s) => {
      const prior = s.messagesByTask[taskId] ?? []
      const next = [...prior, userMsg, streamingMsg]
      const nextMsgs = { ...s.messagesByTask, [taskId]: next }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })

    let unsubscribe: (() => void) | null = null
    try {
      // Subscribe BEFORE invoking chatStream so we don't miss early chunks.
      let streamId: string | null = null

      unsubscribe = window.api.review.onChatChunk((_e: unknown, chunk: ChatChunk) => {
        if (streamId && chunk.streamId !== streamId) return
        set((s) => {
          const msgs = [...(s.messagesByTask[taskId] ?? [])]
          const last = msgs[msgs.length - 1]
          if (!last || last.id !== streamingMsg.id) return s

          if (chunk.error) {
            msgs[msgs.length - 1] = {
              ...last,
              content: (last.content ? last.content + '\n\n' : '') + `Error: ${chunk.error}`,
              streaming: false
            }
          } else if (chunk.done) {
            msgs[msgs.length - 1] = {
              ...last,
              content: chunk.fullText ?? last.content,
              streaming: false
            }
          } else if (chunk.chunk) {
            msgs[msgs.length - 1] = { ...last, content: last.content + chunk.chunk }
          }

          const nextMsgs = { ...s.messagesByTask, [taskId]: msgs }
          saveMessages(nextMsgs)

          let activeStreamByTask = s.activeStreamByTask
          if (chunk.done || chunk.error) {
            activeStreamByTask = { ...s.activeStreamByTask, [taskId]: null }
            unsubscribe?.()
          }
          return { messagesByTask: nextMsgs, activeStreamByTask }
        })
      })

      const messages = (get().messagesByTask[taskId] ?? []).slice(0, -1) // exclude the empty streaming msg
      const { streamId: sid } = await window.api.review.chatStream({ taskId, messages })
      streamId = sid
      set((s) => ({
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: streamId }
      }))
    } catch (err) {
      set((s) => {
        const msgs = [...(s.messagesByTask[taskId] ?? [])]
        const last = msgs[msgs.length - 1]
        if (last && last.id === streamingMsg.id) {
          msgs[msgs.length - 1] = {
            ...last,
            content: `Error: ${(err as Error).message}`,
            streaming: false
          }
        }
        return { messagesByTask: { ...s.messagesByTask, [taskId]: msgs } }
      })
      unsubscribe?.()
    }
  },

  async abortStream(taskId) {
    const streamId = get().activeStreamByTask[taskId]
    if (!streamId) return
    await window.api.review.abortChat(streamId)
    set((s) => {
      const msgs = [...(s.messagesByTask[taskId] ?? [])]
      const last = msgs[msgs.length - 1]
      if (last?.streaming) {
        msgs[msgs.length - 1] = { ...last, streaming: false }
      }
      return {
        messagesByTask: { ...s.messagesByTask, [taskId]: msgs },
        activeStreamByTask: { ...s.activeStreamByTask, [taskId]: null }
      }
    })
  },

  clearMessages(taskId) {
    set((s) => {
      const nextMsgs = { ...s.messagesByTask, [taskId]: [] }
      saveMessages(nextMsgs)
      return { messagesByTask: nextMsgs }
    })
  },

  async appendQuickAction(taskId, prompt) {
    await get().sendMessage(taskId, prompt)
  }
}))
```

- [ ] **Step 4: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/stores/reviewPartner.test.ts
```

Expected: all 8 tests pass. If subscribe-BEFORE-invoke timing makes the "append streaming message" test flaky, add a short `await new Promise((r) => setTimeout(r, 0))` after `sendMessage` in the test.

- [ ] **Step 5: Typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/reviewPartner.ts src/renderer/src/stores/reviewPartner.test.ts
git commit -m "feat: add reviewPartner Zustand store"
```

---

### Task E2: `useAutoReview` hook (TDD)

**Files:**

- Create: `src/renderer/src/hooks/useAutoReview.ts`
- Create: `src/renderer/src/hooks/useAutoReview.test.ts`

- [ ] **Step 1: Write the failing test**

Write `src/renderer/src/hooks/useAutoReview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoReview } from './useAutoReview'
import { useReviewPartnerStore } from '../stores/reviewPartner'

describe('useAutoReview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useReviewPartnerStore.setState({ reviewByTask: {}, messagesByTask: {} })
    ;(window as any).api = {
      review: {
        autoReview: vi.fn().mockResolvedValue({
          qualityScore: 90,
          issuesCount: 0,
          filesCount: 0,
          openingMessage: 'ok',
          findings: { perFile: [] },
          model: 'claude-opus-4-6',
          createdAt: 0
        }),
        onChatChunk: () => () => {}
      }
    }
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires autoReview after 2 s when task is in review status', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview('task-1', 'review'))
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(spy).toHaveBeenCalledWith('task-1')
  })

  it('does NOT fire when status is not review', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview('task-1', 'active'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT fire when taskId is null', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview(null, 'review'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('cancels pending fire when task changes before debounce elapses', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    const { rerender } = renderHook(({ id }: { id: string }) => useAutoReview(id, 'review'), {
      initialProps: { id: 'task-1' }
    })
    await vi.advanceTimersByTimeAsync(1000)
    rerender({ id: 'task-2' })
    await vi.advanceTimersByTimeAsync(1000)
    // Only 1000ms elapsed since rerender — debounce not yet fired
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('task-2')
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/hooks/useAutoReview.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Write `src/renderer/src/hooks/useAutoReview.ts`:

```ts
import { useEffect } from 'react'
import { useReviewPartnerStore } from '../stores/reviewPartner'
import type { TaskStatus } from '../../../shared/contract'

const DEBOUNCE_MS = 2000

/**
 * Debounces an auto-review fire when the user selects a task in review status.
 * Rapid task switches cancel the pending fire — only the last stable selection
 * triggers a review.
 */
export function useAutoReview(taskId: string | null, taskStatus: TaskStatus | null): void {
  const autoReview = useReviewPartnerStore((s) => s.autoReview)

  useEffect(() => {
    if (!taskId || taskStatus !== 'review') return
    const handle = setTimeout(() => {
      autoReview(taskId).catch(() => {
        // errors surface via store.reviewByTask[taskId].error; swallow here
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [taskId, taskStatus, autoReview])
}
```

Note: if `TaskStatus` is not exported from `src/shared/contract.ts`, import from wherever `src/shared/task-transitions.ts` exposes it. Check with:

```bash
grep -n "export.*TaskStatus" src/shared/
```

- [ ] **Step 4: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/hooks/useAutoReview.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useAutoReview.ts src/renderer/src/hooks/useAutoReview.test.ts
git commit -m "feat: add useAutoReview debounced hook"
```

---

## Phase F — Primitive components

### Task F1: `AIFileStatusBadge` + `AIReviewedBadge`

**Files:**

- Create: `src/renderer/src/components/code-review/AIFileStatusBadge.tsx`
- Create: `src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx`
- Create: `src/renderer/src/components/code-review/AIReviewedBadge.tsx`

- [ ] **Step 1: Write the failing test for `AIFileStatusBadge`**

Write `src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIFileStatusBadge } from './AIFileStatusBadge'

describe('AIFileStatusBadge', () => {
  it('renders a warning indicator for issues status', () => {
    render(<AIFileStatusBadge status="issues" />)
    expect(screen.getByRole('img', { name: /file has issues/i })).toBeInTheDocument()
  })

  it('renders a check indicator for clean status', () => {
    render(<AIFileStatusBadge status="clean" />)
    expect(screen.getByRole('img', { name: /file reviewed clean/i })).toBeInTheDocument()
  })

  it('renders nothing for unreviewed status', () => {
    const { container } = render(<AIFileStatusBadge status="unreviewed" />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement both badge components**

Write `src/renderer/src/components/code-review/AIFileStatusBadge.tsx`:

```tsx
import { AlertTriangle, Check } from 'lucide-react'
import type { JSX } from 'react'

export type FileReviewStatus = 'clean' | 'issues' | 'unreviewed'

export function AIFileStatusBadge({ status }: { status: FileReviewStatus }): JSX.Element | null {
  if (status === 'unreviewed') return null

  if (status === 'issues') {
    return (
      <span role="img" aria-label="File has issues" className="cr-ai-status cr-ai-status--issues">
        <AlertTriangle size={10} />
      </span>
    )
  }

  return (
    <span role="img" aria-label="File reviewed clean" className="cr-ai-status cr-ai-status--clean">
      <Check size={10} />
    </span>
  )
}
```

Write `src/renderer/src/components/code-review/AIReviewedBadge.tsx`:

```tsx
import { Sparkles } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  commentCount: number
}

export function AIReviewedBadge({ commentCount }: Props): JSX.Element {
  return (
    <span className="cr-ai-reviewed" aria-label={`AI reviewed — ${commentCount} comments`}>
      <Sparkles size={12} />
      <span className="cr-ai-reviewed__label">AI Reviewed</span>
      {commentCount > 0 && <span className="cr-ai-reviewed__count">{commentCount}</span>}
    </span>
  )
}
```

- [ ] **Step 4: Add CSS for the badges**

Append to the existing code-review CSS file (`src/renderer/src/components/code-review/CodeReviewView.css` or the nearest file with `cr-*` classes — use whatever exists). Add:

```css
/* AI file status badges */
.cr-ai-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: var(--bde-radius-sm);
}
.cr-ai-status--issues {
  color: var(--bde-warning);
}
.cr-ai-status--clean {
  color: var(--bde-success);
}

/* AI reviewed file-header badge */
.cr-ai-reviewed {
  display: inline-flex;
  align-items: center;
  gap: var(--bde-space-2);
  padding: 2px var(--bde-space-3);
  border-radius: var(--bde-radius-md);
  background: var(--bde-purple-surface, var(--bde-surface-high));
  color: var(--bde-purple);
  font-size: var(--bde-size-xs);
}
.cr-ai-reviewed__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bde-purple);
  color: var(--bde-bg);
  font-weight: 600;
}
```

- [ ] **Step 5: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/code-review/AIFileStatusBadge.tsx \
        src/renderer/src/components/code-review/AIFileStatusBadge.test.tsx \
        src/renderer/src/components/code-review/AIReviewedBadge.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: add AI file status + reviewed badges"
```

---

### Task F2: `BranchBar` + `ReviewMetricsRow`

**Files:**

- Create: `src/renderer/src/components/code-review/BranchBar.tsx`
- Create: `src/renderer/src/components/code-review/ReviewMetricsRow.tsx`
- Create: `src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx`

- [ ] **Step 1: Write the failing test for `ReviewMetricsRow`**

Write `src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewMetricsRow } from './ReviewMetricsRow'

describe('ReviewMetricsRow', () => {
  it('renders all three metrics with accessible labels', () => {
    render(<ReviewMetricsRow qualityScore={92} issuesCount={3} filesCount={8} />)
    expect(screen.getByLabelText(/quality score 92/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/3 issues found/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/8 files changed/i)).toBeInTheDocument()
  })

  it('renders loading placeholders when metrics are undefined', () => {
    render(<ReviewMetricsRow loading />)
    const placeholders = screen.getAllByText('—')
    expect(placeholders.length).toBe(3)
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `ReviewMetricsRow`**

Write `src/renderer/src/components/code-review/ReviewMetricsRow.tsx`:

```tsx
import { CheckCircle2, Shield, TrendingUp } from 'lucide-react'
import type { JSX, ReactNode } from 'react'

interface Props {
  qualityScore?: number
  issuesCount?: number
  filesCount?: number
  loading?: boolean
}

export function ReviewMetricsRow({
  qualityScore,
  issuesCount,
  filesCount,
  loading = false
}: Props): JSX.Element {
  return (
    <div className="cr-metrics" role="group" aria-label="AI review metrics">
      <MetricCard
        icon={<CheckCircle2 size={16} />}
        value={loading || qualityScore === undefined ? '—' : qualityScore}
        label="Quality"
        ariaLabel={
          qualityScore !== undefined
            ? `Quality score ${qualityScore} out of 100`
            : 'Quality score pending'
        }
        variant="success"
      />
      <MetricCard
        icon={<Shield size={16} />}
        value={loading || issuesCount === undefined ? '—' : issuesCount}
        label="Issues"
        ariaLabel={
          issuesCount !== undefined ? `${issuesCount} issues found` : 'Issue count pending'
        }
        variant="warning"
      />
      <MetricCard
        icon={<TrendingUp size={16} />}
        value={loading || filesCount === undefined ? '—' : filesCount}
        label="Files"
        ariaLabel={filesCount !== undefined ? `${filesCount} files changed` : 'File count pending'}
        variant="info"
      />
    </div>
  )
}

function MetricCard({
  icon,
  value,
  label,
  ariaLabel,
  variant
}: {
  icon: ReactNode
  value: number | string
  label: string
  ariaLabel: string
  variant: 'success' | 'warning' | 'info'
}): JSX.Element {
  return (
    <div className={`cr-metric cr-metric--${variant}`} role="status" aria-label={ariaLabel}>
      <div className="cr-metric__icon">{icon}</div>
      <div className="cr-metric__value">{value}</div>
      <div className="cr-metric__label">{label}</div>
    </div>
  )
}
```

- [ ] **Step 4: Implement `BranchBar`**

Write `src/renderer/src/components/code-review/BranchBar.tsx`:

```tsx
import { GitBranch, ArrowRight } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  branch: string
  targetBranch?: string
}

export function BranchBar({ branch, targetBranch = 'main' }: Props): JSX.Element {
  return (
    <div className="cr-branchbar" aria-label={`Branch ${branch} targeting ${targetBranch}`}>
      <GitBranch size={14} />
      <span className="cr-branchbar__branch">{branch}</span>
      <ArrowRight size={12} />
      <span className="cr-branchbar__target">{targetBranch}</span>
    </div>
  )
}
```

- [ ] **Step 5: Add CSS for metrics and branch bar**

Append to `CodeReviewView.css`:

```css
.cr-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--bde-space-3);
  padding: var(--bde-space-4);
}
.cr-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--bde-space-2);
  padding: var(--bde-space-4);
  border-radius: var(--bde-radius-lg);
  background: var(--bde-surface-high);
  border: 1px solid var(--bde-border);
}
.cr-metric__value {
  font-size: var(--bde-size-xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--bde-text);
}
.cr-metric__label {
  font-size: var(--bde-size-xs);
  color: var(--bde-text-muted);
}
.cr-metric--success .cr-metric__icon {
  color: var(--bde-success);
}
.cr-metric--warning .cr-metric__icon {
  color: var(--bde-warning);
}
.cr-metric--info .cr-metric__icon {
  color: var(--bde-accent);
}

.cr-branchbar {
  display: inline-flex;
  align-items: center;
  gap: var(--bde-space-2);
  font-size: var(--bde-size-sm);
  color: var(--bde-text-muted);
}
.cr-branchbar__branch {
  color: var(--bde-text);
  font-weight: 500;
}
.cr-branchbar__target {
  color: var(--bde-text-dim);
}
```

- [ ] **Step 6: Run — confirm tests pass + commit**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx
```

Expected: both tests pass.

```bash
git add src/renderer/src/components/code-review/BranchBar.tsx \
        src/renderer/src/components/code-review/ReviewMetricsRow.tsx \
        src/renderer/src/components/code-review/ReviewMetricsRow.test.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: add branch bar + review metrics row"
```

---

### Task F3: `ReviewQuickActions`, `ReviewChatInput`, `ReviewMessageList`

**Files:**

- Create: `src/renderer/src/components/code-review/ReviewQuickActions.tsx`
- Create: `src/renderer/src/components/code-review/ReviewChatInput.tsx`
- Create: `src/renderer/src/components/code-review/ReviewMessageList.tsx`

No dedicated tests for these — they are thin presentation components verified by the `AIAssistantPanel` integration test in a later task.

- [ ] **Step 1: Implement `ReviewQuickActions`**

Write `src/renderer/src/components/code-review/ReviewQuickActions.tsx`:

```tsx
import { Shield, TrendingUp, Zap } from 'lucide-react'
import type { JSX } from 'react'

interface Props {
  onAction: (prompt: string) => void
  disabled?: boolean
}

const ACTIONS = [
  {
    label: 'Explain security issues',
    icon: Shield,
    prompt:
      'Walk me through any security risks you see in this diff. Cite specific files and lines where possible.'
  },
  {
    label: 'Performance analysis',
    icon: TrendingUp,
    prompt:
      'Analyze this change for performance regressions or improvements. Focus on hot paths and allocations.'
  },
  {
    label: 'Suggest improvements',
    icon: Zap,
    prompt: 'What would you change about this diff before merging? Rank suggestions by impact.'
  }
] as const

export function ReviewQuickActions({ onAction, disabled = false }: Props): JSX.Element {
  return (
    <div className="cr-quick-actions">
      <div className="cr-quick-actions__label">Quick actions:</div>
      {ACTIONS.map(({ label, icon: Icon, prompt }) => (
        <button
          key={label}
          type="button"
          className="cr-quick-actions__chip"
          onClick={() => onAction(prompt)}
          disabled={disabled}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implement `ReviewChatInput`**

Write `src/renderer/src/components/code-review/ReviewChatInput.tsx`:

```tsx
import { Send, StopCircle } from 'lucide-react'
import { useState, useRef, type JSX, type KeyboardEvent } from 'react'

interface Props {
  onSend: (content: string) => void
  onAbort?: () => void
  streaming?: boolean
  disabled?: boolean
}

export function ReviewChatInput({
  onSend,
  onAbort,
  streaming = false,
  disabled = false
}: Props): JSX.Element {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(): void {
    const trimmed = value.trim()
    if (!trimmed || streaming || disabled) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="cr-chat-input">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about the changes..."
        disabled={disabled}
        rows={1}
        className="cr-chat-input__textarea"
        aria-label="Message to AI Review Partner"
      />
      {streaming ? (
        <button
          type="button"
          className="cr-chat-input__button cr-chat-input__button--abort"
          onClick={onAbort}
          aria-label="Stop streaming"
        >
          <StopCircle size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="cr-chat-input__button"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement `ReviewMessageList`**

Write `src/renderer/src/components/code-review/ReviewMessageList.tsx`:

```tsx
import { Sparkles } from 'lucide-react'
import type { JSX } from 'react'
import type { PartnerMessage } from '../../../../shared/review-types'

interface Props {
  messages: PartnerMessage[]
  emptyMessage?: string
}

export function ReviewMessageList({
  messages,
  emptyMessage = 'Select a task to see the AI review.'
}: Props): JSX.Element {
  if (messages.length === 0) {
    return <div className="cr-messages cr-messages--empty">{emptyMessage}</div>
  }

  return (
    <div className="cr-messages" role="log" aria-live="polite" aria-atomic="false">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`cr-message cr-message--${m.role}${m.streaming ? ' cr-message--streaming' : ''}`}
          aria-busy={m.streaming ? 'true' : 'false'}
        >
          {m.role === 'assistant' && (
            <div className="cr-message__header">
              <Sparkles size={12} />
              <span>AI Partner</span>
            </div>
          )}
          <div className="cr-message__content">{m.content}</div>
          <div className="cr-message__timestamp">{new Date(m.timestamp).toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Add CSS for all three**

Append to `CodeReviewView.css`:

```css
/* Quick actions */
.cr-quick-actions {
  display: flex;
  flex-direction: column;
  gap: var(--bde-space-2);
  padding: var(--bde-space-4);
}
.cr-quick-actions__label {
  font-size: var(--bde-size-xs);
  color: var(--bde-text-muted);
  margin-bottom: var(--bde-space-2);
}
.cr-quick-actions__chip {
  display: flex;
  align-items: center;
  gap: var(--bde-space-3);
  padding: var(--bde-space-3) var(--bde-space-4);
  border-radius: var(--bde-radius-md);
  background: var(--bde-surface-high);
  border: 1px solid var(--bde-border);
  color: var(--bde-text);
  font-size: var(--bde-size-sm);
  cursor: pointer;
  text-align: left;
}
.cr-quick-actions__chip:hover:not(:disabled) {
  background: var(--bde-hover);
  border-color: var(--bde-border-hover);
}
.cr-quick-actions__chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Chat input */
.cr-chat-input {
  display: flex;
  align-items: flex-end;
  gap: var(--bde-space-2);
  padding: var(--bde-space-3) var(--bde-space-4);
  border-top: 1px solid var(--bde-border);
  background: var(--bde-surface);
}
.cr-chat-input__textarea {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--bde-text);
  font: inherit;
  min-height: 24px;
  max-height: 120px;
}
.cr-chat-input__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--bde-radius-md);
  background: var(--bde-accent);
  color: var(--bde-btn-primary-text);
  border: none;
  cursor: pointer;
}
.cr-chat-input__button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cr-chat-input__button--abort {
  background: var(--bde-surface-high);
  color: var(--bde-text);
}

/* Message list */
.cr-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--bde-space-3);
  padding: var(--bde-space-4);
  overflow-y: auto;
}
.cr-messages--empty {
  align-items: center;
  justify-content: center;
  color: var(--bde-text-dim);
  font-size: var(--bde-size-sm);
}
.cr-message {
  padding: var(--bde-space-3) var(--bde-space-4);
  border-radius: var(--bde-radius-lg);
  font-size: var(--bde-size-sm);
  max-width: 90%;
}
.cr-message--user {
  align-self: flex-end;
  background: var(--bde-accent);
  color: var(--bde-btn-primary-text);
}
.cr-message--assistant {
  align-self: flex-start;
  background: var(--bde-surface-high);
  color: var(--bde-text);
  border: 1px solid var(--bde-border);
}
.cr-message__header {
  display: inline-flex;
  align-items: center;
  gap: var(--bde-space-2);
  font-size: var(--bde-size-xs);
  color: var(--bde-purple);
  margin-bottom: var(--bde-space-2);
}
.cr-message__timestamp {
  font-size: var(--bde-size-xs);
  color: var(--bde-text-dim);
  margin-top: var(--bde-space-2);
}
.cr-message--streaming .cr-message__content::after {
  content: '▋';
  display: inline-block;
  margin-left: 2px;
  animation: cr-cursor-blink 1s linear infinite;
}
@keyframes cr-cursor-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cr-message--streaming .cr-message__content::after {
    animation: none;
  }
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors.

```bash
git add src/renderer/src/components/code-review/ReviewQuickActions.tsx \
        src/renderer/src/components/code-review/ReviewChatInput.tsx \
        src/renderer/src/components/code-review/ReviewMessageList.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: add quick actions, chat input, and message list primitives"
```

---

### Task F4: `ApproveDropdown` (TDD — keyboard nav)

**Files:**

- Create: `src/renderer/src/components/code-review/ApproveDropdown.tsx`
- Create: `src/renderer/src/components/code-review/ApproveDropdown.test.tsx`

- [ ] **Step 1: Write the failing test**

Write `src/renderer/src/components/code-review/ApproveDropdown.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApproveDropdown } from './ApproveDropdown'

describe('ApproveDropdown', () => {
  const noop = () => {}
  const actions = {
    onMergeLocally: vi.fn(),
    onSquashMerge: vi.fn(),
    onCreatePR: vi.fn(),
    onRequestRevision: vi.fn(),
    onDiscard: vi.fn()
  }

  it('opens on click and shows all actions', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(screen.getByRole('menuitem', { name: /merge locally/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /squash/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /create pr/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /request revision/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /discard/i })).toBeInTheDocument()
  })

  it('invokes the selected action and closes on click', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /merge locally/i }))
    expect(actions.onMergeLocally).toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: /squash/i })).toBeNull()
  })

  it('closes on Escape', () => {
    render(<ApproveDropdown {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: /squash/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — confirm failure**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/ApproveDropdown.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `ApproveDropdown`**

Write `src/renderer/src/components/code-review/ApproveDropdown.tsx`:

```tsx
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type JSX } from 'react'

interface Props {
  onMergeLocally: () => void
  onSquashMerge: () => void
  onCreatePR: () => void
  onRequestRevision: () => void
  onDiscard: () => void
  disabled?: boolean
}

export function ApproveDropdown({
  onMergeLocally,
  onSquashMerge,
  onCreatePR,
  onRequestRevision,
  onDiscard,
  disabled = false
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  function run(fn: () => void): void {
    fn()
    setOpen(false)
  }

  return (
    <div className="cr-approve" ref={rootRef}>
      <button
        type="button"
        className="cr-approve__trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Check size={14} />
        <span>Approve</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="cr-approve__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onMergeLocally)}>
            Merge Locally
          </button>
          <button type="button" role="menuitem" onClick={() => run(onSquashMerge)}>
            Squash & Merge
          </button>
          <button type="button" role="menuitem" onClick={() => run(onCreatePR)}>
            Create PR
          </button>
          <hr className="cr-approve__divider" />
          <button type="button" role="menuitem" onClick={() => run(onRequestRevision)}>
            Request Revision
          </button>
          <button
            type="button"
            role="menuitem"
            className="cr-approve__danger"
            onClick={() => run(onDiscard)}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add CSS**

Append to `CodeReviewView.css`:

```css
.cr-approve {
  position: relative;
  display: inline-block;
}
.cr-approve__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--bde-space-2);
  padding: var(--bde-space-3) var(--bde-space-4);
  border-radius: var(--bde-radius-md);
  background: var(--bde-accent);
  color: var(--bde-btn-primary-text);
  border: none;
  cursor: pointer;
  font-size: var(--bde-size-sm);
  font-weight: 500;
}
.cr-approve__menu {
  position: absolute;
  top: calc(100% + var(--bde-space-2));
  right: 0;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  padding: var(--bde-space-2);
  border-radius: var(--bde-radius-md);
  background: var(--bde-surface-high);
  border: 1px solid var(--bde-border);
  box-shadow: var(--bde-shadow-lg);
  z-index: 50;
}
.cr-approve__menu button {
  display: block;
  padding: var(--bde-space-3) var(--bde-space-4);
  border-radius: var(--bde-radius-sm);
  background: transparent;
  border: none;
  color: var(--bde-text);
  cursor: pointer;
  font-size: var(--bde-size-sm);
  text-align: left;
}
.cr-approve__menu button:hover {
  background: var(--bde-hover);
}
.cr-approve__divider {
  margin: var(--bde-space-2) 0;
  border: none;
  border-top: 1px solid var(--bde-border);
}
.cr-approve__danger {
  color: var(--bde-error);
}
```

- [ ] **Step 5: Run — confirm tests pass**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/ApproveDropdown.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/code-review/ApproveDropdown.tsx \
        src/renderer/src/components/code-review/ApproveDropdown.test.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: add ApproveDropdown with keyboard/outside-click dismiss"
```

---

## Phase G — Panel assembly

### Task G1: Rewire `AIAssistantPanel` to consume the store

**Files:**

- Modify: `src/renderer/src/components/code-review/AIAssistantPanel.tsx`

- [ ] **Step 1: Read the current file to understand its structure**

```bash
cat src/renderer/src/components/code-review/AIAssistantPanel.tsx
```

Expected: note the existing header, menu, message-area, and input-area DOM shape. The rewrite replaces handlers and message rendering but keeps the outer shell so the layout CSS still applies.

- [ ] **Step 2: Replace the component body**

Write `src/renderer/src/components/code-review/AIAssistantPanel.tsx`:

```tsx
import { Sparkles, X, MoreHorizontal } from 'lucide-react'
import { useState, type JSX } from 'react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ReviewMetricsRow } from './ReviewMetricsRow'
import { ReviewMessageList } from './ReviewMessageList'
import { ReviewQuickActions } from './ReviewQuickActions'
import { ReviewChatInput } from './ReviewChatInput'

export function AIAssistantPanel(): JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null

  const reviewState = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId] : undefined
  )
  const messages = useReviewPartnerStore((s) =>
    selectedTaskId ? (s.messagesByTask[selectedTaskId] ?? []) : []
  )
  const togglePanel = useReviewPartnerStore((s) => s.togglePanel)
  const sendMessage = useReviewPartnerStore((s) => s.sendMessage)
  const abortStream = useReviewPartnerStore((s) => s.abortStream)
  const activeStream = useReviewPartnerStore((s) =>
    selectedTaskId ? s.activeStreamByTask[selectedTaskId] : null
  )
  const clearMessages = useReviewPartnerStore((s) => s.clearMessages)
  const autoReview = useReviewPartnerStore((s) => s.autoReview)

  const [menuOpen, setMenuOpen] = useState(false)
  const streaming = !!activeStream

  const result = reviewState?.result
  const loading = reviewState?.status === 'loading'
  const errored = reviewState?.status === 'error'

  return (
    <aside className="cr-assistant" role="complementary" aria-label="AI Review Partner">
      <div className="cr-assistant__header">
        <div className="cr-assistant__title">
          <Sparkles size={14} className="cr-assistant__sparkle" />
          <div>
            <div className="cr-assistant__title-label">AI Review Partner</div>
            <div className="cr-assistant__title-model">Claude 4.6 Opus</div>
          </div>
        </div>
        <div className="cr-assistant__header-actions">
          <button
            type="button"
            className="cr-assistant__menu-trigger"
            aria-label="More options"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            className="cr-assistant__close"
            aria-label="Close AI Review Partner"
            onClick={togglePanel}
          >
            <X size={14} />
          </button>
          {menuOpen && (
            <div className="cr-assistant__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (selectedTaskId) {
                    void autoReview(selectedTaskId, { force: true })
                  }
                  setMenuOpen(false)
                }}
                disabled={!selectedTaskId}
              >
                Re-review
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (selectedTaskId) clearMessages(selectedTaskId)
                  setMenuOpen(false)
                }}
                disabled={!selectedTaskId}
              >
                Clear thread
              </button>
            </div>
          )}
        </div>
      </div>

      <ReviewMetricsRow
        qualityScore={result?.qualityScore}
        issuesCount={result?.issuesCount}
        filesCount={result?.filesCount}
        loading={loading}
      />

      {errored && (
        <div className="cr-assistant__error" role="alert">
          {reviewState?.error ?? 'Review failed.'}
          <button
            type="button"
            onClick={() => {
              if (selectedTaskId) void autoReview(selectedTaskId, { force: true })
            }}
          >
            Retry
          </button>
        </div>
      )}

      <ReviewMessageList
        messages={messages}
        emptyMessage={
          !selectedTaskId
            ? 'Select a task to start reviewing.'
            : loading
              ? 'Reviewing...'
              : 'No review yet. Open this task to auto-review.'
        }
      />

      <ReviewQuickActions
        onAction={(prompt) => {
          if (!selectedTaskId || streaming) return
          void sendMessage(selectedTaskId, prompt)
        }}
        disabled={!selectedTaskId || streaming}
      />

      <ReviewChatInput
        streaming={streaming}
        disabled={!selectedTaskId}
        onSend={(content) => {
          if (!selectedTaskId) return
          void sendMessage(selectedTaskId, content)
        }}
        onAbort={() => {
          if (!selectedTaskId) return
          void abortStream(selectedTaskId)
        }}
      />
    </aside>
  )
}
```

Note: if the import `useSprintTasks` is a different name in this repo, adjust. Search with:

```bash
grep -rn "export.*useSprintTasks\|export.*sprintTasks" src/renderer/src/stores/
```

- [ ] **Step 3: Typecheck**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck
```

Expected: zero errors. Fix any import/export mismatches.

- [ ] **Step 4: Run existing tests for this file if any**

```bash
cd ~/worktrees/bde/ai-review-partner && npm test -- --run src/renderer/src/components/code-review/AIAssistantPanel
```

Expected: either tests pass, or the test file doesn't exist yet (fine).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/code-review/AIAssistantPanel.tsx
git commit -m "feat: wire AIAssistantPanel to reviewPartner store"
```

---

### Task G2: Update `TopBar` with branch bar + AI Partner toggle + Approve dropdown

**Files:**

- Modify: `src/renderer/src/components/code-review/TopBar.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer/src/components/code-review/TopBar.tsx
```

Expected: note the existing task-switcher, freshness badge, and explicit action buttons (Ship It / Merge Locally / Squash / Create PR).

- [ ] **Step 2: Add imports**

At the top, add:

```tsx
import { BranchBar } from './BranchBar'
import { ApproveDropdown } from './ApproveDropdown'
import { Sparkles } from 'lucide-react'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
```

- [ ] **Step 3: Replace the right-zone action cluster**

Find the block that currently renders explicit action buttons (Ship It, Merge Locally, etc.) and replace it with:

```tsx
{
  /* AI Partner toggle */
}
;<button
  type="button"
  className={`cr-topbar__ai-toggle${panelOpen ? ' cr-topbar__ai-toggle--on' : ''}`}
  aria-pressed={panelOpen}
  aria-label="Toggle AI Review Partner"
  onClick={togglePanel}
>
  <Sparkles size={14} />
  <span>AI Partner</span>
</button>

{
  /* Approve dropdown (consolidated actions) */
}
;<ApproveDropdown
  onMergeLocally={handleMergeLocally}
  onSquashMerge={handleSquashMerge}
  onCreatePR={handleCreatePR}
  onRequestRevision={handleRequestRevision}
  onDiscard={handleDiscard}
  disabled={!selectedTask}
/>
```

Add handler wiring above the return:

```tsx
const panelOpen = useReviewPartnerStore((s) => s.panelOpen)
const togglePanel = useReviewPartnerStore((s) => s.togglePanel)

// Reuse whatever action handlers currently exist in the file — rename if needed.
// If the current TopBar has a `handleShipIt` that calls `ReviewActions` under
// the hood, map it to `handleMergeLocally`. The behavior is identical; only
// the trigger-surface changes.
```

- [ ] **Step 4: Add the branch bar to the left zone**

In the left zone of the top bar (where the task switcher currently lives), add just below or above the existing task switcher:

```tsx
{
  selectedTask?.branch && <BranchBar branch={selectedTask.branch} targetBranch="main" />
}
```

- [ ] **Step 5: Add CSS for the AI toggle**

Append to `CodeReviewView.css`:

```css
.cr-topbar__ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--bde-space-2);
  padding: var(--bde-space-3) var(--bde-space-4);
  border-radius: var(--bde-radius-md);
  background: transparent;
  border: 1px solid var(--bde-border);
  color: var(--bde-text);
  cursor: pointer;
  font-size: var(--bde-size-sm);
}
.cr-topbar__ai-toggle--on {
  background: var(--bde-purple-surface, var(--bde-surface-high));
  border-color: var(--bde-purple);
  color: var(--bde-purple);
}
.cr-topbar__ai-toggle:hover:not(.cr-topbar__ai-toggle--on) {
  background: var(--bde-hover);
}
```

- [ ] **Step 6: Typecheck + tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck && npm test -- --run
```

Expected: zero errors, all tests pass. If a test for `TopBar` renders `Ship It` explicitly and fails, update the test to query for the `Approve` button instead (keep the same behavioral assertion).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/code-review/TopBar.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: consolidate top bar — branch bar + AI toggle + approve dropdown"
```

---

### Task G3: Decorate `FileTreePanel` with per-file badges

**Files:**

- Modify: `src/renderer/src/components/code-review/FileTreePanel.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer/src/components/code-review/FileTreePanel.tsx
```

- [ ] **Step 2: Add imports and read the current review result**

At the top of the file:

```tsx
import { AIFileStatusBadge, type FileReviewStatus } from './AIFileStatusBadge'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { useCodeReviewStore } from '../../stores/codeReview'
```

Inside the component:

```tsx
const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
const reviewResult = useReviewPartnerStore((s) =>
  selectedTaskId ? s.reviewByTask[selectedTaskId]?.result : undefined
)

function statusForPath(path: string): FileReviewStatus {
  const finding = reviewResult?.findings.perFile.find((f) => f.path === path)
  if (!finding) return 'unreviewed'
  return finding.status
}
```

- [ ] **Step 3: Render the badge for each file row**

Inside the map that renders each file row, add the badge alongside the existing icon (typical placement: after the status icon, before the filename, or right-aligned next to the `+N/-N` stats):

```tsx
<AIFileStatusBadge status={statusForPath(file.path)} />
```

Exact JSX placement depends on the existing row shape — add the badge without breaking the layout.

- [ ] **Step 4: Typecheck + tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck && npm test -- --run
```

Expected: zero errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/code-review/FileTreePanel.tsx
git commit -m "feat: render AI file status badges in file tree"
```

---

### Task G4: Decorate `DiffViewerPanel` header with `AIReviewedBadge`

**Files:**

- Modify: `src/renderer/src/components/code-review/DiffViewerPanel.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer/src/components/code-review/DiffViewerPanel.tsx
```

- [ ] **Step 2: Add imports and read the finding for the selected file**

```tsx
import { AIReviewedBadge } from './AIReviewedBadge'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { useCodeReviewStore } from '../../stores/codeReview'
```

Inside the component:

```tsx
const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
const selectedFile = useCodeReviewStore((s) => s.selectedDiffFile)
const finding = useReviewPartnerStore((s) => {
  if (!selectedTaskId || !selectedFile) return undefined
  return s.reviewByTask[selectedTaskId]?.result?.findings.perFile.find(
    (f) => f.path === selectedFile
  )
})
```

- [ ] **Step 3: Render the badge next to the file path in the header**

In the header area (next to the breadcrumb/file path):

```tsx
{
  finding && <AIReviewedBadge commentCount={finding.commentCount} />
}
```

- [ ] **Step 4: Typecheck + tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck && npm test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/code-review/DiffViewerPanel.tsx
git commit -m "feat: show AI reviewed badge in diff viewer header"
```

---

## Phase H — View wire-up

### Task H1: Mount `useAutoReview` + panel toggle in `CodeReviewView`

**Files:**

- Modify: `src/renderer/src/views/CodeReviewView.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/renderer/src/views/CodeReviewView.tsx
```

Expected: note where `<AIAssistantPanel />` is mounted, and how `selectedTaskId` is currently threaded.

- [ ] **Step 2: Add imports**

```tsx
import { useAutoReview } from '../hooks/useAutoReview'
import { useReviewPartnerStore } from '../stores/reviewPartner'
import { useSprintTasks } from '../stores/sprintTasks'
```

- [ ] **Step 3: Call the hook and read `panelOpen`**

Inside the component, after `selectedTaskId` is read:

```tsx
const tasks = useSprintTasks((s) => s.tasks)
const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null
useAutoReview(selectedTaskId, selectedTask?.status ?? null)
const panelOpen = useReviewPartnerStore((s) => s.panelOpen)
```

- [ ] **Step 4: Conditionally render the AI panel**

Change the existing `<AIAssistantPanel />` render to:

```tsx
{
  panelOpen && <AIAssistantPanel />
}
```

- [ ] **Step 5: Update the grid CSS to expand when the panel is closed**

In `CodeReviewView.css`, find the panel-row container and ensure it expands the diff column when the `.cr-assistant` is absent. Simplest: use CSS grid with `grid-template-columns: 256px 1fr auto` — the `auto` collapses to 0 when the panel isn't present, letting `1fr` fill the space.

If the current layout uses flex with explicit widths, add a `.cr-panels--partner-closed` modifier class and use it in the view:

```tsx
<div className={`cr-panels${panelOpen ? '' : ' cr-panels--partner-closed'}`}>
```

And in CSS:

```css
.cr-panels--partner-closed .cr-assistant {
  display: none;
}
```

- [ ] **Step 6: Typecheck + tests**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run typecheck && npm test -- --run
```

Expected: zero errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/views/CodeReviewView.tsx \
        src/renderer/src/components/code-review/CodeReviewView.css
git commit -m "feat: mount useAutoReview + panel toggle in CodeReviewView"
```

---

## Phase I — Verification

### Task I1: Full suite + dev-server smoke test

@superpowers:verification-before-completion — evidence before assertions.

- [ ] **Step 1: Run the full quality gate locally**

```bash
cd ~/worktrees/bde/ai-review-partner
npm run typecheck
npm run lint
npm test -- --run
npm run test:main -- --run
```

Expected: zero type errors, zero lint errors, all renderer tests pass, all main tests pass.

- [ ] **Step 2: Start the dev server and manually verify the UX**

```bash
cd ~/worktrees/bde/ai-review-partner && npm run dev
```

Manual smoke checklist:

- [ ] Toggle `Settings → Appearance` between `theme-pro-dark` and `theme-pro-light` and confirm the AI Partner panel, metric cards, chat bubbles, and file-tree badges render correctly in both themes with no hardcoded colors bleeding through.
- [ ] Code Review view loads with three-column layout when `AI Partner` toggle is on.
- [ ] Clicking `AI Partner` in the top bar hides the right panel; the diff expands.
- [ ] Clicking `AI Partner` again shows it; state persists across app restart (toggle it off, kill the dev server, restart, confirm it's still off).
- [ ] Selecting a task in `review` status fires an auto-review within ~2 s. Metrics populate. Opening message appears in the chat.
- [ ] Re-selecting the same task returns instantly from cache — no second spinner.
- [ ] Typing a question in the chat input and hitting Enter starts a streaming response. Tool-use events (if any) appear in the stream.
- [ ] Clicking a quick action chip injects the canned prompt and streams a response.
- [ ] Mid-stream, switching to a different task aborts the stream and starts auto-review for the new task.
- [ ] The `Approve ▾` dropdown opens, shows all five actions, closes on Escape and on outside click. Each action fires the same behavior it did before the consolidation.
- [ ] File tree: files in the review result render warning / check badges per status.
- [ ] Selected file in the diff viewer shows the `AI Reviewed` badge + comment count in the header.
- [ ] `Re-review` menu item fires a fresh review (cache invalidated).
- [ ] `Clear thread` menu item empties the chat but preserves the metrics.

- [ ] **Step 3: Commit any tiny fixes found during smoke**

If the smoke test surfaced copy-paste bugs or CSS drift, fix them in focused commits. Do NOT commit speculative improvements — stick to bugs you actually observed.

- [ ] **Step 4: Final commit acknowledging verification**

No code change required — but write a commit with `git commit --allow-empty` if you want a ceremonial marker:

```bash
git commit --allow-empty -m "chore: verification pass — AI Review Partner v1 ready"
```

Alternatively, skip the empty commit and let the PR description speak for itself.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/ai-review-partner
```

Expected: push succeeds. The pre-push hook will run `typecheck + test + test:main + lint` per the CLAUDE.md convention — it should pass because Step 1 already ran the same suite. If the hook fails, investigate and fix; do NOT use `--no-verify`.

---

## Deferred Follow-ups (NOT part of this plan)

These are documented in spec §16 but are explicitly out of scope for v1:

- **Inline AI comments rendered in the diff body.** Data is already stored — a v2 spec will add the annotation layer in `PlainDiffContent.tsx`.
- **Large-diff truncation** — rely on SDK context-window errors until a problem surfaces.
- **Per-file re-review** — re-review always invalidates the whole task.
- **Chat-message cleanup on task terminal transitions** — revisit only if localStorage pressure bites.
- **E2E tests** — added only if unit tests prove insufficient.
- **Export / search / history charts** — not scoped.

---

_End of plan. Execute task-by-task via superpowers:subagent-driven-development or superpowers:executing-plans._
