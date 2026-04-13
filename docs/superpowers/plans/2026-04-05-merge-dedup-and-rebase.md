# Merge Dedup + Rebase Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-remove duplicate CSS blocks after merges and surface rebase freshness in Code Review UI.

**Architecture:** Two features sharing one merge pipeline. Feature A adds a pure-function CSS dedup service called post-merge. Feature C extends the existing `rebaseOntoMain()` to capture base SHA, adds a DB migration for two new fields, two new IPC channels, and a freshness badge + rebase button in ReviewActions.

**Tech Stack:** TypeScript, Vitest, SQLite (better-sqlite3), Electron IPC, React

**Spec:** `docs/superpowers/specs/2026-04-05-merge-dedup-and-rebase-design.md`

---

### Task 1: CSS Dedup Service — Core Parser + Tests

**Files:**

- Create: `src/main/services/css-dedup.ts`
- Create: `src/main/services/__tests__/css-dedup.test.ts`

This is the pure-function core. No side effects, no file I/O — just string in, string out.

- [ ] **Step 1: Write failing tests for the CSS dedup function**

Create `src/main/services/__tests__/css-dedup.test.ts` with tests for:

- Removes exact duplicate rules, keeping last occurrence
- Returns input unchanged when no duplicates
- Treats rules in different `@media` contexts as distinct
- Deduplicates `@keyframes` by name
- Warns on near-duplicates (same selector, different body)
- Preserves comments
- Handles empty input
- Normalizes whitespace for comparison
- Handles nested `@media` with duplicates inside

Follow the test pattern in `src/main/services/__tests__/auto-review.test.ts` — import from vitest, pure function tests, no mocking needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/__tests__/css-dedup.test.ts`
Expected: FAIL — `deduplicateCss` not found

- [ ] **Step 3: Implement the CSS dedup service**

Create `src/main/services/css-dedup.ts` exporting:

```typescript
export interface CssBlock {
  type: 'rule' | 'keyframes' | 'media' | 'comment' | 'other'
  selector: string
  body: string
  context: string // parent at-rule or '' for top-level
  raw: string
}

export interface DedupResult {
  deduplicated: string
  removed: CssBlock[]
  warnings: string[]
}

export function deduplicateCss(css: string): DedupResult
```

Implementation approach:

- `parseCssBlocks(css, context)` — lightweight parser that tracks brace depth, extracts selector + body + raw text. Handles `@media`/`@supports` recursively, `@keyframes` as named blocks, comments, and plain rules.
- `normalizeBody(body)` — collapse whitespace, trim. Used for comparison only.
- `deduplicateCss(css)` — parse blocks, group by `context|||selector` key, identify exact duplicates (same normalized body → remove all but last), flag near-duplicates (same key, different body → warning). Rebuild output from non-removed blocks' `raw` text.

Key design decisions:

- Keep LAST occurrence (highest CSS cascade priority)
- `@media` blocks themselves are not deduped — only rules inside them
- Comments and unrecognized content pass through unchanged

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/__tests__/css-dedup.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/css-dedup.ts src/main/services/__tests__/css-dedup.test.ts
git commit -m "feat: add CSS dedup service with block-level parser"
```

---

### Task 2: Post-Merge Dedup Integration

**Files:**

- Create: `src/main/services/post-merge-dedup.ts`
- Modify: `src/main/handlers/review.ts`
- Modify: `src/main/agent-manager/completion.ts`

Wires the pure dedup function into the merge pipeline. This is the orchestration layer that reads/writes files and creates git commits.

- [ ] **Step 1: Create the post-merge dedup orchestrator**

Create `src/main/services/post-merge-dedup.ts` with:

```typescript
export interface DedupReport {
  filesModified: string[]
  totalRemoved: number
  warnings: string[]
  committed: boolean
}

export async function runPostMergeDedup(repoPath: string): Promise<DedupReport | null>
```

Implementation:

1. Run `git diff --name-only --diff-filter=ACMR HEAD~1 HEAD` via `execFileAsync` to get changed files
2. Filter to `*.css` files only — return `null` if none
3. For each CSS file: `readFileSync`, run `deduplicateCss()`, `writeFileSync` if changed
4. If any files modified: `git add <files>` then `git commit` with message `"chore: deduplicate CSS from merge\n\nAutomated by BDE post-merge dedup"`
5. Return report with files modified, count, warnings
6. Use `createLogger('post-merge-dedup')` for logging, `buildAgentEnv()` for git env
7. All git commands use `execFileAsync` (argument arrays, not string interpolation)
8. Wrap `HEAD~1` diff in try/catch — skip gracefully if it fails

- [ ] **Step 2: Integrate into `review:mergeLocally` handler**

In `src/main/handlers/review.ts`:

- Add import: `import { runPostMergeDedup } from '../services/post-merge-dedup'`
- Insert after the successful merge block (after the merge switch/case, before the worktree cleanup `git worktree remove`):

```typescript
// Post-merge CSS dedup
try {
  const dedupReport = await runPostMergeDedup(repoPath)
  if (dedupReport?.warnings.length) {
    const existing = _getTask(taskId)
    const warnText = `\n\n## CSS Near-Duplicate Warnings\n${dedupReport.warnings.join('\n')}`
    _updateTask(taskId, { notes: (existing?.notes || '') + warnText })
  }
} catch (err) {
  logger.warn(`[review:mergeLocally] Post-merge dedup failed (non-fatal): ${err}`)
}
```

- [ ] **Step 3: Integrate into `review:shipIt` handler**

Same pattern as Step 2 — add the dedup block after the successful merge in `review:shipIt`. **Important:** insert between the merge block (~line 552) and the push block (~line 567) so the dedup commit is included in the push. Do NOT insert after the push.

- [ ] **Step 4: Integrate into auto-merge path in `completion.ts`**

In `src/main/agent-manager/completion.ts`:

- Add import: `import { runPostMergeDedup } from '../services/post-merge-dedup'`
- In the auto-merge block inside `resolveSuccess()`, after the squash merge commit succeeds, add:

```typescript
try {
  await runPostMergeDedup(repoPath)
} catch {
  // Non-fatal
}
```

- [ ] **Step 5: Run typecheck + existing tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/post-merge-dedup.ts src/main/handlers/review.ts src/main/agent-manager/completion.ts
git commit -m "feat: integrate CSS dedup into merge pipeline"
```

---

### Task 3: DB Migration + Type Updates for Rebase Fields

**Files:**

- Modify: `src/main/db.ts` (migration v32)
- Modify: `src/shared/types.ts` (SprintTask interface)

- [ ] **Step 1: Add migration v32 to `src/main/db.ts`**

Append to the `migrations` array (before the closing `]` at line 839):

```typescript
  {
    version: 32,
    description: 'Add rebase tracking fields to sprint_tasks',
    up: (db) => {
      const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
      if (!cols.includes('rebase_base_sha')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN rebase_base_sha TEXT DEFAULT NULL')
      }
      if (!cols.includes('rebased_at')) {
        db.exec('ALTER TABLE sprint_tasks ADD COLUMN rebased_at TEXT DEFAULT NULL')
      }
    }
  }
```

Follow the same idempotent pattern as migration v31.

- [ ] **Step 2: Add fields to `SprintTask` in `src/shared/types.ts`**

Add after `cross_repo_contract?: string | null` (line 99):

```typescript
  rebase_base_sha?: string | null
  rebased_at?: string | null
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/db.ts src/shared/types.ts
git commit -m "feat: add rebase_base_sha, rebased_at fields (migration v32)"
```

---

### Task 4: Extend `rebaseOntoMain()` to Capture Base SHA

**Files:**

- Modify: `src/main/agent-manager/completion.ts`

- [ ] **Step 1: Modify `rebaseOntoMain()` return type**

Change the return type from `Promise<{ success: boolean; notes?: string }>` to:

```typescript
Promise<{ success: boolean; notes?: string; baseSha?: string }>
```

After the successful rebase (`await execFileAsync('git', ['rebase', 'origin/main'], ...)`), add:

```typescript
const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
  cwd: worktreePath,
  env: buildAgentEnv()
})
return { success: true, baseSha: shaOut.trim() }
```

- [ ] **Step 2: Store rebase fields in `resolveSuccess()`**

Where `resolveSuccess()` calls `rebaseOntoMain()` and later updates the task to `status: 'review'`, include the new fields in the update:

```typescript
  rebase_base_sha: rebaseResult.baseSha ?? null,
  rebased_at: rebaseResult.success ? new Date().toISOString() : null,
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/completion.ts
git commit -m "feat: capture rebase base SHA on agent completion"
```

---

### Task 5: IPC Channels + Preload for Rebase & Freshness

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/handlers/review.ts`

- [ ] **Step 1: Add channel types to `ReviewChannels` in `src/shared/ipc-channels.ts`**

Add inside the `ReviewChannels` interface (after `review:checkAutoReview`):

```typescript
  'review:rebase': {
    args: [payload: { taskId: string }]
    result: { success: boolean; baseSha?: string; error?: string; conflicts?: string[] }
  }
  'review:checkFreshness': {
    args: [payload: { taskId: string }]
    result: { status: 'fresh' | 'stale' | 'conflict' | 'unknown'; commitsBehind?: number }
  }
```

- [ ] **Step 2: Add preload bridge methods in `src/preload/index.ts`**

Add inside the `review: { ... }` object (after `checkAutoReview`):

```typescript
    rebase: (payload: { taskId: string }) => typedInvoke('review:rebase', payload),
    checkFreshness: (payload: { taskId: string }) =>
      typedInvoke('review:checkFreshness', payload)
```

- [ ] **Step 3: Implement `review:rebase` handler in `review.ts`**

Add in `registerReviewHandlers()`:

1. Get task + verify worktree path exists
2. `git fetch origin main` in worktree
3. `git rebase origin/main` in worktree
4. On success: `git rev-parse origin/main` to get baseSha, update task with `rebase_base_sha` + `rebased_at`, `notifySprintMutation`, return `{ success: true, baseSha }`
5. On failure: `git rebase --abort`, extract conflict files via `git diff --name-only --diff-filter=U`, return `{ success: false, error, conflicts }`

All git via `execFileAsync` with `env` from `buildAgentEnv()`. Wrapped in `safeHandle('review:rebase', ...)`.

- [ ] **Step 4: Implement `review:checkFreshness` handler**

Add in `registerReviewHandlers()`:

1. Get task, return `{ status: 'unknown' }` if no `rebase_base_sha`
2. Resolve repo config for `localPath`
3. `git fetch origin main` + `git rev-parse origin/main` in repo
4. If SHA matches `rebase_base_sha`: return `{ status: 'fresh', commitsBehind: 0 }`
5. Otherwise: `git rev-list --count <baseSha>..origin/main` to get count, return `{ status: 'stale', commitsBehind }`
6. On any error: return `{ status: 'unknown' }`

Wrapped in `safeHandle('review:checkFreshness', ...)`.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/preload/index.ts src/main/handlers/review.ts
git commit -m "feat: add review:rebase and review:checkFreshness IPC channels"
```

---

### Task 6: Rebase Freshness Badge + Button in Code Review UI

**Files:**

- Modify: `src/renderer/src/components/code-review/ReviewActions.tsx`
- Modify: `src/renderer/src/assets/code-review-neon.css`

- [ ] **Step 1: Add rebase freshness state and fetch logic**

In `ReviewActions.tsx`, add `useState` for freshness and a `useEffect` that calls `window.api.review.checkFreshness({ taskId: task.id })` when the selected task changes. Import `useEffect` and `RefreshCw` from lucide-react.

```typescript
const [freshness, setFreshness] = useState<{
  status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
  commitsBehind?: number
}>({ status: 'loading' })
```

- [ ] **Step 2: Add the rebase handler**

```typescript
const handleRebase = async (): Promise<void> => {
  setActionInFlight('rebase')
  try {
    const result = await window.api.review.rebase({ taskId: task.id })
    if (result.success) {
      toast.success('Rebased onto main')
      setFreshness({ status: 'fresh', commitsBehind: 0 })
      loadData()
    } else {
      toast.error(`Rebase failed: ${result.error || 'conflicts detected'}`)
      setFreshness({ status: 'conflict' })
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Rebase failed')
  } finally {
    setActionInFlight(null)
  }
}
```

- [ ] **Step 3: Add freshness badge + rebase button to JSX**

Insert before `cr-actions__primary`:

- Freshness badge: `<span>` with class `cr-actions__freshness--{status}` showing "Fresh" / "Stale (N behind)" / "Conflict" / "..."
- Rebase button: ghost style, `RefreshCw` icon, disabled when `actionInFlight` or `freshness.status === 'fresh'`

- [ ] **Step 4: Add CSS for the freshness badge**

In `src/renderer/src/assets/code-review-neon.css`, add styles for:

- `.cr-actions__rebase-status` — flex row container with border-bottom
- `.cr-actions__freshness` — small badge, 11px font, 4px border-radius
- Color variants: `--fresh` (cyan), `--stale` (orange), `--conflict` (red), `--unknown`/`--loading` (muted)

Use existing CSS custom properties from the neon theme.

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/code-review/ReviewActions.tsx src/renderer/src/assets/code-review-neon.css
git commit -m "feat: add rebase freshness badge and rebase button to Code Review"
```

---

### Task 7: Final Verification + Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Zero errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: Zero errors (warnings OK)

- [ ] **Step 4: Clean up existing duplicates**

Remove the known duplicates found during investigation:

- `src/renderer/src/assets/code-review-neon.css`: remove the second `.cr-actions__btn--ship` and `.cr-actions__btn--ship:hover` blocks (search for the duplicate, keep the first occurrence)
- `src/renderer/src/assets/sprint.css`: remove the second set of `.spec-drawer__prompt-section`, `.spec-drawer__prompt-toggle`, `.spec-drawer__prompt-toggle:hover`, `.spec-drawer__prompt-body` blocks (search for duplicates, keep first occurrences)

- [ ] **Step 5: Final commit**

```bash
git add src/renderer/src/assets/code-review-neon.css src/renderer/src/assets/sprint.css
git commit -m "chore: remove existing CSS duplicates found during dedup investigation"
```

- [ ] **Step 6: Run full CI-equivalent check**

Run: `npm run typecheck && npm test && npm run lint`
Expected: All PASS
