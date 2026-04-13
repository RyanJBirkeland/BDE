# Merge Dedup Check + Auto-Rebase Before Review

**Date:** 2026-04-05
**Status:** Draft

## Problem

When multiple pipeline agents work in parallel and merge close together, two problems emerge:

1. **Silent CSS duplicates** — Git merges cleanly at the text level because duplicate blocks land at different line numbers. Both agents independently add the same selector, and git sees them as independent additions. Result: identical CSS blocks pile up across successive merges.

2. **Stale branches** — Agent branches diverge from `main` while sitting in `review`. By the time a human merges, the branch is behind and either produces conflicts or (worse) merges cleanly but introduces semantic duplicates.

Evidence from the current codebase: 4 files with active duplicates (`code-review-neon.css`, `sprint.css`, `design-system.css`, `sankey-pipeline-neon.css`), plus 3 recent cleanup commits fixing similar issues.

## Solution

Two complementary features:

- **Feature A: Post-Merge CSS Dedup (auto-fix)** — After any merge into main, scan CSS files for duplicate selectors and auto-remove exact duplicates. Create a follow-up "dedup" commit if changes were made.
- **Feature C: Rebase-Before-Review (preventive)** — When a task transitions to `review`, rebase onto current `main`. If main moves while in review, re-rebase at merge time (already exists). Surface rebase status in the Code Review UI.

## Feature A: Post-Merge CSS Dedup

### How It Works

A new utility module `src/main/services/css-dedup.ts` that:

1. **Parses CSS files** into a list of rule blocks (selector + declaration body), preserving:
   - `@media` / `@supports` context (rules inside different at-rules are NOT duplicates)
   - `@keyframes` definitions (deduplicate by name)
   - Comment blocks (preserved)
2. **Detects exact duplicates** — same selector AND same declaration body within the same at-rule context. Two rules with the same selector but different properties are NOT auto-fixed (flagged as warnings instead).
3. **Removes duplicates** — keeps the LAST occurrence (later in the file = higher CSS specificity by cascade order), removes earlier identical copies.
4. **Returns a report** — list of files modified, selectors deduplicated, and any near-duplicate warnings.

### Integration Points

The dedup runs as a **post-merge step** in three places:

| Merge path                     | File                                   | Insert after                                                              |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| `review:mergeLocally`          | `src/main/handlers/review.ts`          | After successful merge block (between merge success and worktree cleanup) |
| Auto-merge (auto-review rules) | `src/main/agent-manager/completion.ts` | After squash merge in `resolveSuccess()` auto-review block                |
| `review:shipIt`                | `src/main/handlers/review.ts`          | After merge in `review:shipIt` handler                                    |

**Excluded:** `review:createPr` — this pushes the branch to remote and creates a GitHub PR without merging into local main. Since CSS duplicates only accumulate via local merges, dedup is not needed here.

**Post-merge sequence:**

```
merge succeeds
  → git diff --name-only --diff-filter=ACMR HEAD~1 HEAD (get changed CSS files, exclude deletes)
  → filter to *.css files only
  → cssDeduplicate(changedCssFiles, repoPath)
  → if changes made:
      git add <modified files>
      git commit -m "chore: deduplicate CSS from merge\n\nAutomated by BDE post-merge dedup"
  → if warnings (near-duplicates):
      write warnings to task notes via updateTask()
  → continue with worktree cleanup + status transition
```

If no CSS files changed, the dedup step is a no-op. If `HEAD~1` fails (edge case), skip dedup gracefully.

### CSS Parser Design

Not a full CSS parser — a lightweight block-level parser sufficient for dedup:

```typescript
interface CssBlock {
  type: 'rule' | 'keyframes' | 'media' | 'comment'
  selector: string // e.g., ".btn--ship:hover" or "@keyframes spin"
  body: string // normalized declaration body
  context: string // parent at-rule or "" for top-level
  startLine: number
  endLine: number
  raw: string // original text (for preservation)
}

// Returns { deduplicated: string; removed: CssBlock[]; warnings: string[] }
function deduplicateCss(content: string): DedupResult
```

**Normalization** for comparison: trim whitespace, normalize newlines, collapse spaces. This ensures blocks that differ only in formatting are still caught.

**Scope:** Only `.css` files changed in the merge commit. Does not touch `.tsx` inline styles or CSS-in-JS.

### What It Does NOT Do

- Does not merge near-duplicates (same selector, different properties) — these are flagged as warnings in task notes (written via `updateTask()` to append to the `notes` field)
- Does not reorder rules — only removes exact copies
- Does not touch files outside the merge diff
- Does not run on non-CSS files (no TS/JS dedup)

## Feature C: Rebase-Before-Review

### Current State

Rebase already happens in two places:

1. **`rebaseOntoMain()` in `completion.ts`** — called in `resolveSuccess()` after auto-commit. Rebases agent branch onto `origin/main` when agent finishes. If it fails, sets a note but still transitions to `review`.
2. **`review:mergeLocally` handler in `review.ts`** — rebases again at merge time (fetch + rebase inside the handler). If it fails, aborts rebase and blocks the merge with error to UI.

### Enhancement

Make the completion-time rebase (1) more informative and surface its status in the Code Review UI:

1. **Track rebase freshness** — store `rebased_at` timestamp and `rebase_base_sha` (the main SHA the branch is rebased onto) in task fields when the rebase succeeds in `completion.ts`. Requires modifying `rebaseOntoMain()` to capture and return the base SHA via `git rev-parse origin/main` after a successful rebase (current return type is `{ success: boolean; notes?: string }` — extend to include `baseSha?: string`).

2. **Freshness indicator in Code Review** — compare `rebase_base_sha` against current `origin/main` HEAD via a new `review:checkFreshness` IPC call (renderer cannot access git directly). Show in the Review UI:
   - **Fresh** (green) — branch is rebased onto current main
   - **Stale** (yellow) — main has moved since rebase, N commits behind. Merge will re-rebase automatically.
   - **Conflict** (red) — last rebase attempt failed, manual resolution may be needed

3. **Pre-merge re-rebase** — already exists at merge time (`review:mergeLocally` handler). No change needed, but surface the result more clearly:
   - On success: proceed with merge
   - On failure: return structured conflict info (file list, conflict type) instead of raw error string

4. **Rebase button in Code Review** — allow the user to manually trigger a rebase from the review UI without merging. Useful when reviewing changes and wanting to see the rebased diff against current main.

### New IPC Channels

```typescript
// review:rebase — manually rebase the agent branch onto current main
'review:rebase': {
  input: { taskId: string }
  output: { success: boolean; baseSha?: string; error?: string; conflicts?: string[] }
}

// review:checkFreshness — compare task's rebase_base_sha against current origin/main
'review:checkFreshness': {
  input: { taskId: string }
  output: { status: 'fresh' | 'stale' | 'conflict' | 'unknown'; commitsBehind?: number; baseSha?: string }
}
```

Both channels exposed via `window.api.review.rebase()` and `window.api.review.checkFreshness()` in the preload bridge, following the existing `review.*` namespace pattern.

### Task Fields

Two new nullable columns on `sprint_tasks`, added via migration v32 in `src/main/db.ts`:

| Field             | Type        | Purpose                                     |
| ----------------- | ----------- | ------------------------------------------- |
| `rebase_base_sha` | `TEXT NULL` | SHA of main that the branch is rebased onto |
| `rebased_at`      | `TEXT NULL` | ISO timestamp of last successful rebase     |

These are set in `completion.ts` after successful rebase and updated by the manual `review:rebase` handler.

### UI Changes

In `ReviewDetail` or `ReviewActions`:

- Small badge showing rebase freshness (Fresh/Stale/Conflict)
- "Rebase" button (triggers `review:rebase` IPC)
- Conflict state shows affected file names

## Architecture

```
src/main/services/css-dedup.ts          ← NEW: CSS dedup logic (pure function, no side effects)
src/main/services/css-dedup.test.ts     ← NEW: Unit tests
src/main/handlers/review.ts             ← MODIFY: add post-merge dedup step, review:rebase + review:checkFreshness handlers
src/main/agent-manager/completion.ts    ← MODIFY: extend rebaseOntoMain() return type, store rebase fields, call dedup on auto-merge
src/main/db.ts                          ← MODIFY: migration v32 — add rebase_base_sha, rebased_at columns
src/shared/types.ts                     ← MODIFY: add rebase_base_sha?, rebased_at? to SprintTask interface
src/shared/ipc-channels.ts              ← MODIFY: add review:rebase, review:checkFreshness channels
src/preload/index.ts                    ← MODIFY: expose review:rebase, review:checkFreshness in api.review namespace
src/renderer/.../code-review/           ← MODIFY: add rebase freshness badge + rebase button in ReviewActions/ReviewDetail
```

## Testing

### CSS Dedup (unit tests)

- Exact duplicate removal (same selector + body)
- Keeps last occurrence (cascade order)
- Respects `@media` context (same selector in different media queries = NOT duplicate)
- `@keyframes` dedup by name
- Near-duplicate warning (same selector, different body)
- Preserves comments and ordering of non-duplicate rules
- Handles empty files, single-rule files, no duplicates (no-op)
- Normalization: whitespace differences still detected as duplicates

### Rebase (integration tests)

- `review:rebase` IPC handler: success path, conflict path
- Freshness calculation: fresh when SHA matches, stale when behind
- Rebase fields persisted and cleared on merge

## Risks and Mitigations

| Risk                                      | Mitigation                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| CSS parser misidentifies block boundaries | Conservative parser — if uncertain, don't dedup. Unit tests with real-world CSS from the codebase            |
| Dedup changes cascade semantics           | Keep LAST occurrence (highest cascade priority). Only exact matches.                                         |
| Rebase fields add DB complexity           | Nullable columns, no foreign keys. Set-and-forget in completion.ts.                                          |
| Post-merge commit clutters history        | Single "chore: deduplicate CSS" commit only when changes found. Could be squashed into merge commit instead. |

## Out of Scope

- TypeScript/JS dedup (import dedup, function dedup) — different problem, different tool
- Full CSS linting (that's stylelint's job) — this is specifically for merge-induced duplicates
- Automatic conflict resolution agent (Option B from discussion) — future enhancement
- Pre-commit hooks — the dedup runs post-merge in the main process, not as a git hook
