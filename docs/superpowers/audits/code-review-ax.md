# Code & Review Domain -- Architectural Audit

**Auditor:** AX (Architectural Engineer)
**Date:** 2026-03-27
**Scope:** PR Station, Source Control (Git Tree), diff rendering, GitHub API proxy, related stores and CSS

---

## 1. Executive Summary

The Code & Review domain has a well-structured GitHub API proxy layer that correctly keeps tokens out of renderer memory, with a clean IPC boundary in `git-handlers.ts`. However, the domain suffers from a critical hardcoded `REPO_OPTIONS` constant that 7 PR Station components import directly instead of using the dynamic `useRepoOptions()` hook, meaning any user with repos beyond the three hardcoded entries will see broken owner lookups. The PR Station is feature-rich (merge, review, conflict detection, inline comments) but has significant code duplication: `MergeButton` and `PRStationActions` contain nearly identical merge strategy dropdown logic, and the `DiffViewer` component at 703 lines conflates virtualization, keyboard navigation, line selection, comment rendering, and pending comment state into a single file. PR Station and Source Control have clean responsibility separation -- PR Station operates on GitHub remote state while Source Control operates on local git state -- but they use completely different diff rendering approaches with no shared code.

---

## 2. Critical Issues

### 2.1 Hardcoded `REPO_OPTIONS` used for owner/label lookups across PR Station

**Files:**

- `/Users/ryan/projects/BDE/src/renderer/src/lib/constants.ts` (lines 51-55)
- `/Users/ryan/projects/BDE/src/renderer/src/views/PRStationView.tsx` (line 104)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDetail.tsx` (line 83)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDiff.tsx` (line 58)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationActions.tsx` (line 34)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/MergeButton.tsx` (line 50)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationConflictBanner.tsx` (line 21)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx` (line 27)

Every PR Station component does `REPO_OPTIONS.find(r => r.label === pr.repo)` to resolve the `owner` field needed for GitHub API calls. The static constant only contains three repos (BDE, life-os, feast). The `useRepoOptions()` hook exists (`/Users/ryan/projects/BDE/src/renderer/src/hooks/useRepoOptions.ts`) and loads from settings via IPC, but none of the PR Station components use it.

**Impact:** Any user-configured repo beyond the hardcoded three will silently fail all API calls (detail, diff, merge, review, conflict check) because `REPO_OPTIONS.find()` returns `undefined` and every component early-returns on `if (!repo) return`.

**Fix:** Lift `useRepoOptions()` into PRStationView and pass resolved repo config down via props or context, or create a `RepoOptionsContext` provider. Alternatively, the PR poller in main process already has the full repo list -- augment `OpenPr` with `owner` so the renderer never needs to resolve it.

### 2.2 `getPrMergeability` ignores `AbortSignal` parameter

**File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/github-api.ts` (line 65)

```typescript
export async function getPrMergeability(
  owner: string, repo: string, prNumber: number,
  _signal?: AbortSignal  // <-- underscore-prefixed, never used
): Promise<PrMergeability> {
```

The caller in `PRStationView.tsx` (line 107) passes `controller.signal` expecting cancellation, but the function ignores it. The underlying `githubFetchRaw` call (which goes through IPC) cannot be cancelled anyway, but the function should at minimum check `signal.aborted` before resolving state updates. Currently, switching between PRs rapidly will apply stale mergeability results from old requests.

**Impact:** Race condition -- rapid PR selection can display wrong mergeability state.

---

## 3. Significant Issues

### 3.1 Duplicated merge strategy dropdown: `MergeButton` vs `PRStationActions`

**Files:**

- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/MergeButton.tsx` (115 lines)
- `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationActions.tsx` (177 lines)

Both components contain:

- Identical `MERGE_STRATEGIES` array (lines 14-19 in both)
- Identical outside-click dropdown dismissal (useEffect with mousedown listener)
- Identical `handleMerge` function calling `mergePR()` with toast feedback
- Identical `mergeBlocked` / `isMergeable` derivation
- Identical dropdown trigger + listbox pattern

`MergeButton` is rendered inside `PRStationDetail` (line 212), while `PRStationActions` is rendered at the view level in `PRStationView` (line 191). Both appear in the "info" tab simultaneously, creating two independent merge UIs on screen.

**Impact:** User confusion (two merge buttons with possibly different strategy selections), maintenance burden (changes must be synchronized in two files), and double outside-click handlers on the document.

**Fix:** Remove the merge UI from one location (likely `PRStationActions` should delegate to `MergeButton`), or extract a shared `useMergeStrategy` hook.

### 3.2 `DiffViewer` is a 703-line monolith with too many responsibilities

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/diff/DiffViewer.tsx`

This single file contains:

- `FileList` component (sidebar, lines 19-51)
- `VirtualizedDiffContent` component (virtualized renderer, lines 94-211)
- `PlainDiffContent` component (non-virtualized renderer with comments, lines 215-412) -- takes 17 props
- `DiffViewer` main component (keyboard navigation, scroll management, line selection, lines 416-703)

`PlainDiffContent` alone takes 17 props (line 215-253), which is a strong signal the component needs decomposition. The virtualized and plain paths share no rendering code despite producing the same visual output -- the virtualized path drops comment/selection support entirely (line 444: `!hasComments` gates virtualization).

**Impact:** Hard to modify any single behavior without risk of breaking others. Comment rendering is impossible in virtualized mode, which means large diffs with comments silently fall back to the plain renderer.

**Fix:** Extract `FileList`, `VirtualizedDiffContent`, and `PlainDiffContent` into separate files. Create a shared `DiffLine` component used by both renderers. Pass a render context object instead of 17 individual props.

### 3.3 `PRStationDetail` manages too much local state

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDetail.tsx` (lines 68-77)

Eight `useState` calls for data that all derives from a single PR fetch:

```typescript
const [detail, setDetail] = useState<PRDetailData | null>(null)
const [files, setFiles] = useState<PRFile[]>([])
const [checks, setChecks] = useState<CheckRun[]>([])
const [reviews, setReviews] = useState<PrReview[]>([])
const [reviewComments, setReviewComments] = useState<PrComment[]>([])
const [issueComments, setIssueComments] = useState<PrIssueComment[]>([])
const [loading, setLoading] = useState(true)
const [checksLoading, setChecksLoading] = useState(true)
```

This is a classic case for a `useReducer` or a custom `usePRDetail(pr)` hook that encapsulates the parallel fetch + loading states.

**Impact:** Complex state transitions spread across the `fetchAll()` effect, easy to get loading states out of sync (e.g., `reviewsLoading` is set to `false` inside the `try` block at line 121 but never in `catch`/`finally`).

### 3.4 No cache invalidation after mutations

**File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/github-cache.ts`

The cache has an `invalidateCache()` export (line 43), but it is never called anywhere after mutations:

- `mergePR()` in `PRStationActions.tsx` and `MergeButton.tsx` -- does not invalidate detail/mergeability cache
- `createReview()` in `ReviewSubmitDialog.tsx` -- does not invalidate reviews/comments cache
- `closePR()` in `PRStationActions.tsx` -- does not invalidate

After merging a PR, the cached detail still shows it as open for up to 30 seconds.

**Impact:** Stale data displayed after user actions. The `onSubmitted` callback in `ReviewSubmitDialog` (line 214-217) uses a hack (`setSelectedPr(null); setTimeout(() => setSelectedPr(pr), 0)`) to force a re-fetch, but this only works because the component unmounts/remounts -- it doesn't actually clear the cache.

### 3.5 Source Control view uses extensive inline styles instead of CSS classes

**Files:**

- `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx` -- 50+ inline style objects
- `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/BranchSelector.tsx` -- 80+ lines of inline styles
- `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/CommitBox.tsx` -- 40+ lines of inline styles
- `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/FileTreeSection.tsx` -- 30+ lines of inline styles
- `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/GitFileRow.tsx` -- 30+ lines of inline styles
- `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/InlineDiffDrawer.tsx` -- 40+ lines of inline styles

The CLAUDE.md explicitly states: "Do NOT use inline `tokens.*` styles for neon views -- use CSS classes." Source Control is flagged as one of the "remaining views without neon," but the inline style approach using `tokens.*` objects makes it impossible to theme via CSS and creates JSX noise. Per-element `onMouseEnter`/`onMouseLeave` handlers for hover states (e.g., `GitFileRow.tsx` lines 92-101, 144-151) are fragile and could be replaced by CSS `:hover` selectors.

### 3.6 `InlineDiffDrawer` uses hardcoded `rgba()` colors

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/InlineDiffDrawer.tsx` (lines 28-31)

```typescript
function lineBackground(line: string): string {
  if (line.startsWith('+')) return 'rgba(0, 211, 127, 0.07)'
  if (line.startsWith('-')) return 'rgba(255, 77, 77, 0.07)'
  if (line.startsWith('@@')) return 'rgba(59, 130, 246, 0.07)'
  return 'transparent'
}
```

The CLAUDE.md CSS theming rule states: "Never use hardcoded `rgba()` for overlays or `box-shadow`." These should use CSS custom properties like `var(--bde-diff-add-bg)` and `var(--bde-diff-del-bg)`.

---

## 4. Minor Issues

### 4.1 `PRStationDiff` fetches review comments outside the cache layer

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDiff.tsx` (line 77)

```typescript
getReviewComments(repoOption.owner, repoOption.label, pr.number)
```

This calls the uncached `getReviewComments` directly from `github-api.ts`, while `PRStationDetail` uses `cachedGetReviewComments` from `github-cache.ts` (line 102). The same comments are fetched twice for the same PR -- once cached (info tab) and once uncached (diff tab).

### 4.2 `PRStationDiff` nests `.then()` inside `.then()` instead of using `Promise.all`

**File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDiff.tsx` (lines 71-92)

The diff fetch and review comments fetch are sequenced (comments fetch starts inside the `.then()` of diff fetch) despite being independent. Using `Promise.all` would parallelize them.

### 4.3 `getPendingCount` method in `pendingReview` store uses `get()` instead of selector pattern

**File:** `/Users/ryan/projects/BDE/src/renderer/src/stores/pendingReview.ts` (line 60)

```typescript
getPendingCount: (prKey) => (get().pendingComments[prKey] ?? []).length,
```

This is a method on the store that calls `get()` -- it's imperative, not reactive. No component actually uses it (they use selectors like line 31-33 of `PRStationView.tsx`). It's dead code.

### 4.4 Redundant `removedKeys` key format inconsistency

**File:** `/Users/ryan/projects/BDE/src/renderer/src/views/PRStationView.tsx`

The `removedKeys` set uses `${pr.repo}-${pr.number}` format (line 62), while `prKey` uses `${pr.repo}#${pr.number}` format (line 30). This inconsistency is confusing but not buggy since they serve different purposes.

### 4.5 `diff-neon.css` has a hardcoded `rgba()` for selection hover

**File:** `/Users/ryan/projects/BDE/src/renderer/src/assets/diff-neon.css` (line 166)

```css
.diff-line__gutter--selectable:hover {
  background: rgba(0, 255, 200, 0.12);
}
```

Should use `var(--neon-cyan-surface)` or a defined token.

### 4.6 `@keyframes bde-spin` defined inline in JSX

**File:** `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx` (lines 304-309)

A `<style>` tag with `@keyframes bde-spin` is injected into the DOM every render of `GitTreeView`. This should be in a CSS file.

### 4.7 No error boundary around diff rendering

The `DiffViewer` component renders user-controlled content (diff lines from GitHub). A malformed diff could throw during `parseDiffChunked` and crash the entire PR Station view. An error boundary around the diff tab would be prudent.

---

## 5. Architecture Diagram

```
GitHub REST API (api.github.com)
         |
         | HTTPS
         v
+---------------------+     +------------------+
|  Main Process        |     |  pr-poller.ts    |
|  git-handlers.ts     |     |  (60s interval)  |
|                      |     |                  |
|  github:fetch IPC    |     | fetchOpenPrs()   |
|  (token injected     |     | fetchCheckRuns() |
|   server-side)       |     |                  |
|                      |     | broadcast()      |
|  pr:checkConflict    |     | pr:listUpdated   |
|  pr:pollStatuses     |     +--------+---------+
|  pr:getList          |              |
|  pr:refreshList      |              |
|                      |              |
|  git:status          |              |
|  git:diff            |              |
|  git:stage/unstage   |              |
|  git:commit/push     |              |
|  git:branches        |              |
|  git:checkout        |              |
+-----+-------+-------+              |
      |       |                      |
      | IPC   | IPC                  | IPC broadcast
      v       v                      v
+-----+-------+------+    +---------+----------+
|   github-api.ts     |   | PRStationList.tsx   |
|   (renderer proxy)  |   | onPrListUpdated()   |
|                     |   +--------------------+
|  githubFetchRaw()   |
|  fetchAllPages()    |
|  getPRDetail()      |             RENDERER
|  getPRDiff()        |
|  mergePR()          |
|  createReview()     |
|  etc.               |
+--------+------------+
         |
         v
+--------+------------+
|  github-cache.ts    |
|  (30s TTL Map)      |
|                     |
|  cachedGetPRDetail  |
|  cachedGetPRFiles   |
|  cachedGetReviews   |
|  etc.               |
+--------+------------+
         |
         v
+--------+-----------------------+-------------------+
|  PR Station View               |  Source Control    |
|                                |  (GitTreeView)    |
|  PRStationList (IPC push)      |                   |
|  PRStationDetail               |  gitTree store    |
|    +-- PRStationChecks         |    (Zustand)      |
|    +-- PRStationReviews        |                   |
|    +-- PRStationConversation   |  CommitBox        |
|    +-- PRStationConflictBanner |  FileTreeSection  |
|    +-- MergeButton             |  GitFileRow       |
|  PRStationActions              |  BranchSelector   |
|  PRStationDiff                 |  InlineDiffDrawer |
|    +-- DiffViewer              |    (raw text diff)|
|         +-- FileList           |                   |
|         +-- PlainDiffContent   |                   |
|         +-- VirtualizedContent |                   |
|         +-- DiffCommentWidget  |                   |
|         +-- DiffCommentComposer|                   |
|  PRStationFilters              |                   |
|  ReviewSubmitDialog            |                   |
|                                |                   |
|  pendingReview store           |  gitTree store    |
|    (Zustand + localStorage)    |    (Zustand)      |
+--------------------------------+-------------------+

Data Flow Summary:
  PR Station: GitHub API --> IPC proxy --> github-api.ts --> cache --> components
  Source Control: Local git --> IPC (git:*) --> gitTree store --> components
  PR List: pr-poller (main) --> IPC broadcast --> PRStationList subscriber
  PR Reviews: pendingReview store <--> localStorage (debounced 500ms)
```

---

## Summary of Recommendations (prioritized)

| Priority | Issue                                                                  | Effort |
| -------- | ---------------------------------------------------------------------- | ------ |
| P0       | Replace hardcoded `REPO_OPTIONS` with dynamic resolution in PR Station | Medium |
| P0       | Fix `getPrMergeability` abort signal race condition                    | Low    |
| P1       | Deduplicate `MergeButton` / `PRStationActions` merge dropdown          | Medium |
| P1       | Invalidate github-cache after mutations (merge, review, close)         | Low    |
| P1       | Extract `usePRDetail` hook from `PRStationDetail`                      | Medium |
| P1       | Decompose `DiffViewer.tsx` into smaller files                          | High   |
| P2       | Migrate Source Control from inline styles to neon CSS                  | High   |
| P2       | Replace hardcoded rgba() in `InlineDiffDrawer` and `diff-neon.css`     | Low    |
| P3       | Use cached review comments in `PRStationDiff`                          | Low    |
| P3       | Remove dead `getPendingCount` method                                   | Low    |
| P3       | Move `@keyframes bde-spin` to CSS file                                 | Low    |
| P3       | Add error boundary around diff rendering                               | Low    |
