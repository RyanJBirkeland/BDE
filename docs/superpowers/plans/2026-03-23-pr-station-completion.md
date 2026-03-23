# PR Station Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete PR Station as a full code review tool — view reviews, read comment threads, leave inline comments with range selection, and submit batch reviews — all from within BDE.

**Architecture:** All GitHub API calls proxy through `github:fetch` IPC (token never enters renderer). New features add API functions to `github-api.ts`, types to `shared/types.ts`, UI components to `components/pr-station/` and `components/diff/`, and a new `pendingReview` Zustand store. No new IPC channels needed. No new npm dependencies.

**Tech Stack:** React, TypeScript strict, Zustand, lucide-react icons, GitHub REST API v3, existing `github:fetch` IPC proxy.

**Spec:** `docs/superpowers/specs/2026-03-23-pr-station-completion-design.md`

**Pre-existing context you need:**
- All GitHub API calls go through `githubFetchRaw(path, init?)` in `src/renderer/src/lib/github-api.ts` which calls `window.api.github.fetch()` — this proxies through the main process and adds the OAuth token
- `fetchAllPages<T>(path)` handles pagination via `linkNext`
- The `REPO_OPTIONS` array in `src/renderer/src/lib/constants.ts` maps repo labels to `{ label, owner, color }`
- Toast notifications: `import { toast } from '../../stores/toasts'` then `toast.success(msg)` / `toast.error(msg)`
- Markdown rendering: `import { renderMarkdown } from '../../lib/render-markdown'` returns sanitized HTML string (used with React's dangerouslySetInnerHTML — content is sanitized by renderMarkdown, this is the established project pattern used in PRStationDetail and SpecViewer)
- Design tokens are CSS variables: `--bde-accent`, `--bde-danger`, `--bde-warning`, `--bde-text`, `--bde-text-muted`, `--bde-text-dim`, `--bde-surface`, `--bde-surface-high`, `--bde-border`, `--bde-font-code`, `--bde-size-xs/sm/md/lg/xl/xxl`, `--bde-radius-sm/md`, `--bde-transition-fast`
- UI primitives: `Button` (variants: primary/danger/ghost/icon, sizes: sm/md), `EmptyState`, `ErrorBanner`, `Badge`, `Textarea`, `ConfirmModal` in `src/renderer/src/components/ui/`
- DiffViewer has two modes: `VirtualizedDiffContent` (500+ lines) and `PlainDiffContent` (< 500 lines). Both render `DiffLine` objects with `{ type: 'add'|'del'|'ctx', content, lineNo: { old?, new? } }`
- The `FlatRow` type in DiffViewer is a union: `FileHeaderRow | HunkHeaderRow | LineRow`
- Build check: `npm run typecheck && npm test` (pre-push hook enforces this)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/renderer/src/stores/pendingReview.ts` | Zustand store for pending review comments |
| `src/renderer/src/components/pr-station/PRStationReviews.tsx` | Reviews section for Info tab |
| `src/renderer/src/components/pr-station/PRStationConversation.tsx` | Comment timeline for Info tab |
| `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx` | Conflict warning with file list |
| `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx` | Batch review submission dialog |
| `src/renderer/src/components/diff/DiffCommentWidget.tsx` | Inline comment display in diff |
| `src/renderer/src/components/diff/DiffCommentComposer.tsx` | Comment input box in diff |

### Modified Files
| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `PrReview`, `PrComment`, `PrIssueComment` types |
| `src/renderer/src/lib/github-api.ts` | Add `getReviews`, `getReviewComments`, `getIssueComments`, `createReview`, `replyToComment` |
| `src/renderer/src/assets/pr-station.css` | Tab styles, reviews, conversation, conflict, review dialog |
| `src/renderer/src/assets/diff.css` | Selection highlight, comment widgets, composer |
| `src/renderer/src/views/PRStationView.tsx` | Review banner + dialog, conflict integration |
| `src/renderer/src/components/pr-station/PRStationDetail.tsx` | Reviews section, conversation section, conflict banner |
| `src/renderer/src/components/pr-station/PRStationDiff.tsx` | Pass comments + pending state to DiffViewer |
| `src/renderer/src/components/diff/DiffViewer.tsx` | Line selection, comment anchoring, comment widgets |

---

## Task 1: Fix Tab CSS + Conflict Store Wiring

**Files:**
- Modify: `src/renderer/src/assets/pr-station.css` (add tab styles after line 53)
- Modify: `src/renderer/src/views/PRStationView.tsx` (add conflict fetch)
- Create: `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx`
- Modify: `src/renderer/src/components/pr-station/PRStationDetail.tsx` (add conflict banner)
- Modify: `src/renderer/src/lib/github-api.ts` (add `mergeable_state` to PRDetail)

- [ ] **Step 1: Add missing tab CSS to pr-station.css**

Add after the `.pr-station__detail-content` block (after line 29 in pr-station.css):

```css
/* -- Detail header with tabs -- */
.pr-station__detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--bde-border);
  background: var(--bde-bg);
  position: sticky;
  top: 0;
  z-index: 5;
}

.pr-station__tabs {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.pr-station__tab {
  padding: 4px 12px;
  font-size: var(--bde-size-sm);
  font-family: inherit;
  color: var(--bde-text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--bde-transition-fast), border-color var(--bde-transition-fast);
}

.pr-station__tab:hover {
  color: var(--bde-text);
}

.pr-station__tab--active {
  color: var(--bde-accent);
  border-bottom-color: var(--bde-accent);
}
```

Note: `.pr-station__detail-title` already exists at line 46 — do NOT duplicate it. Verify the existing rule and keep it as-is.

- [ ] **Step 2: Create PRStationConflictBanner component**

Create `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { OpenPr } from '../../../../shared/types'
import { REPO_OPTIONS } from '../../lib/constants'

interface ConflictBannerProps {
  pr: OpenPr
  mergeableState: string | null | undefined
}

export function PRStationConflictBanner({ pr, mergeableState }: ConflictBannerProps) {
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mergeableState !== 'dirty') {
      setConflictFiles([])
      return
    }

    const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)
    if (!repo) return

    setLoading(true)
    window.api
      .checkConflictFiles({ owner: repo.owner, repo: repo.label, prNumber: pr.number })
      .then((result) => {
        setConflictFiles(result.files)
      })
      .catch(() => {
        setConflictFiles([])
      })
      .finally(() => setLoading(false))
  }, [pr.repo, pr.number, mergeableState])

  if (mergeableState !== 'dirty') return null

  return (
    <div className="pr-conflict-banner">
      <div className="pr-conflict-banner__header">
        <AlertTriangle size={14} />
        <span>This PR has merge conflicts</span>
      </div>
      {loading ? (
        <span className="pr-conflict-banner__loading">Checking conflicting files...</span>
      ) : conflictFiles.length > 0 ? (
        <ul className="pr-conflict-banner__files">
          {conflictFiles.map((f) => (
            <li key={f} className="pr-conflict-banner__file">{f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Add conflict banner CSS to pr-station.css**

Append to end of `pr-station.css`:

```css
/* -- Conflict Banner -- */
.pr-conflict-banner {
  background: color-mix(in srgb, var(--bde-warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bde-warning) 30%, transparent);
  border-radius: var(--bde-radius-md);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pr-conflict-banner__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--bde-size-sm);
  font-weight: 600;
  color: var(--bde-warning);
}

.pr-conflict-banner__loading {
  font-size: var(--bde-size-xs);
  color: var(--bde-text-dim);
  font-style: italic;
}

.pr-conflict-banner__files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pr-conflict-banner__file {
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-xs);
  color: var(--bde-text-muted);
  padding: 2px 8px;
  background: var(--bde-surface);
  border-radius: var(--bde-radius-sm);
}
```

- [ ] **Step 4: Add `mergeable_state` to PRDetail type in github-api.ts**

In `src/renderer/src/lib/github-api.ts`, update the `PRDetail` interface (around line 127):

```typescript
export interface PRDetail {
  number: number
  title: string
  body: string | null
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null  // <-- add this field
  head: { ref: string; sha: string }
  base: { ref: string }
  user: { login: string; avatar_url: string }
  additions: number
  deletions: number
  labels: { name: string; color: string }[]
}
```

- [ ] **Step 5: Wire conflict banner into PRStationDetail**

In `src/renderer/src/components/pr-station/PRStationDetail.tsx`:

Add import:
```tsx
import { PRStationConflictBanner } from './PRStationConflictBanner'
```

Extract mergeable_state from detail (after the `if (!detail)` guard):
```tsx
const mergeableState = detail?.mergeable_state ?? null
```

Render the banner between the header and the Description section:
```tsx
{/* After </div> of pr-detail__header, before Description section */}
<PRStationConflictBanner pr={pr} mergeableState={mergeableState} />
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/assets/pr-station.css \
  src/renderer/src/components/pr-station/PRStationConflictBanner.tsx \
  src/renderer/src/components/pr-station/PRStationDetail.tsx \
  src/renderer/src/lib/github-api.ts
git commit -m "fix: add missing PR Station tab CSS and conflict banner"
```

---

## Task 2: Reviews & Approvals Display

**Files:**
- Modify: `src/shared/types.ts` (add PrReview type)
- Modify: `src/renderer/src/lib/github-api.ts` (add getReviews)
- Create: `src/renderer/src/components/pr-station/PRStationReviews.tsx`
- Modify: `src/renderer/src/components/pr-station/PRStationDetail.tsx` (add reviews section)
- Modify: `src/renderer/src/assets/pr-station.css` (reviews styles)

- [ ] **Step 1: Add PrReview type to shared/types.ts**

Append after the existing PR-related types (after `PrListPayload`):

```typescript
export interface PrReview {
  id: number
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  submitted_at: string
  html_url: string
}
```

- [ ] **Step 2: Add getReviews to github-api.ts**

Add import of `PrReview` from shared types at the top. Then add the function:

```typescript
export async function getReviews(
  owner: string,
  repo: string,
  number: number
): Promise<PrReview[]> {
  return fetchAllPages<PrReview>(
    `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`
  )
}
```

Also add to the type import at top of file: add `PrReview` to the import from `'../../../shared/types'` (or `'../../../../shared/types'` depending on relative path — match existing pattern).

- [ ] **Step 3: Create PRStationReviews component**

Create `src/renderer/src/components/pr-station/PRStationReviews.tsx`:

```tsx
import { CheckCircle2, XCircle, MessageSquare, MinusCircle } from 'lucide-react'
import type { PrReview } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface PRStationReviewsProps {
  reviews: PrReview[]
  loading: boolean
}

function ReviewStateBadge({ state }: { state: PrReview['state'] }) {
  switch (state) {
    case 'APPROVED':
      return (
        <span className="pr-review__badge pr-review__badge--approved">
          <CheckCircle2 size={12} /> Approved
        </span>
      )
    case 'CHANGES_REQUESTED':
      return (
        <span className="pr-review__badge pr-review__badge--changes">
          <XCircle size={12} /> Changes requested
        </span>
      )
    case 'COMMENTED':
      return (
        <span className="pr-review__badge pr-review__badge--commented">
          <MessageSquare size={12} /> Commented
        </span>
      )
    case 'DISMISSED':
      return (
        <span className="pr-review__badge pr-review__badge--dismissed">
          <MinusCircle size={12} /> Dismissed
        </span>
      )
    default:
      return null
  }
}

/** Deduplicate reviews: keep the latest review per user (GitHub keeps all states). */
function latestReviewPerUser(reviews: PrReview[]): PrReview[] {
  const map = new Map<string, PrReview>()
  for (const r of reviews) {
    if (r.state === 'PENDING') continue
    const existing = map.get(r.user.login)
    if (!existing || new Date(r.submitted_at) > new Date(existing.submitted_at)) {
      map.set(r.user.login, r)
    }
  }
  return Array.from(map.values())
}

export function PRStationReviews({ reviews, loading }: PRStationReviewsProps) {
  if (loading) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Reviews</h3>
        <div className="pr-detail__checks-loading">
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
          <div className="sprint-board__skeleton" style={{ height: 28 }} />
        </div>
      </div>
    )
  }

  const latest = latestReviewPerUser(reviews)

  if (latest.length === 0) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Reviews</h3>
        <span className="pr-detail__no-data">No reviews yet</span>
      </div>
    )
  }

  return (
    <div className="pr-detail__section">
      <h3 className="pr-detail__section-title">
        Reviews
        <span className="bde-count-badge">{latest.length}</span>
      </h3>
      <div className="pr-reviews">
        {latest.map((review) => (
          <div key={review.id} className="pr-review">
            <div className="pr-review__header">
              <span className="pr-review__author">{review.user.login}</span>
              <ReviewStateBadge state={review.state} />
              <span className="pr-review__time">{timeAgo(review.submitted_at)}</span>
            </div>
            {review.body && (
              <div
                className="pr-review__body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(review.body) }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add reviews CSS to pr-station.css**

Append to end of `pr-station.css`:

```css
/* -- Reviews -- */
.pr-reviews {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pr-review {
  background: var(--bde-surface);
  border-radius: var(--bde-radius-md);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pr-review__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--bde-size-sm);
}

.pr-review__author {
  font-weight: 600;
  color: var(--bde-text);
}

.pr-review__time {
  color: var(--bde-text-dim);
  font-size: var(--bde-size-xs);
  margin-left: auto;
}

.pr-review__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 9999px;
  line-height: 1.5;
}

.pr-review__badge--approved {
  color: var(--bde-accent);
  background: color-mix(in srgb, var(--bde-accent) 15%, transparent);
}

.pr-review__badge--changes {
  color: var(--bde-danger);
  background: color-mix(in srgb, var(--bde-danger) 15%, transparent);
}

.pr-review__badge--commented {
  color: var(--bde-text-muted);
  background: var(--bde-surface-high);
}

.pr-review__badge--dismissed {
  color: var(--bde-text-dim);
  background: var(--bde-surface-high);
  text-decoration: line-through;
}

.pr-review__body {
  font-size: var(--bde-size-sm);
  color: var(--bde-text);
  line-height: 1.5;
}

.pr-review__body p { margin: 2px 0; }

.pr-review__body code {
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-xs);
  background: var(--bde-surface-high);
  padding: 1px 4px;
  border-radius: 3px;
}
```

- [ ] **Step 5: Wire reviews into PRStationDetail**

In `PRStationDetail.tsx`:

Add imports:
```tsx
import { PRStationReviews } from './PRStationReviews'
import { getReviews } from '../../lib/github-api'
import type { PrReview } from '../../../../shared/types'
```

Add state:
```tsx
const [reviews, setReviews] = useState<PrReview[]>([])
const [reviewsLoading, setReviewsLoading] = useState(true)
```

Update the `fetchAll()` function to also fetch reviews (extend the existing Promise.all):
```tsx
const [prDetail, prFiles, prReviews] = await Promise.all([
  getPRDetail(repo.owner, repo.label, pr.number),
  getPRFiles(repo.owner, repo.label, pr.number),
  getReviews(repo.owner, repo.label, pr.number)
])
if (controller.signal.aborted) return
setDetail(prDetail)
setFiles(prFiles)
setReviews(prReviews)
setReviewsLoading(false)
setLoading(false)
```

Render `<PRStationReviews reviews={reviews} loading={reviewsLoading} />` between CI Checks and Changed Files sections.

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts \
  src/renderer/src/lib/github-api.ts \
  src/renderer/src/components/pr-station/PRStationReviews.tsx \
  src/renderer/src/components/pr-station/PRStationDetail.tsx \
  src/renderer/src/assets/pr-station.css
git commit -m "feat(pr-station): display PR reviews and approval status"
```

---

## Task 3: Comment Threads Display (Info Tab)

**Files:**
- Modify: `src/shared/types.ts` (add PrComment, PrIssueComment types)
- Modify: `src/renderer/src/lib/github-api.ts` (add getReviewComments, getIssueComments)
- Create: `src/renderer/src/components/pr-station/PRStationConversation.tsx`
- Modify: `src/renderer/src/components/pr-station/PRStationDetail.tsx` (add conversation section)
- Modify: `src/renderer/src/assets/pr-station.css` (conversation styles)

- [ ] **Step 1: Add comment types to shared/types.ts**

Append after the `PrReview` type:

```typescript
export interface PrComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  updated_at: string
  html_url: string
  path?: string
  line?: number | null
  original_line?: number | null
  side?: 'LEFT' | 'RIGHT'
  start_line?: number | null
  start_side?: 'LEFT' | 'RIGHT'
  diff_hunk?: string
  in_reply_to_id?: number | null
  pull_request_review_id?: number | null
}

export interface PrIssueComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  html_url: string
}
```

- [ ] **Step 2: Add API functions to github-api.ts**

Add `PrComment` and `PrIssueComment` to the type import from shared types. Then add:

```typescript
export async function getReviewComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrComment[]> {
  return fetchAllPages<PrComment>(
    `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`
  )
}

export async function getIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrIssueComment[]> {
  return fetchAllPages<PrIssueComment>(
    `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`
  )
}
```

- [ ] **Step 3: Create PRStationConversation component**

Create `src/renderer/src/components/pr-station/PRStationConversation.tsx`:

```tsx
import { FileCode2 } from 'lucide-react'
import type { PrComment, PrIssueComment } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface ConversationProps {
  reviewComments: PrComment[]
  issueComments: PrIssueComment[]
  loading: boolean
}

type TimelineItem =
  | { kind: 'issue'; comment: PrIssueComment }
  | { kind: 'review-thread'; path: string; comments: PrComment[] }

/**
 * Group review comments into threads (by in_reply_to_id chain),
 * merge with issue comments into a chronological timeline.
 */
function buildTimeline(
  reviewComments: PrComment[],
  issueComments: PrIssueComment[]
): TimelineItem[] {
  // Group review comments into threads
  const rootComments = reviewComments.filter((c) => !c.in_reply_to_id)
  const replyMap = new Map<number, PrComment[]>()
  for (const c of reviewComments) {
    if (c.in_reply_to_id) {
      const replies = replyMap.get(c.in_reply_to_id) ?? []
      replies.push(c)
      replyMap.set(c.in_reply_to_id, replies)
    }
  }

  const threads: { thread: PrComment[]; firstAt: string }[] = []
  for (const root of rootComments) {
    const thread = [root]
    const replies = replyMap.get(root.id) ?? []
    replies.sort((a, b) => a.created_at.localeCompare(b.created_at))
    thread.push(...replies)
    threads.push({ thread, firstAt: root.created_at })
  }

  const items: { sortKey: string; item: TimelineItem }[] = []

  for (const ic of issueComments) {
    items.push({ sortKey: ic.created_at, item: { kind: 'issue', comment: ic } })
  }

  for (const { thread, firstAt } of threads) {
    items.push({
      sortKey: firstAt,
      item: { kind: 'review-thread', path: thread[0].path ?? '', comments: thread }
    })
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return items.map((i) => i.item)
}

function CommentCard({ login, body, createdAt }: { login: string; body: string; createdAt: string }) {
  return (
    <div className="pr-conversation__comment">
      <div className="pr-conversation__comment-header">
        <span className="pr-conversation__author">{login}</span>
        <span className="pr-conversation__time">{timeAgo(createdAt)}</span>
      </div>
      <div
        className="pr-conversation__body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
      />
    </div>
  )
}

export function PRStationConversation({ reviewComments, issueComments, loading }: ConversationProps) {
  if (loading) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Conversation</h3>
        <div className="pr-detail__checks-loading">
          <div className="sprint-board__skeleton" style={{ height: 40 }} />
          <div className="sprint-board__skeleton" style={{ height: 40 }} />
        </div>
      </div>
    )
  }

  const timeline = buildTimeline(reviewComments, issueComments)

  if (timeline.length === 0) {
    return (
      <div className="pr-detail__section">
        <h3 className="pr-detail__section-title">Conversation</h3>
        <span className="pr-detail__no-data">No comments</span>
      </div>
    )
  }

  const totalComments = issueComments.length + reviewComments.length

  return (
    <div className="pr-detail__section">
      <h3 className="pr-detail__section-title">
        Conversation
        <span className="bde-count-badge">{totalComments}</span>
      </h3>
      <div className="pr-conversation">
        {timeline.map((item) => {
          if (item.kind === 'issue') {
            return (
              <CommentCard
                key={`ic-${item.comment.id}`}
                login={item.comment.user.login}
                body={item.comment.body}
                createdAt={item.comment.created_at}
              />
            )
          }
          const root = item.comments[0]
          return (
            <div key={`rt-${root.id}`} className="pr-conversation__thread">
              <div className="pr-conversation__thread-file">
                <FileCode2 size={12} />
                <span>{item.path}</span>
                {root.line && <span className="pr-conversation__thread-line">L{root.line}</span>}
              </div>
              {item.comments.map((c) => (
                <CommentCard
                  key={c.id}
                  login={c.user.login}
                  body={c.body}
                  createdAt={c.created_at}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add conversation CSS to pr-station.css**

Append to end of `pr-station.css`:

```css
/* -- Conversation -- */
.pr-conversation {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pr-conversation__comment {
  background: var(--bde-surface);
  border-radius: var(--bde-radius-md);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pr-conversation__comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--bde-size-sm);
}

.pr-conversation__author {
  font-weight: 600;
  color: var(--bde-text);
}

.pr-conversation__time {
  color: var(--bde-text-dim);
  font-size: var(--bde-size-xs);
  margin-left: auto;
}

.pr-conversation__body {
  font-size: var(--bde-size-sm);
  color: var(--bde-text);
  line-height: 1.5;
}

.pr-conversation__body p { margin: 2px 0; }
.pr-conversation__body code {
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-xs);
  background: var(--bde-surface-high);
  padding: 1px 4px;
  border-radius: 3px;
}

.pr-conversation__thread {
  border: 1px solid var(--bde-border);
  border-radius: var(--bde-radius-md);
  overflow: hidden;
}

.pr-conversation__thread-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--bde-surface-high);
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-xs);
  color: var(--bde-text-muted);
  border-bottom: 1px solid var(--bde-border);
}

.pr-conversation__thread-line {
  color: var(--bde-accent);
}

.pr-conversation__thread .pr-conversation__comment {
  border-radius: 0;
}

.pr-conversation__thread .pr-conversation__comment + .pr-conversation__comment {
  border-top: 1px solid var(--bde-border);
}
```

- [ ] **Step 5: Wire conversation into PRStationDetail**

In `PRStationDetail.tsx`:

Add imports:
```tsx
import { PRStationConversation } from './PRStationConversation'
import { getReviewComments, getIssueComments } from '../../lib/github-api'
import type { PrComment, PrIssueComment } from '../../../../shared/types'
```

Add state:
```tsx
const [reviewComments, setReviewComments] = useState<PrComment[]>([])
const [issueComments, setIssueComments] = useState<PrIssueComment[]>([])
const [commentsLoading, setCommentsLoading] = useState(true)
```

Extend the `fetchAll()` Promise.all (building on Task 2 which already added reviews):
```tsx
const [prDetail, prFiles, prReviews, prReviewComments, prIssueComments] = await Promise.all([
  getPRDetail(repo.owner, repo.label, pr.number),
  getPRFiles(repo.owner, repo.label, pr.number),
  getReviews(repo.owner, repo.label, pr.number),
  getReviewComments(repo.owner, repo.label, pr.number),
  getIssueComments(repo.owner, repo.label, pr.number)
])
if (controller.signal.aborted) return
setDetail(prDetail)
setFiles(prFiles)
setReviews(prReviews)
setReviewComments(prReviewComments)
setIssueComments(prIssueComments)
setCommentsLoading(false)
setReviewsLoading(false)
setLoading(false)
```

Render between Reviews and Changed Files:
```tsx
<PRStationConversation
  reviewComments={reviewComments}
  issueComments={issueComments}
  loading={commentsLoading}
/>
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts \
  src/renderer/src/lib/github-api.ts \
  src/renderer/src/components/pr-station/PRStationConversation.tsx \
  src/renderer/src/components/pr-station/PRStationDetail.tsx \
  src/renderer/src/assets/pr-station.css
git commit -m "feat(pr-station): display PR comment threads and conversation timeline"
```

---

## Task 4: Diff Enhancement — Line Selection + Comment Anchoring

**Files:**
- Create: `src/renderer/src/components/diff/DiffCommentWidget.tsx`
- Modify: `src/renderer/src/components/diff/DiffViewer.tsx` (selection + comment rendering)
- Modify: `src/renderer/src/components/pr-station/PRStationDiff.tsx` (pass comments data)
- Modify: `src/renderer/src/assets/diff.css` (selection + comment styles)

**Important DiffViewer context:**
- The component has two rendering paths: `VirtualizedDiffContent` (>500 lines) and `PlainDiffContent` (<500 lines)
- For the initial implementation, only add comment/selection support to `PlainDiffContent`
- When comments exist, force plain mode to avoid height calculation complexity in virtualized mode
- Each line renders: old gutter, new gutter, marker, text content
- Lines are `DiffLine` with `type: 'add'|'del'|'ctx'` and `lineNo: { old?: number, new?: number }`

- [ ] **Step 1: Create DiffCommentWidget component**

Create `src/renderer/src/components/diff/DiffCommentWidget.tsx`:

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import type { PrComment } from '../../../../shared/types'
import { renderMarkdown } from '../../lib/render-markdown'
import { timeAgo } from '../../lib/format'

interface DiffCommentWidgetProps {
  comments: PrComment[]
}

export function DiffCommentWidget({ comments }: DiffCommentWidgetProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (comments.length === 0) return null

  return (
    <div className="diff-comment-widget">
      <button
        className="diff-comment-widget__toggle"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <MessageSquare size={12} />
        <span>{comments.length} comment{comments.length > 1 ? 's' : ''}</span>
      </button>
      {!collapsed && (
        <div className="diff-comment-widget__thread">
          {comments.map((c) => (
            <div key={c.id} className="diff-comment-widget__comment">
              <div className="diff-comment-widget__header">
                <span className="diff-comment-widget__author">{c.user.login}</span>
                <span className="diff-comment-widget__time">{timeAgo(c.created_at)}</span>
              </div>
              <div
                className="diff-comment-widget__body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add diff comment and selection CSS to diff.css**

Append to `src/renderer/src/assets/diff.css`:

```css
/* -- Line selection -- */
.diff-line--selected {
  background: color-mix(in srgb, var(--bde-accent) 15%, transparent) !important;
}

.diff-line__gutter--selectable {
  cursor: pointer;
  user-select: none;
}

.diff-line__gutter--selectable:hover {
  background: color-mix(in srgb, var(--bde-accent) 20%, transparent);
}

.diff-selection-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: var(--bde-accent);
  color: #000;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  position: absolute;
  left: 4px;
  z-index: 3;
  transition: transform var(--bde-transition-fast);
}

.diff-selection-trigger:hover {
  transform: scale(1.15);
}

/* -- Inline comment widget -- */
.diff-comment-widget {
  margin: 0 0 0 96px;
  border: 1px solid var(--bde-border);
  border-radius: var(--bde-radius-md);
  background: var(--bde-bg);
  overflow: hidden;
}

.diff-comment-widget__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  width: 100%;
  font-size: var(--bde-size-xs);
  font-family: inherit;
  color: var(--bde-text-muted);
  background: var(--bde-surface);
  border: none;
  cursor: pointer;
  transition: background var(--bde-transition-fast);
}

.diff-comment-widget__toggle:hover {
  background: var(--bde-surface-high);
}

.diff-comment-widget__thread {
  display: flex;
  flex-direction: column;
}

.diff-comment-widget__comment {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--bde-border);
}

.diff-comment-widget__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--bde-size-xs);
}

.diff-comment-widget__author {
  font-weight: 600;
  color: var(--bde-text);
}

.diff-comment-widget__time {
  color: var(--bde-text-dim);
  margin-left: auto;
}

.diff-comment-widget__body {
  font-size: var(--bde-size-xs);
  color: var(--bde-text);
  line-height: 1.5;
}

.diff-comment-widget__body p { margin: 2px 0; }
.diff-comment-widget__body code {
  font-family: var(--bde-font-code);
  font-size: 11px;
  background: var(--bde-surface);
  padding: 1px 3px;
  border-radius: 2px;
}
```

- [ ] **Step 3: Modify DiffViewer to accept comments and add selection support**

In `src/renderer/src/components/diff/DiffViewer.tsx`:

Add imports:
```tsx
import type { PrComment } from '../../../../shared/types'
import { DiffCommentWidget } from './DiffCommentWidget'
```

Add new types and update component interface:
```tsx
export interface LineRange {
  file: string
  startLine: number
  endLine: number
  side: 'LEFT' | 'RIGHT'
}

interface DiffViewerProps {
  files: DiffFile[]
  comments?: PrComment[]
  selectedRange?: LineRange | null
  onSelectRange?: (range: LineRange | null) => void
  onCommentTrigger?: (range: LineRange) => void
}
```

Update the DiffViewer function signature:
```tsx
function DiffViewer({
  files,
  comments = [],
  selectedRange = null,
  onSelectRange,
  onCommentTrigger
}: DiffViewerProps): React.JSX.Element {
```

Force plain mode when comments exist (prevents virtualization complexity):
```tsx
const hasComments = comments.length > 0
const useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments
```

Build a comments-by-position map:
```tsx
const commentsByPosition = useMemo(() => {
  const map = new Map<string, PrComment[]>()
  for (const c of comments) {
    if (!c.path || c.line == null) continue
    const key = `${c.path}:${c.line}`
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  // Group replies with their root
  for (const c of comments) {
    if (!c.in_reply_to_id || !c.path) continue
    // Already handled above as standalone — skip (reply chains grouped in Conversation tab)
  }
  return map
}, [comments])
```

Add selection state:
```tsx
const [selectionStart, setSelectionStart] = useState<{ file: string; line: number; side: 'LEFT' | 'RIGHT' } | null>(null)
const [isSelecting, setIsSelecting] = useState(false)
```

In **PlainDiffContent**, update each line's gutter to be clickable:

For the new-line gutter (right side):
```tsx
<span
  className="diff-line__gutter diff-line__gutter--new diff-line__gutter--selectable"
  onMouseDown={() => {
    if (line.lineNo.new == null) return
    setSelectionStart({ file: file.path, line: line.lineNo.new, side: 'RIGHT' })
    setIsSelecting(true)
    onSelectRange?.({ file: file.path, startLine: line.lineNo.new, endLine: line.lineNo.new, side: 'RIGHT' })
  }}
  onMouseEnter={() => {
    if (!isSelecting || !selectionStart || selectionStart.file !== file.path) return
    if (line.lineNo.new == null) return
    onSelectRange?.({
      file: file.path,
      startLine: Math.min(selectionStart.line, line.lineNo.new),
      endLine: Math.max(selectionStart.line, line.lineNo.new),
      side: 'RIGHT'
    })
  }}
>
  {line.lineNo.new ?? ''}
</span>
```

Add a global mouseup handler:
```tsx
useEffect(() => {
  const handleMouseUp = () => setIsSelecting(false)
  window.addEventListener('mouseup', handleMouseUp)
  return () => window.removeEventListener('mouseup', handleMouseUp)
}, [])
```

Check if a line is selected:
```tsx
const isLineSelected = (filePath: string, lineNo: number | undefined): boolean => {
  if (!selectedRange || !lineNo) return false
  return selectedRange.file === filePath &&
    lineNo >= selectedRange.startLine &&
    lineNo <= selectedRange.endLine
}
```

Add `diff-line--selected` class when selected:
```tsx
<div className={`diff-line diff-line--${line.type}${isLineSelected(file.path, line.lineNo.new) ? ' diff-line--selected' : ''}`}>
```

After each line, render comment widget if comments exist at that position:
```tsx
{(() => {
  const lineNum = line.lineNo.new ?? line.lineNo.old
  if (!lineNum) return null
  const key = `${file.path}:${lineNum}`
  const lineComments = commentsByPosition.get(key)
  if (!lineComments || lineComments.length === 0) return null
  return <DiffCommentWidget comments={lineComments} />
})()}
```

Show the "+" trigger button at the start of the selection:
```tsx
{selectedRange && selectedRange.file === file.path &&
  line.lineNo.new === selectedRange.startLine && onCommentTrigger && (
  <div style={{ position: 'relative' }}>
    <button
      className="diff-selection-trigger"
      onClick={(e) => {
        e.stopPropagation()
        onCommentTrigger(selectedRange)
      }}
      title="Add comment"
    >
      +
    </button>
  </div>
)}
```

Note: These gutter handlers and comment widgets need to be passed down to `PlainDiffContent` as props. Update `PlainDiffContent`'s props to include: `comments`, `commentsByPosition`, `selectedRange`, `selectionStart`, `isSelecting`, `setSelectionStart`, `setIsSelecting`, `onSelectRange`, `onCommentTrigger`, `isLineSelected`.

Alternatively (simpler): Move the selection state and comment map into the parent `DiffViewer` and pass only the needed callbacks and data to `PlainDiffContent`.

- [ ] **Step 4: Wire comments from PRStationDiff to DiffViewer**

In `src/renderer/src/components/pr-station/PRStationDiff.tsx`:

Add imports:
```tsx
import { getReviewComments } from '../../lib/github-api'
import type { PrComment } from '../../../../shared/types'
import type { LineRange } from '../diff/DiffViewer'
```

Add state:
```tsx
const [comments, setComments] = useState<PrComment[]>([])
const [selectedRange, setSelectedRange] = useState<LineRange | null>(null)
```

Fetch comments alongside diff (in the existing useEffect, after diff is loaded):
```tsx
// Add after the getPRDiff call succeeds and before loadDiff:
getReviewComments(repoOption.owner, repoOption.label, pr.number)
  .then((c) => { if (!cancelled) setComments(c) })
  .catch(() => { if (!cancelled) setComments([]) })
```

Pass to DiffViewer:
```tsx
<DiffViewer
  files={files}
  comments={comments}
  selectedRange={selectedRange}
  onSelectRange={setSelectedRange}
/>
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/diff/DiffCommentWidget.tsx \
  src/renderer/src/components/diff/DiffViewer.tsx \
  src/renderer/src/components/pr-station/PRStationDiff.tsx \
  src/renderer/src/assets/diff.css
git commit -m "feat(pr-station): add diff line selection and inline comment display"
```

---

## Task 5: Inline Commenting (Write Path) + Pending Review Store

**Files:**
- Create: `src/renderer/src/stores/pendingReview.ts`
- Create: `src/renderer/src/components/diff/DiffCommentComposer.tsx`
- Modify: `src/renderer/src/lib/github-api.ts` (add createReview, replyToComment)
- Modify: `src/renderer/src/components/diff/DiffViewer.tsx` (render composer + pending comments)
- Modify: `src/renderer/src/components/pr-station/PRStationDiff.tsx` (wire pending state)
- Modify: `src/renderer/src/assets/diff.css` (composer styles)

- [ ] **Step 1: Create pending review store**

Create `src/renderer/src/stores/pendingReview.ts`:

```typescript
import { create } from 'zustand'

export interface PendingComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  body: string
}

interface PendingReviewStore {
  /** Keyed by `${repo}#${prNumber}` */
  pendingComments: Map<string, PendingComment[]>
  addComment: (prKey: string, comment: PendingComment) => void
  updateComment: (prKey: string, commentId: string, body: string) => void
  removeComment: (prKey: string, commentId: string) => void
  clearPending: (prKey: string) => void
  getPendingCount: (prKey: string) => number
}

export const usePendingReviewStore = create<PendingReviewStore>((set, get) => ({
  pendingComments: new Map(),

  addComment: (prKey, comment) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = [...(next.get(prKey) ?? []), comment]
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  updateComment: (prKey, commentId, body) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = (next.get(prKey) ?? []).map((c) =>
        c.id === commentId ? { ...c, body } : c
      )
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  removeComment: (prKey, commentId) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      const list = (next.get(prKey) ?? []).filter((c) => c.id !== commentId)
      next.set(prKey, list)
      return { pendingComments: next }
    }),

  clearPending: (prKey) =>
    set((state) => {
      const next = new Map(state.pendingComments)
      next.delete(prKey)
      return { pendingComments: next }
    }),

  getPendingCount: (prKey) => (get().pendingComments.get(prKey) ?? []).length,
}))
```

- [ ] **Step 2: Create DiffCommentComposer component**

Create `src/renderer/src/components/diff/DiffCommentComposer.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { Button } from '../ui/Button'

interface DiffCommentComposerProps {
  onSubmit: (body: string) => void
  onCancel: () => void
  initialBody?: string
}

export function DiffCommentComposer({ onSubmit, onCancel, initialBody = '' }: DiffCommentComposerProps) {
  const [body, setBody] = useState(initialBody)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="diff-comment-composer">
      <textarea
        ref={textareaRef}
        className="diff-comment-composer__input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Leave a comment... (Cmd+Enter to submit)"
        rows={3}
      />
      <div className="diff-comment-composer__actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!body.trim()}>
          Add review comment
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add composer CSS to diff.css**

Append to `src/renderer/src/assets/diff.css`:

```css
/* -- Comment Composer -- */
.diff-comment-composer {
  margin: 4px 0 4px 96px;
  border: 1px solid var(--bde-accent);
  border-radius: var(--bde-radius-md);
  background: var(--bde-bg);
  overflow: hidden;
}

.diff-comment-composer__input {
  width: 100%;
  padding: 8px 12px;
  font-family: var(--bde-font-code);
  font-size: var(--bde-size-sm);
  color: var(--bde-text);
  background: var(--bde-surface);
  border: none;
  resize: vertical;
  min-height: 60px;
  outline: none;
}

.diff-comment-composer__input::placeholder {
  color: var(--bde-text-dim);
}

.diff-comment-composer__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--bde-border);
}

/* -- Pending comment badge -- */
.diff-comment-widget--pending {
  border-color: var(--bde-warning);
}

.diff-comment-widget__pending-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--bde-warning);
  background: color-mix(in srgb, var(--bde-warning) 15%, transparent);
  padding: 0 6px;
  border-radius: 9999px;
  margin-left: auto;
}
```

- [ ] **Step 4: Add createReview and replyToComment to github-api.ts**

Add to `src/renderer/src/lib/github-api.ts`:

```typescript
export interface CreateReviewBody {
  body?: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments?: Array<{
    path: string
    line: number
    side: 'RIGHT' | 'LEFT'
    start_line?: number
    start_side?: 'RIGHT' | 'LEFT'
    body: string
  }>
}

export async function createReview(
  owner: string,
  repo: string,
  number: number,
  review: CreateReviewBody
): Promise<void> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review)
  })
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(`Review failed: ${res.status} — ${err.message ?? 'unknown'}`)
  }
}

export async function replyToComment(
  owner: string,
  repo: string,
  number: number,
  commentId: number,
  body: string
): Promise<PrComment> {
  const res = await githubFetchRaw(
    `/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    }
  )
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(`Reply failed: ${res.status} — ${err.message ?? 'unknown'}`)
  }
  return res.body as PrComment
}
```

- [ ] **Step 5: Wire composer + pending comments into DiffViewer**

In `DiffViewer.tsx`, extend props to include pending comments:

```tsx
import { DiffCommentComposer } from './DiffCommentComposer'
import type { PendingComment } from '../../stores/pendingReview'

interface DiffViewerProps {
  files: DiffFile[]
  comments?: PrComment[]
  pendingComments?: PendingComment[]
  selectedRange?: LineRange | null
  onSelectRange?: (range: LineRange | null) => void
  onCommentTrigger?: (range: LineRange) => void
  onAddComment?: (range: LineRange, body: string) => void
  onRemovePendingComment?: (commentId: string) => void
}
```

Add state for active composer:
```tsx
const [composerRange, setComposerRange] = useState<LineRange | null>(null)
```

When user clicks the "+" trigger, open composer instead of calling `onCommentTrigger`:
```tsx
onClick={(e) => {
  e.stopPropagation()
  setComposerRange(selectedRange)
}}
```

Render composer at the anchor line (after the last selected line):
```tsx
{composerRange && composerRange.file === file.path &&
  line.lineNo.new === composerRange.endLine && (
  <DiffCommentComposer
    onSubmit={(body) => {
      onAddComment?.(composerRange, body)
      setComposerRange(null)
      onSelectRange?.(null)
    }}
    onCancel={() => {
      setComposerRange(null)
      onSelectRange?.(null)
    }}
  />
)}
```

Render pending comments with a "Pending" badge by building a pending-by-position map similar to commentsByPosition:
```tsx
const pendingByPosition = useMemo(() => {
  const map = new Map<string, PendingComment[]>()
  for (const c of (pendingComments ?? [])) {
    const key = `${c.path}:${c.line}`
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  return map
}, [pendingComments])
```

After each line, check for pending comments and render with `diff-comment-widget--pending` class.

- [ ] **Step 6: Wire pending store in PRStationDiff**

In `PRStationDiff.tsx`:

```tsx
import { usePendingReviewStore } from '../../stores/pendingReview'
import type { PendingComment } from '../../stores/pendingReview'
import type { LineRange } from '../diff/DiffViewer'
```

In component:
```tsx
const prKey = `${pr.repo}#${pr.number}`
const pendingComments = usePendingReviewStore(
  (s) => s.pendingComments.get(prKey) ?? []
)
const addComment = usePendingReviewStore((s) => s.addComment)
const removeComment = usePendingReviewStore((s) => s.removeComment)

const handleAddComment = (range: LineRange, body: string) => {
  addComment(prKey, {
    id: crypto.randomUUID(),
    path: range.file,
    line: range.endLine,
    side: range.side,
    startLine: range.startLine !== range.endLine ? range.startLine : undefined,
    startSide: range.startLine !== range.endLine ? range.side : undefined,
    body,
  })
}
```

Pass to DiffViewer:
```tsx
<DiffViewer
  files={files}
  comments={comments}
  pendingComments={pendingComments}
  selectedRange={selectedRange}
  onSelectRange={setSelectedRange}
  onAddComment={handleAddComment}
  onRemovePendingComment={(id) => removeComment(prKey, id)}
/>
```

- [ ] **Step 7: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/stores/pendingReview.ts \
  src/renderer/src/components/diff/DiffCommentComposer.tsx \
  src/renderer/src/components/diff/DiffViewer.tsx \
  src/renderer/src/components/pr-station/PRStationDiff.tsx \
  src/renderer/src/lib/github-api.ts \
  src/renderer/src/assets/diff.css
git commit -m "feat(pr-station): add inline comment composer and pending review store"
```

---

## Task 6: Batch Review Submission

**Files:**
- Create: `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx`
- Modify: `src/renderer/src/views/PRStationView.tsx` (review banner + dialog)
- Modify: `src/renderer/src/assets/pr-station.css` (banner + dialog styles)

- [ ] **Step 1: Create ReviewSubmitDialog component**

Create `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { createReview, type CreateReviewBody } from '../../lib/github-api'
import { usePendingReviewStore } from '../../stores/pendingReview'
import { toast } from '../../stores/toasts'
import { REPO_OPTIONS } from '../../lib/constants'
import type { OpenPr } from '../../../../shared/types'

interface ReviewSubmitDialogProps {
  pr: OpenPr
  prKey: string
  onClose: () => void
  onSubmitted: () => void
}

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

export function ReviewSubmitDialog({ pr, prKey, onClose, onSubmitted }: ReviewSubmitDialogProps) {
  const [body, setBody] = useState('')
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [submitting, setSubmitting] = useState(false)
  const pendingComments = usePendingReviewStore((s) => s.pendingComments.get(prKey) ?? [])
  const clearPending = usePendingReviewStore((s) => s.clearPending)

  const repo = REPO_OPTIONS.find((r) => r.label === pr.repo)

  const handleSubmit = async () => {
    if (!repo) return
    setSubmitting(true)
    try {
      const review: CreateReviewBody = {
        event,
        body: body.trim() || undefined,
        comments: pendingComments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          ...(c.startLine ? { start_line: c.startLine } : {}),
          ...(c.startSide ? { start_side: c.startSide } : {}),
          body: c.body,
        })),
      }
      await createReview(repo.owner, repo.label, pr.number, review)
      clearPending(prKey)
      toast.success('Review submitted')
      onSubmitted()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  const eventOptions: { value: ReviewEvent; label: string; description: string }[] = [
    { value: 'COMMENT', label: 'Comment', description: 'Submit general feedback without approval' },
    { value: 'APPROVE', label: 'Approve', description: 'Approve this pull request' },
    { value: 'REQUEST_CHANGES', label: 'Request changes', description: 'Submit feedback that must be addressed' },
  ]

  return (
    <div className="review-dialog-backdrop" onClick={onClose}>
      <div className="review-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="review-dialog__title">Submit Review</h3>

        <textarea
          className="review-dialog__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave an overall comment (optional)"
          rows={4}
        />

        <div className="review-dialog__events">
          {eventOptions.map((opt) => (
            <label key={opt.value} className="review-dialog__event">
              <input
                type="radio"
                name="review-event"
                value={opt.value}
                checked={event === opt.value}
                onChange={() => setEvent(opt.value)}
              />
              <div>
                <span className="review-dialog__event-label">{opt.label}</span>
                <span className="review-dialog__event-desc">{opt.description}</span>
              </div>
            </label>
          ))}
        </div>

        {pendingComments.length > 0 && (
          <div className="review-dialog__pending-count">
            {pendingComments.length} pending comment{pendingComments.length > 1 ? 's' : ''} will be included
          </div>
        )}

        <div className="review-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={submitting}>
            Submit review
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add review dialog + banner CSS to pr-station.css**

Append to end of `pr-station.css`:

```css
/* -- Review Banner -- */
.pr-review-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: color-mix(in srgb, var(--bde-accent) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--bde-accent) 25%, transparent);
  font-size: var(--bde-size-sm);
  color: var(--bde-text);
}

.pr-review-banner__count {
  font-weight: 600;
  color: var(--bde-accent);
}

.pr-review-banner__submit {
  margin-left: auto;
}

/* -- Review Submit Dialog -- */
.review-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.review-dialog {
  background: var(--bde-bg);
  border: 1px solid var(--bde-border);
  border-radius: var(--bde-radius-md);
  padding: 20px 24px;
  width: 480px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.review-dialog__title {
  font-size: var(--bde-size-lg);
  font-weight: 600;
  color: var(--bde-text);
  margin: 0;
}

.review-dialog__body {
  width: 100%;
  padding: 8px 12px;
  font-family: inherit;
  font-size: var(--bde-size-sm);
  color: var(--bde-text);
  background: var(--bde-surface);
  border: 1px solid var(--bde-border);
  border-radius: var(--bde-radius-sm);
  resize: vertical;
  outline: none;
}

.review-dialog__body:focus {
  border-color: var(--bde-accent);
}

.review-dialog__events {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-dialog__event {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--bde-radius-sm);
  cursor: pointer;
  transition: background var(--bde-transition-fast);
}

.review-dialog__event:hover {
  background: var(--bde-surface);
}

.review-dialog__event input[type="radio"] {
  margin-top: 2px;
  accent-color: var(--bde-accent);
}

.review-dialog__event-label {
  display: block;
  font-size: var(--bde-size-sm);
  font-weight: 600;
  color: var(--bde-text);
}

.review-dialog__event-desc {
  display: block;
  font-size: var(--bde-size-xs);
  color: var(--bde-text-muted);
}

.review-dialog__pending-count {
  font-size: var(--bde-size-sm);
  color: var(--bde-text-muted);
  padding: 6px 10px;
  background: var(--bde-surface);
  border-radius: var(--bde-radius-sm);
}

.review-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 3: Wire review banner and dialog into PRStationView**

In `src/renderer/src/views/PRStationView.tsx`:

Add imports:
```tsx
import { usePendingReviewStore } from '../stores/pendingReview'
import { ReviewSubmitDialog } from '../components/pr-station/ReviewSubmitDialog'
import { Button } from '../components/ui/Button'
```

Add state and derived values:
```tsx
const [showReviewDialog, setShowReviewDialog] = useState(false)
const prKey = selectedPr ? `${selectedPr.repo}#${selectedPr.number}` : ''
const pendingCount = usePendingReviewStore((s) =>
  prKey ? (s.pendingComments.get(prKey) ?? []).length : 0
)
```

Add review banner inside the detail panel, between the tabs and the tab content:
```tsx
{pendingCount > 0 && (
  <div className="pr-review-banner">
    <span className="pr-review-banner__count">{pendingCount}</span>
    <span>pending comment{pendingCount > 1 ? 's' : ''}</span>
    <Button
      className="pr-review-banner__submit"
      variant="primary"
      size="sm"
      onClick={() => setShowReviewDialog(true)}
    >
      Submit Review
    </Button>
  </div>
)}
```

Add dialog render at the end (before closing `</div>` of the root):
```tsx
{showReviewDialog && selectedPr && (
  <ReviewSubmitDialog
    pr={selectedPr}
    prKey={prKey}
    onClose={() => setShowReviewDialog(false)}
    onSubmitted={() => {
      const pr = selectedPr
      setSelectedPr(null)
      setTimeout(() => setSelectedPr(pr), 0)
    }}
  />
)}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS (ignore pre-existing test failures noted in CLAUDE.md)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx \
  src/renderer/src/views/PRStationView.tsx \
  src/renderer/src/assets/pr-station.css
git commit -m "feat(pr-station): add batch review submission with pending comment banner"
```

---

## Dependency Graph

```
Task 1 (bugs/polish) — independent, no shared file conflicts
  |
Task 2 (reviews display) — builds on Task 1's PRStationDetail changes
  |
Task 3 (comment threads) — builds on Task 2's fetchAll pattern in PRStationDetail
  |
Task 4 (diff enhancement) — needs PrComment type from Task 3
  |
Task 5 (inline commenting) — needs selection from Task 4 + pending store
  |
Task 6 (batch review) — needs pending store from Task 5
```

Tasks 1 and 2 could potentially run in parallel (touch different parts of PRStationDetail), but Tasks 2-6 form a sequential chain.

## Final Verification

After all tasks are complete:

```bash
npm run typecheck && npm test && npm run build
```

All three must pass before the PR is opened.
