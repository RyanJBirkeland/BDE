# PR Station Completion — Design Spec

**Date**: 2026-03-23
**Branch**: `feat/pr-station-completion`
**Goal**: Complete PR Station as a full code review tool — view, review, comment, approve, merge — all from within BDE.

## Current State

PR Station is ~75% complete as a read-only PR monitor with merge/close actions. Working: PR list polling, detail panel (metadata, description, CI checks, changed files), merge/close actions with strategy dropdown, diff viewer with virtualization and keyboard nav.

Gaps: missing tab CSS, dead conflict store, no review/comment display, no inline commenting, no batch review submission.

## Architecture Principles

- All GitHub API calls proxied through main process via `github:fetch` IPC — token never enters renderer
- New API functions added to `src/renderer/src/lib/github-api.ts` following existing pattern
- New types in `src/shared/types.ts`
- New IPC channels NOT needed — everything goes through `github:fetch` proxy
- No new npm dependencies

## Slice 1: Bug Fixes & Polish

### 1a. Missing Tab CSS

Add styles to `src/renderer/src/assets/pr-station.css` for:
- `.pr-station__detail-header` — flex row, sticky top, border-bottom, padding
- `.pr-station__tabs` — flex row, gap
- `.pr-station__tab` — button reset, padding, font, color muted, border-bottom transparent
- `.pr-station__tab--active` — accent color, accent border-bottom

### 1b. Conflict Store Wiring

`usePrConflictsStore` exists but is never populated. Wire it:
- In `PRStationList.tsx` (or a parent), when `pr:listUpdated` delivers the PR list, cross-reference with sprint tasks that have `pr_number` set
- For each PR with `mergeable_state === 'dirty'`, add matching task IDs to the conflict store
- Show conflict badge in PR detail header when the selected PR has `mergeable_state === 'dirty'`

### 1c. Conflict Files Display

When viewing a PR with `mergeable_state === 'dirty'`:
- Call `window.api.checkConflictFiles()` to fetch conflicting file paths
- Display conflict warning banner above the changed files list
- Mark conflicting files with a warning icon in the files list

## Slice 2: Reviews & Approvals Display

### Types (in `src/shared/types.ts`)

```typescript
interface PrReview {
  id: number
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  submitted_at: string
  html_url: string
}
```

### API (in `github-api.ts`)

```typescript
getReviews(owner, repo, number): Promise<PrReview[]>
// GET /repos/{owner}/{repo}/pulls/{number}/reviews
```

### UI

- New section in `PRStationDetail` between CI Checks and Changed Files: **"Reviews"**
- Each review shows: avatar, username, state badge (colored: green=approved, red=changes_requested, gray=commented), body (markdown rendered), timestamp
- Summary badge in PR detail header: "2 approved, 1 changes requested" style condensed text
- Review state determines merge button UX: if any `CHANGES_REQUESTED` is pending, show warning on merge button

## Slice 3: Comment Threads Display

### Types

```typescript
interface PrComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  updated_at: string
  html_url: string
  // For review comments (inline on diff):
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

interface PrIssueComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  html_url: string
}
```

### API

```typescript
getReviewComments(owner, repo, number): Promise<PrComment[]>
// GET /repos/{owner}/{repo}/pulls/{number}/comments?per_page=100

getIssueComments(owner, repo, number): Promise<PrIssueComment[]>
// GET /repos/{owner}/{repo}/issues/{number}/comments?per_page=100
```

### UI — Info Tab

- New **"Conversation"** section in PRStationDetail (below Reviews, above Changed Files)
- Merge issue comments and review comments into a single timeline, sorted by `created_at`
- Review comments grouped by `pull_request_review_id` (show as threaded blocks under their review)
- Each comment: avatar, username, timestamp, markdown body
- Reply threads: comments with `in_reply_to_id` indented under parent
- Collapsible "resolved" threads (review comments associated with dismissed reviews)

### UI — Diff Tab

- Inline review comments displayed in the diff viewer, anchored to the file/line they reference
- Each comment block appears below the referenced line(s) as an expandable comment widget
- Multiple comments on the same line/range grouped into a thread
- Comment count badge per file in the file sidebar

## Slice 4: Diff Enhancement

### Line Selection

Enhance `DiffViewer` to support click-and-drag line range selection on the gutter:

- **Data model**: Add `selectedRange: { file: string; startLine: number; endLine: number; side: 'LEFT' | 'RIGHT' } | null` state to DiffViewer
- **Gutter interaction**:
  - Click on new-line gutter = select single line (RIGHT side)
  - Click on old-line gutter = select single line (LEFT side)
  - Click + drag = select range
  - Shift+click extends selection
  - Selected lines get highlight background (accent color, low opacity)
- **Comment trigger**: When a range is selected, show a "+" button at the top of the selection that opens the comment composer
- Works in both virtualized and plain rendering modes

### Comment Anchoring

- Render inline comment widgets between diff lines
- Comment widget: compact card with avatar, username, timestamp, body, reply button
- Thread collapse/expand for multi-comment threads
- Widget positioned after the last line of the comment's range
- For comments on lines not visible (collapsed hunks), show a "N comments hidden" indicator on the hunk header

### File Sidebar Enhancement

- Add comment count badge per file (e.g., `💬 3`)
- Files with unresolved threads get a dot indicator

## Slice 5: Inline Commenting (Write Path)

### Pending Review State

New Zustand store: `src/renderer/src/stores/pendingReview.ts`

```typescript
interface PendingComment {
  id: string // client-generated UUID
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  body: string
}

interface PendingReviewStore {
  // Keyed by `${repo}#${prNumber}`
  pendingComments: Map<string, PendingComment[]>
  addComment: (prKey: string, comment: PendingComment) => void
  updateComment: (prKey: string, commentId: string, body: string) => void
  removeComment: (prKey: string, commentId: string) => void
  clearPending: (prKey: string) => void
  getPendingCount: (prKey: string) => number
}
```

### Comment Composer

- Appears when user clicks "+" on a selected line range
- Markdown textarea with preview toggle
- "Add review comment" button (adds to pending, doesn't post yet)
- "Cancel" button
- Pending comments rendered in diff with a "Pending" badge (yellow) and edit/delete buttons
- Comment body supports basic markdown

### Reply to Existing Comments

- "Reply" button on existing comment threads opens a mini-composer inline
- Reply comments are also held as pending until review submission

### API

```typescript
createReview(owner, repo, number, body: {
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
}): Promise<void>
// POST /repos/{owner}/{repo}/pulls/{number}/reviews

replyToComment(owner, repo, number, commentId: number, body: string): Promise<PrComment>
// POST /repos/{owner}/{repo}/pulls/{number}/comments/{commentId}/replies
```

## Slice 6: Batch Review Submission

### Review Banner

When pending comments exist, show a persistent banner at the top of the detail panel:
- "You have N pending comments" with a count badge
- "Submit Review" button → opens review submission dialog

### Review Submission Dialog

- Modal/dropdown with:
  - Overall review body (markdown textarea, optional)
  - Action radio buttons: **Comment** (neutral), **Approve**, **Request Changes**
  - Preview of pending comment count
  - "Submit review" button
- On submit:
  1. Collect all pending comments for this PR
  2. Collect all pending replies
  3. Call `createReview()` with comments array + event type
  4. Call `replyToComment()` for each pending reply (these can't be batched in GitHub's API)
  5. Clear pending state
  6. Refresh review/comment data
  7. Show success toast

### Review State Indicator

- In the PR list sidebar, show a badge if the current user has pending comments (local state, not from GitHub)
- In the detail header, show review state: "Your review: Approved" / "Changes requested" / none

## Tab Structure Update

Extend the current two-tab system to three tabs:

- **Info** — Metadata, description, reviews summary, conversation timeline, changed files, actions
- **Diff** — Enhanced diff with inline comments, range selection, comment composer
- **Review** — (new) Focused review view: only pending comments, review submission form, review history

Actually — keep it at two tabs. The Review submission is a banner + dialog overlay on the Diff tab. The Info tab gets the conversation timeline. This avoids fragmenting the UX.

## Data Flow Summary

```
GitHub REST API
  ↕ (via github:fetch IPC proxy)
Main Process
  ↕ (IPC invoke/handle)
Preload Bridge
  ↕ (contextBridge)
Renderer
  ├─ github-api.ts (API functions)
  ├─ PRStationView (tab routing)
  ├─ PRStationDetail (info tab: reviews, comments, files)
  ├─ PRStationDiff → DiffViewer (diff tab: inline comments, selection)
  ├─ pendingReview store (pending comments state)
  └─ ReviewSubmitDialog (batch submit)
```

## Files to Create

- `src/renderer/src/stores/pendingReview.ts` — pending review comment state
- `src/renderer/src/components/pr-station/PRStationReviews.tsx` — reviews section
- `src/renderer/src/components/pr-station/PRStationConversation.tsx` — comment timeline
- `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx` — conflict warning
- `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx` — batch review dialog
- `src/renderer/src/components/diff/DiffCommentWidget.tsx` — inline comment display
- `src/renderer/src/components/diff/DiffCommentComposer.tsx` — inline comment input
- `src/renderer/src/components/diff/DiffLineSelection.tsx` — selection highlight + trigger

## Files to Modify

- `src/renderer/src/assets/pr-station.css` — tab styles, reviews, conversation, conflict banner
- `src/renderer/src/assets/diff.css` — selection highlight, comment widgets, comment composer
- `src/renderer/src/lib/github-api.ts` — new API functions (reviews, comments, create review, reply)
- `src/shared/types.ts` — PrReview, PrComment, PrIssueComment types
- `src/renderer/src/views/PRStationView.tsx` — conflict integration, review banner
- `src/renderer/src/components/pr-station/PRStationDetail.tsx` — reviews section, conversation section
- `src/renderer/src/components/pr-station/PRStationList.tsx` — conflict store population, comment badges
- `src/renderer/src/components/diff/DiffViewer.tsx` — line selection, comment anchoring, comment widgets
- `src/renderer/src/lib/diff-parser.ts` — add line-to-position mapping for comment anchoring

## Testing Strategy

- Unit tests for new API functions (mock `github:fetch`)
- Unit tests for pending review store
- Unit tests for diff line selection logic
- Unit tests for comment threading/grouping logic
- Manual live testing against real GitHub PRs for each slice
- Each slice independently testable: merge after each passes

## Non-Goals

- Syntax highlighting in diff viewer (future enhancement)
- Webhook-based real-time updates (polling is sufficient)
- PR creation from within BDE
- Resolving/unresolving review threads (GitHub API limitation — only available via GraphQL)
