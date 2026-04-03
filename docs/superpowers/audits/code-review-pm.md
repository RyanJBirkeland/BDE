# Code & Review Domain -- PM Audit

**Scope:** PR Station (view + 11 components), Diff system (4 components), Source Control / Git Tree (view + 5 components), supporting stores (`pendingReview`, `gitTree`), `github-api.ts`.

**Date:** 2026-03-27

---

## 1. Executive Summary

PR Station delivers a surprisingly complete code review workflow: list PRs across repos, view details/CI/reviews/conversation, leave inline diff comments, submit batch reviews (approve/comment/request changes), and merge or close -- all without leaving BDE. Source Control covers basic staging, committing, pushing, and branch switching but falls short of daily-driver git for anything beyond simple workflows. The main risks are: (a) the virtualized diff path silently drops the entire commenting/review capability, (b) no reply-to-comment support despite the API existing, (c) Source Control has no pull, fetch, stash, or conflict resolution -- making it a view-only tool for most real git work, and (d) several error/empty states swallow failures silently or provide no recovery path.

---

## 2. Critical Issues (Broken Workflows)

### 2.1 Virtualized diff disables all commenting features

**Files:** `src/renderer/src/components/diff/DiffViewer.tsx`, lines 444, 667-675

When `totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments`, the component renders `VirtualizedDiffContent` which has **zero** support for:

- Line range selection (no `onMouseDown`/`onMouseEnter` handlers)
- Comment composer rendering
- Pending comment display
- Existing comment widget display

This means any large PR diff silently becomes read-only with no indication to the user that commenting is unavailable. The threshold is not shown. The user has no way to know why the "+" button disappeared.

**Impact:** Users reviewing large PRs (the ones most likely to need comments) cannot leave inline review comments.

### 2.2 Duplicate merge controls with divergent behavior

**Files:** `src/renderer/src/components/pr-station/MergeButton.tsx`, `src/renderer/src/components/pr-station/PRStationActions.tsx`

Two independent merge button implementations exist:

- `MergeButton` (rendered inside `PRStationDetail` at line 212) -- merges immediately on click, no confirmation step.
- `PRStationActions` (rendered alongside `PRStationDetail` at line 191-195 in `PRStationView`) -- has a two-step confirm flow before merging.

Both are visible simultaneously on the Info tab. They maintain **independent** merge strategy state (`useState<MergeMethod>('squash')` in each). A user could select "Rebase" in one dropdown and click "Squash" in the other. The `MergeButton` has no confirmation dialog -- a single click triggers an irreversible merge.

**Impact:** Confusing UX; accidental merges possible via the no-confirm button.

### 2.3 No error state when GitHub API is unreachable

**Files:** `src/renderer/src/components/pr-station/PRStationList.tsx`, lines 80-86

The PR list fetches via `window.api.getPrList()` on mount and subscribes to push events. If the initial fetch fails (GitHub down, no network, auth expired), the promise rejection is **unhandled** -- there's no `.catch()` on line 83. The component stays in the loading skeleton state forever.

Additionally, `refreshPrList()` (line 90) also has no error handling -- a failed refresh silently leaves `loading: true` with stale data.

**Impact:** User sees infinite loading skeletons with no explanation or retry affordance when GitHub is unavailable.

---

## 3. Significant Issues (Confusing Flows, Missing Feedback)

### 3.1 No ability to reply to existing review comments

**Files:** `src/renderer/src/components/diff/DiffCommentWidget.tsx`, `src/renderer/src/lib/github-api.ts` line 252

The `replyToComment` API function exists in `github-api.ts` but is never called anywhere. `DiffCommentWidget` renders existing comment threads as read-only -- there's no reply textarea, no "Reply" button. This is a core review workflow gap: you can read threads but cannot participate in them.

### 3.2 Review submission refreshes by deselecting/reselecting PR

**File:** `src/renderer/src/views/PRStationView.tsx`, lines 213-217

After `ReviewSubmitDialog.onSubmitted`, the parent does:

```tsx
setSelectedPr(null)
setTimeout(() => setSelectedPr(pr), 0)
```

This causes a full unmount/remount of `PRStationDetail`, re-fetching all data from GitHub. The user sees a flash to the "Select a PR" empty state and back. The GitHub API cache (30s TTL) may return stale data that doesn't include the just-submitted review.

### 3.3 Source Control has no pull/fetch capability

**File:** `src/renderer/src/views/GitTreeView.tsx`, `src/renderer/src/stores/gitTree.ts`

The view has Commit and Push buttons but **no Pull or Fetch**. There's no way to:

- Pull remote changes
- Fetch to check for upstream updates
- See ahead/behind count relative to remote
- Rebase on top of remote

This makes the tool insufficient for daily git operations. Users must switch to terminal for the most common git operation (pull before push).

### 3.4 Branch checkout with uncommitted changes -- blocked without stash option

**File:** `src/renderer/src/components/git-tree/BranchSelector.tsx`, lines 28-33, 60-63

When `hasUncommittedChanges` is true, the branch selector is completely disabled with a tooltip "Commit or stash changes before switching branches." However, there's no stash button anywhere in Source Control. The user is told to stash but given no way to do so within the tool.

### 3.5 Push button has no guards or feedback about remote state

**File:** `src/renderer/src/components/git-tree/CommitBox.tsx`, lines 116-143

The Push button:

- Is always enabled regardless of whether there's anything to push
- Shows no indication of ahead/behind status
- Has no loading state while pushing
- Doesn't check if the remote branch exists (first push needs `-u`)
- Doesn't warn about force push scenarios

### 3.6 Pending review comments not visible in PR list

**File:** `src/renderer/src/components/pr-station/PRStationList.tsx`

The PR list rows show CI status, draft status, and time -- but no indicator that the user has pending (unsent) review comments on a PR. The `pendingReview` store is not referenced in the list component at all. A user could forget they started a review.

### 3.7 Changed files list in Info tab doesn't link to diff

**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx`, lines 254-268

The "Changed Files" section shows filenames with add/delete counts, but clicking a file does nothing. There's no way to jump from the file list to that file's diff in the Diff tab. This is a natural user expectation -- click a file, see its changes.

### 3.8 InlineDiffDrawer uses hardcoded `rgba()` colors

**File:** `src/renderer/src/components/git-tree/InlineDiffDrawer.tsx`, lines 27-32

```tsx
function lineBackground(line: string): string {
  if (line.startsWith('+')) return 'rgba(0, 211, 127, 0.07)'
  if (line.startsWith('-')) return 'rgba(255, 77, 77, 0.07)'
```

Per CLAUDE.md CSS theming rules: "Never use hardcoded `rgba()` for overlays." These should use CSS custom properties. This will also break in light theme.

---

## 4. Minor Issues (Polish)

### 4.1 Git Tree view uses inline styles exclusively

**Files:** All files in `src/renderer/src/components/git-tree/` use `tokens.*` inline styles rather than CSS classes. Per CLAUDE.md neon styling convention, Source Control is listed as a view "without neon" but the inline style approach means:

- No hover animations possible (pseudo-classes require CSS)
- `onMouseEnter`/`onMouseLeave` handlers are used as workarounds (e.g., `BranchSelector.tsx` lines 151-161)
- Theming requires touching every component file instead of a single CSS file

### 4.2 Keyboard shortcut discoverability for diff navigation

**File:** `src/renderer/src/components/diff/DiffViewer.tsx`, lines 607-653

The diff viewer has keyboard shortcuts (`[`/`]` for file navigation, arrow keys for hunk navigation) but these are not documented anywhere in the UI. No tooltip, no help overlay, no keyboard shortcut hint.

### 4.3 Empty commit message after push

**File:** `src/renderer/src/stores/gitTree.ts`, line 161

The commit message is cleared after commit (`set({ commitMessage: '' })`), but there's no undo. If the user made a typo in the commit message and committed, there's no amend option.

### 4.4 PR list refresh button uses HTML entity instead of icon

**File:** `src/renderer/src/components/pr-station/PRStationList.tsx`, line 108

The refresh button renders `&#x21bb;` (a Unicode arrow) instead of using a `lucide-react` icon like every other button in the app. Inconsistent with the design system.

### 4.5 Removed PRs key format inconsistency

**File:** `src/renderer/src/views/PRStationView.tsx`

`removedKeys` uses `${pr.repo}-${pr.number}` (line 61) but `prKey` uses `${pr.repo}#${pr.number}` (line 30). Two different key formats for the same PR identity. While they serve different purposes (dismiss tracking vs. pending comments), this is a maintenance hazard.

### 4.6 No loading indicator on commit or push

**File:** `src/renderer/src/stores/gitTree.ts`, lines 156-176

Neither `commit()` nor `push()` sets a loading flag. The buttons remain clickable during the async operation, allowing double-clicks. Commit button doesn't show a spinner. Push has no visual feedback until the toast appears.

### 4.7 Diff `@keyframes bde-spin` defined inline in JSX

**File:** `src/renderer/src/views/GitTreeView.tsx`, lines 304-309

A `<style>` tag with `@keyframes` is injected directly in the component JSX. This creates a new style element on every render and should be in a CSS file.

---

## 5. Feature Gap Analysis (vs. GitHub Web UI)

| Feature                        | GitHub Web               | BDE PR Station                  | Gap                                 |
| ------------------------------ | ------------------------ | ------------------------------- | ----------------------------------- |
| View PR list                   | Yes                      | Yes                             | --                                  |
| Filter by repo                 | Yes (per-repo)           | Yes (chip filter)               | --                                  |
| Filter by author               | Yes                      | **No**                          | Missing                             |
| Filter by label                | Yes                      | **No**                          | Missing                             |
| Filter by review status        | Yes (reviewed, awaiting) | **No**                          | Missing                             |
| Search PRs                     | Yes                      | **No**                          | Missing                             |
| View PR description (markdown) | Yes                      | Yes                             | --                                  |
| View CI checks                 | Yes                      | Yes                             | --                                  |
| Re-run failed CI checks        | Yes                      | **No**                          | Missing                             |
| View merge conflicts           | Yes                      | Yes (banner + file list)        | --                                  |
| Resolve conflicts              | Yes (web editor)         | **No**                          | Missing                             |
| View diff (unified)            | Yes                      | Yes                             | --                                  |
| View diff (side-by-side)       | Yes                      | **No**                          | Missing -- only unified mode        |
| Inline comments on diff        | Yes                      | Partial (broken on large diffs) | Degraded                            |
| Reply to comment threads       | Yes                      | **No**                          | Missing (API exists, unused)        |
| Edit/delete own comments       | Yes                      | **No**                          | Missing                             |
| Resolve conversation threads   | Yes                      | **No**                          | Missing                             |
| Submit batch review            | Yes                      | Yes                             | --                                  |
| Approve/Request changes        | Yes                      | Yes                             | --                                  |
| Merge (squash/merge/rebase)    | Yes                      | Yes                             | --                                  |
| Close PR                       | Yes                      | Yes                             | --                                  |
| View commits list              | Yes                      | **No**                          | Missing                             |
| View individual commit diffs   | Yes                      | **No**                          | Missing                             |
| Request reviewers              | Yes                      | **No**                          | Missing                             |
| Add labels                     | Yes                      | **No**                          | Missing                             |
| Link to issues                 | Yes                      | **No**                          | Missing                             |
| Create PR                      | Yes                      | **No**                          | Missing -- must use terminal/GitHub |
| Draft PR toggle                | Yes                      | **No**                          | Missing                             |

| Feature                    | GitHub Web / Terminal | BDE Source Control     | Gap          |
| -------------------------- | --------------------- | ---------------------- | ------------ |
| View status                | Yes                   | Yes                    | --           |
| Stage/unstage files        | Yes                   | Yes                    | --           |
| View diff                  | Yes                   | Yes (inline drawer)    | --           |
| Commit                     | Yes                   | Yes                    | --           |
| Push                       | Yes                   | Yes (no loading state) | Degraded     |
| Pull / Fetch               | Yes                   | **No**                 | Critical gap |
| Stash / Unstash            | Yes                   | **No**                 | Missing      |
| Branch create              | Yes                   | **No**                 | Missing      |
| Branch delete              | Yes                   | **No**                 | Missing      |
| Merge branches             | Yes                   | **No**                 | Missing      |
| Rebase                     | Yes                   | **No**                 | Missing      |
| Conflict resolution        | Yes                   | **No**                 | Missing      |
| Ahead/behind indicator     | Yes                   | **No**                 | Missing      |
| Commit history / log       | Yes                   | **No**                 | Missing      |
| Amend last commit          | Yes                   | **No**                 | Missing      |
| Discard changes (per file) | Yes                   | **No**                 | Missing      |
| Blame / annotation         | Yes                   | **No**                 | Missing      |

---

## Summary of Priorities

**Must fix before shipping:**

1. Virtualized diff dropping all comment features silently (Critical 2.1)
2. Duplicate merge buttons with different confirmation behavior (Critical 2.2)
3. Missing error handling on PR list fetch failure (Critical 2.3)

**Should fix soon:** 4. Add reply-to-comment capability (Significant 3.1) 5. Add pull/fetch to Source Control (Significant 3.3) 6. Add stash support or remove the "stash" suggestion from tooltip (Significant 3.4) 7. File list -> diff tab navigation (Significant 3.7)

**Nice to have:** 8. PR search/filter by author/label/review status 9. Side-by-side diff mode 10. Create PR from BDE 11. Commit history view 12. Discard changes per file
