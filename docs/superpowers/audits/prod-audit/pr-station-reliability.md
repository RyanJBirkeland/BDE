# PR Station -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 37 files (20 source + 17 tests) in PR Station feature
**Persona:** Reliability Engineer -- data loss, crashes, silent failures

---

## Cross-Reference with Synthesis Final Report

### Previously Reported -- Now Fixed

| Synthesis ID | Issue                                  | Status                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-3        | `github:fetch` IPC is an open proxy    | **Fixed.** `git-handlers.ts:31-48` now has an endpoint/method allowlist with regex patterns. DELETE and admin endpoints are blocked.                                                                                                                                                                                                   |
| ARCH-3       | Hardcoded `REPO_OPTIONS` in PR Station | **Partially fixed.** `useRepoOptions()` hook created at `src/renderer/src/hooks/useRepoOptions.ts` loads repos dynamically from settings via IPC, falling back to `REPO_OPTIONS`. All 7 PR Station components now use this hook. However, the fallback still uses the hardcoded constant during the async load window (see PR-REL-01). |

### Previously Reported -- Still Open

| Synthesis ID                      | Issue                                             | Status                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-2                              | Virtualized diff silently disables all commenting | **Still open.** `DiffViewer.tsx:444`: `useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments`. When virtualized mode activates, `VirtualizedDiffContent` renders no comment widgets, no selection handlers, no pending comments. No user-facing indicator. See PR-REL-06 for expanded analysis.                                                              |
| UX-4                              | Duplicate merge controls with divergent behavior  | **Still open per synthesis.** However, within the audited scope, only `MergeButton.tsx` and `CloseButton.tsx` exist as action components in `PRStationDetail`. The synthesis references `PRStationActions.tsx` which is not in the current file list -- it may have been removed or renamed. The remaining `MergeButton` has no confirmation dialog before merge (see PR-REL-05). |
| code-review-ax 2.2                | `getPrMergeability` abort signal unused           | **Still open.** `github-api.ts:65`: parameter `_signal?: AbortSignal` is accepted but never wired to the fetch call. See PR-REL-02.                                                                                                                                                                                                                                               |
| code-review-ax 3.4 / Quick Win 13 | Cache not invalidated after mutations             | **Partially fixed.** `MergeButton`, `CloseButton`, and `ReviewSubmitDialog` all call `invalidatePRCache()` after their respective mutations. However, `PRStationDetail` still uses cached data and has no mechanism to detect that another component invalidated the cache and refetch. See PR-REL-03.                                                                            |

---

## Findings

### Critical

None found.

### Significant

#### PR-REL-01: Race condition between repo settings load and initial API calls

**File:** `src/renderer/src/hooks/useRepoOptions.ts:24-42`
**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:85`

**Evidence:** `useRepoOptions()` initializes with `REPO_OPTIONS` (hardcoded 3 repos) synchronously, then asynchronously loads from settings. Components like `PRStationDetail` fire API calls in their `useEffect` on mount using whatever `repoOptions` is current. If the user has configured repos with different names/owners than the hardcoded fallback, the initial render cycle fires API calls with wrong owner/label pairs. When the async settings load completes and `repoOptions` updates, the effect re-runs -- but the first batch of API calls may have already errored or returned wrong data, and those errors may flash briefly in the UI.

More critically, if a user's repo is not in the hardcoded fallback at all, the `repoOptions.find((r) => r.label === pr.repo)` call at `PRStationDetail.tsx:85` returns `undefined`, causing `fetchAll()` to silently return without loading any data. The component stays in loading state until the async settings arrive.

**Fix:** Return an empty array from `useRepoOptions()` while settings are loading (add a `loaded` flag), and show a distinct loading state in dependent components. Alternatively, preload repo settings before rendering PR Station.

---

#### PR-REL-02: Abort signal parameter accepted but never used in `getPrMergeability`

**File:** `src/renderer/src/lib/github-api.ts:61-76`

**Evidence:**

```typescript
export async function getPrMergeability(
  owner: string,
  repo: string,
  prNumber: number,
  _signal?: AbortSignal  // <-- underscore prefix = intentionally unused
): Promise<PrMergeability> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  // signal never passed to githubFetchRaw
```

The `_signal` parameter is never forwarded. Any caller passing an AbortSignal (e.g., during rapid PR switching) cannot cancel the in-flight request. This causes stale mergeability data to overwrite fresher data if the user switches PRs quickly. The `githubFetchRaw` function calls `window.api.github.fetch` (IPC), which itself calls `githubFetch` in main process with a hardcoded 30s timeout (`git-handlers.ts:96`) -- there is no abort signal plumbing in the IPC layer either.

**Impact:** Stale mergeability display. The merge button could show "mergeable" for a previously-selected PR after switching to a different one.

**Fix:** Either remove the parameter to avoid false confidence, or wire abort support through the IPC layer. For immediate mitigation, the caller should gate state updates on the current PR identity (which `PRStationDetail` already does via `controller.signal.aborted` checks -- but mergeability fetches happen separately outside this pattern).

---

#### PR-REL-03: Cache invalidation does not trigger refetch in consuming components

**File:** `src/renderer/src/lib/github-cache.ts:61-81`
**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:81-145`

**Evidence:** After a merge, `MergeButton` calls `invalidatePRCache()` which clears cache entries. But `PRStationDetail`'s `useEffect` only re-runs when `[pr.repo, pr.number, repoOptions]` changes. Since the PR identity hasn't changed (the user is still viewing the same PR), the effect does not re-run, and the detail panel continues showing pre-merge data (the PR appears open, checks show old status, etc.). The user must manually click a different PR and back, or wait for the polling cycle to update the PR list.

The `onMerged` callback in `PRStationDetail` is only called by `MergeButton.tsx:59` and `CloseButton`, but the parent's `onMerged` handler (not in scope) may or may not trigger a re-render with updated data.

**Impact:** After merge/close/review submission, the detail panel shows stale data. The user may attempt to merge again, resulting in a confusing error.

**Fix:** Add a `refreshKey` counter that `MergeButton`/`CloseButton`/`ReviewSubmitDialog` increment after mutations, and include it in the `useEffect` dependency array. Alternatively, have `onMerged` remove the PR from the list immediately.

---

#### PR-REL-04: Pending review comments lost on 500ms debounce window crash/close

**File:** `src/renderer/src/stores/pendingReview.ts:76-88`

**Evidence:** The localStorage persistence is debounced by 500ms:

```typescript
usePendingReviewStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pendingComments))
    } catch {
      // Storage quota exceeded or unavailable -- ignore
    }
  }, 500)
})
```

If the user adds a comment and the app crashes (Electron crash, `window.close()`, or power loss) within 500ms, the last comment is lost. There is no `beforeunload` flush handler. The synthesis report explicitly calls this out as a Sprint 4 action item ("Add `beforeunload` flush for pending review localStorage").

Additionally, the `restoreFromStorage()` method is defined but there is no evidence it is called on app init within the audited scope. If it is not called, pending comments from a previous session are silently lost.

**Impact:** Data loss of pending review comments on crash or rapid close.

**Fix:** Add `window.addEventListener('beforeunload', () => { clearTimeout(persistTimer); localStorage.setItem(...) })` to flush immediately on close. Verify `restoreFromStorage()` is called during app initialization.

---

#### PR-REL-05: Merge operation has no confirmation dialog

**File:** `src/renderer/src/components/pr-station/MergeButton.tsx:51-65`

**Evidence:** Clicking the merge button immediately calls `mergePR()` with no confirmation step:

```typescript
async function handleMerge() {
    const repo = repoOptions.find((r) => r.label === pr.repo)
    if (!repo) return
    setMerging(true)
    try {
      await mergePR(repo.owner, repo.label, pr.number, method)
```

This is a destructive, irreversible operation. A single accidental click merges the PR. The `CloseButton` has the same issue -- no confirmation before closing a PR.

**Impact:** Accidental merges or PR closures. Particularly risky because the merge button is adjacent to the strategy dropdown trigger, increasing misclick probability.

**Fix:** Add a confirmation step using the app's existing `useConfirm()` hook and `ConfirmModal` component before executing the merge or close API call.

---

#### PR-REL-06: Virtualized diff mode silently disables all commenting features

**File:** `src/renderer/src/components/diff/DiffViewer.tsx:444`

**Evidence:**

```typescript
const useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments
```

When `totalLines > 500` and there are no existing comments, the `VirtualizedDiffContent` component renders. This component (lines 94-211) has **none** of the commenting infrastructure: no `DiffCommentWidget`, no `DiffCommentComposer`, no pending comment rendering, no line selection handlers, no `onMouseDown`/`onMouseEnter` for range selection. The entire review workflow is silently disabled.

The threshold is 500 lines, which is not particularly large -- many real PRs exceed this. The user sees the diff but cannot interact with it for review purposes, with no indication of why.

**Impact:** Users cannot add review comments on larger diffs. Pending comments added in non-virtualized mode become invisible if the diff later switches to virtualized mode (e.g., after navigating away and back with the comments cache expired).

**Fix:** Either implement commenting in the virtualized renderer, or display a clear banner (e.g., "Commenting is disabled for large diffs. Click to load full diff with commenting.") with a toggle to force non-virtualized mode.

---

### Moderate

#### PR-REL-07: `fetchAllPages` has no pagination depth limit

**File:** `src/renderer/src/lib/github-api.ts:13-28`

**Evidence:**

```typescript
async function fetchAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  let res = await githubFetchRaw(path)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  items.push(...(res.body as T[]))
  let nextUrl = res.linkNext
  while (nextUrl) {
    res = await githubFetchRaw(nextUrl)
    // ...
    nextUrl = res.linkNext
  }
  return items
}
```

There is no upper bound on pagination depth. A repo with thousands of open PRs, or a PR with thousands of review comments, causes unbounded sequential HTTP requests. Each request goes through IPC, so this blocks the renderer. GitHub API returns 100 items per page max, so 10,000 review comments = 100 sequential IPC calls.

The main-process `pr-poller.ts` has the same pattern via `fetchAllGitHubPages` but is less impactful since it runs in the background.

**Impact:** UI freeze on repos with very large PR or comment counts. Memory pressure from accumulating large arrays.

**Fix:** Add a `MAX_PAGES` constant (e.g., 10 = 1000 items) and break with a warning when exceeded.

---

#### PR-REL-08: PR poller has no error recovery or backoff

**File:** `src/main/pr-poller.ts:96-103`

**Evidence:**

```typescript
function safePoll(): void {
  poll().catch((err) => console.error('[pr-poller] poll error:', err))
}

export function startPrPoller(): void {
  safePoll()
  timer = setInterval(safePoll, POLL_INTERVAL_MS)
}
```

The poller runs every 60s regardless of failures. If GitHub is down or rate-limited, it hammers the API every 60s indefinitely. There is no exponential backoff, no circuit breaker, and errors are only logged to console (not to the structured logger). The app has `useBackoffInterval` in the renderer -- the main process poller should have similar backoff logic.

**Impact:** Accelerated rate limit exhaustion during GitHub outages. Console-only logging means errors are invisible to the user and not captured in `bde.log`.

**Fix:** Add exponential backoff on consecutive failures. Use `createLogger('pr-poller')` instead of `console.error`. Consider pausing polling when GitHub returns 403 (rate limit) with a Retry-After header.

---

#### PR-REL-09: `PRStationDetail` `useEffect` dependency on `repoOptions` causes unnecessary refetches

**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:81-145`

**Evidence:** The `useEffect` has `[pr.repo, pr.number, repoOptions]` as dependencies. The `useRepoOptions()` hook returns a new array reference on every render after the async settings load, because `toRepoOptions()` creates new objects via `.map()`. This means the effect re-runs every time the component re-renders after the initial settings load completes, triggering duplicate API calls.

Specifically: mount -> effect runs with fallback REPO_OPTIONS -> settings load completes -> `setRepos(toRepoOptions(...))` -> new array ref -> effect re-runs -> all 5 API calls fire again.

**Impact:** Doubled API calls on every PR selection (once with fallback, once with loaded settings). Wasted bandwidth and potential rate limit pressure.

**Fix:** Memoize the `repoOptions` result in `useRepoOptions()` with `useMemo`, or use a stable reference (e.g., store in a ref and only update when the content actually changes). Alternatively, derive the `repo` config object outside the effect and use it as a dependency instead of the full array.

---

#### PR-REL-10: `PRStationDiff` review comments fetch is fire-and-forget inside a `.then()` chain

**File:** `src/renderer/src/components/pr-station/PRStationDiff.tsx:78-85`

**Evidence:**

```typescript
getPRDiff(repoOption.owner, repoOption.label, pr.number)
  .then((raw) => {
    if (cancelled) return
    rawRef.current = raw
    // Fetch review comments in parallel
    getReviewComments(repoOption.owner, repoOption.label, pr.number)
      .then((c) => {
        if (!cancelled) setComments(c)
      })
      .catch(() => {
        if (!cancelled) setComments([])
      })
```

The review comments fetch is launched inside the diff's `.then()` handler as a nested, untracked promise. If the component unmounts between the diff completing and the comments fetch completing, the `cancelled` flag prevents state updates -- but the HTTP request still completes. More importantly, this fetch is not gated by the `abortRef` controller, so aborting the diff parse does not abort the comments fetch.

Also, this uses `getReviewComments` (uncached) rather than `cachedGetReviewComments`, meaning every PR view triggers a fresh API call for comments even if they were just fetched.

**Impact:** Unnecessary API calls. Potential for stale comment data if the user rapidly switches between PRs.

**Fix:** Use `cachedGetReviewComments` for consistency with `PRStationDetail`. Launch comments fetch with `Promise.allSettled` alongside the diff fetch rather than nesting it.

---

#### PR-REL-11: `DiffViewer` keyboard handler leaks across views

**File:** `src/renderer/src/components/diff/DiffViewer.tsx:607-653`

**Evidence:**

```typescript
useEffect(() => {
    if (activeView !== 'pr-station') return
    if (files.length === 0) return
    const handler = (e: KeyboardEvent): void => {
      // ...
      if (e.key === ']') { ... }
      if (e.key === '[') { ... }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { ... }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, files, ...])
```

The keyboard handler is added to `window` and only guards against `activeView !== 'pr-station'`. But `DiffViewer` could be used in other contexts (it's a generic component in `components/diff/`). If another view mounts `DiffViewer`, the `activeView` check would prevent the handler from working there. However, if PR Station is in a panel that's backgrounded (not the active view) but still mounted, and `activeView` changes to something else, the cleanup fires -- this is correct. The real issue is that `]`, `[`, `ArrowDown`, and `ArrowUp` are intercepted without checking if the diff container has focus, so they fire globally when typing in other input elements (the `tag` guard covers `INPUT`/`TEXTAREA` but not `contentEditable` elements or custom components).

**Impact:** Keyboard shortcuts for diff navigation fire when user interacts with contentEditable elements in the same view.

**Fix:** Add `contentEditable` check: `if ((e.target as HTMLElement).isContentEditable) return`.

---

#### PR-REL-12: `VirtualizedDiffContent` ResizeObserver cleanup references potentially stale element

**File:** `src/renderer/src/components/diff/DiffViewer.tsx:112-127`

**Evidence:**

```typescript
useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    const observer = new ResizeObserver((entries) => { ... })
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
```

The effect runs once with empty deps. If `containerRef.current` changes (e.g., due to conditional rendering toggling between virtualized/plain mode), the observer and scroll listener remain attached to the old element while the new element has none. The `eslint-disable` comment acknowledges this but dismisses it. In practice, `containerRef` is defined in the parent `DiffViewer` and shared, so if the parent re-renders and changes modes, the old `VirtualizedDiffContent` unmounts and cleanup runs -- this is likely safe. However, the `scrollTop` and `viewportHeight` state resets to defaults (0 and 800) on remount, causing a flash of incorrectly positioned content.

**Impact:** Minor visual glitch on mode transitions. Low severity in isolation.

**Fix:** Initialize `viewportHeight` from `containerRef.current?.clientHeight ?? 800` to avoid the default-800 flash.

---

### Minor

#### PR-REL-13: No test file for `CloseButton` component

**File:** `src/renderer/src/components/pr-station/CloseButton.tsx`

**Evidence:** No `CloseButton.test.tsx` exists in the `__tests__` directory. The `CloseButton` component handles a destructive operation (closing a PR) and has error handling paths, none of which are tested. The `MergeButton` has comprehensive tests, creating an asymmetry.

**Fix:** Add `CloseButton.test.tsx` covering: successful close, error handling, disabled state when `pr.merged === true`, cache invalidation.

---

#### PR-REL-14: `pendingReview` store `restoreFromStorage` is not tested for malformed data resilience

**File:** `src/renderer/src/stores/pendingReview.ts:62-73`
**File:** `src/renderer/src/stores/__tests__/pendingReview.test.ts`

**Evidence:** The `restoreFromStorage` method has a `try/catch` for corrupt JSON and validates the parsed result is a non-array object. But the test file has no tests for `restoreFromStorage` at all. Edge cases not covered: valid JSON but wrong shape (e.g., `{ "pr-1": "not-an-array" }`), extremely large stored data, `localStorage.getItem` throwing.

**Fix:** Add tests for `restoreFromStorage` with corrupt JSON, wrong-shape data, empty string, and null.

---

#### PR-REL-15: `github-cache` LRU eviction only removes one entry per `set()` call

**File:** `src/renderer/src/lib/github-cache.ts:40-56`

**Evidence:**

```typescript
function set(key: string, data: unknown, ttl: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null
    // ...find single oldest entry...
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, { data, expiry: now + ttl, lastAccessed: now })
}
```

Only one entry is evicted per `set()`, which means the cache can only grow to `MAX_CACHE_ENTRIES + 1` then stabilize. This is fine for the current use case. However, the eviction scan is O(n) over the full map on every insertion when at capacity, which is inefficient at `MAX_CACHE_ENTRIES = 200`. Not a real problem at 200 entries, but worth noting.

**Impact:** Negligible. The linear scan at 200 entries takes microseconds.

**Fix:** No action needed at current scale. If `MAX_CACHE_ENTRIES` increases significantly, switch to a proper LRU with O(1) eviction.

---

#### PR-REL-16: PR poller swallows individual repo fetch errors silently

**File:** `src/main/pr-poller.ts:19-28`

**Evidence:**

```typescript
async function fetchOpenPrs(owner: string, repo: string, token: string): Promise<OpenPr[]> {
  try {
    // ...
  } catch {
    return []
  }
}
```

If one repo's fetch fails (e.g., repo deleted, permissions changed), it silently returns an empty array. The user sees that repo's PRs disappear from the list with no indication of why. The error is not logged.

**Impact:** Silent data loss -- a repo's PRs vanish from the list without explanation.

**Fix:** Log the error with `createLogger('pr-poller')`. Consider returning an error indicator that the UI can surface (e.g., "Failed to fetch PRs for repo X").

---

#### PR-REL-17: `PRStationConflictBanner` useEffect missing cleanup for async operation

**File:** `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx:16-34`

**Evidence:**

```typescript
useEffect(() => {
    if (mergeableState !== 'dirty') {
      setConflictFiles([])
      return
    }
    const repo = repoOptions.find((r) => r.label === pr.repo)
    if (!repo) return
    setLoading(true)
    window.api
      .checkConflictFiles({ ... })
      .then((result) => {
        setConflictFiles(result.files)  // No cancelled check
      })
      .catch(() => {
        setConflictFiles([])  // No cancelled check
      })
      .finally(() => setLoading(false))  // No cancelled check
  }, [pr.repo, pr.number, mergeableState, repoOptions])
```

No cancellation flag or AbortController. If the PR changes while the conflict check is in flight, the result from the old PR may overwrite state for the new PR. The effect re-runs on `[pr.repo, pr.number, mergeableState, repoOptions]`, but there is no cleanup return that sets a `cancelled` flag.

**Impact:** Brief flash of incorrect conflict files when rapidly switching between PRs with conflicts.

**Fix:** Add a `cancelled` flag pattern like `PRStationDetail` uses.

---

#### PR-REL-18: `PRStationDiff` uses non-cached `getReviewComments` while `PRStationDetail` uses cached version

**File:** `src/renderer/src/components/pr-station/PRStationDiff.tsx:2` (imports `getReviewComments`)
**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:14` (imports `cachedGetReviewComments`)

**Evidence:** Both components fetch review comments for the same PR, but `PRStationDiff` imports directly from `github-api.ts` while `PRStationDetail` imports from `github-cache.ts`. This means viewing a PR triggers two separate API calls for the same comments endpoint -- the cached one from Detail and the uncached one from Diff.

**Impact:** Doubled API calls for review comments on every PR view.

**Fix:** Change `PRStationDiff` to use `cachedGetReviewComments` from `github-cache.ts`.

---

## Test Coverage Gaps

| ID        | Gap                                                                         | Impact                                                  |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| PR-REL-13 | `CloseButton` has no test file                                              | Destructive operation untested                          |
| PR-REL-14 | `restoreFromStorage` has zero tests                                         | Data recovery path untested                             |
| TCG-01    | `github-cache.ts` has no test file                                          | Cache TTL, LRU eviction, invalidation patterns untested |
| TCG-02    | `pr-poller.ts` has no test file in scope                                    | Polling lifecycle, error handling, broadcast untested   |
| TCG-03    | No test covers GitHub API rate limit (403 with Retry-After header) handling | Rate limit response path untested                       |
| TCG-04    | No test covers `fetchAllPages` with > 2 pages                               | Deep pagination path untested                           |
| TCG-05    | No test covers concurrent merge attempts (double-click)                     | Race condition path untested                            |
| TCG-06    | `PRStationDiff` test mocks `parseDiffChunked` away entirely                 | Diff parsing integration untested                       |

---

## Summary Table

| ID        | Severity    | Component                        | Issue                                             |
| --------- | ----------- | -------------------------------- | ------------------------------------------------- |
| PR-REL-01 | Significant | useRepoOptions / PRStationDetail | Race between settings load and API calls          |
| PR-REL-02 | Significant | github-api.ts                    | Abort signal accepted but never used              |
| PR-REL-03 | Significant | github-cache / PRStationDetail   | Cache invalidation doesn't trigger refetch        |
| PR-REL-04 | Significant | pendingReview store              | 500ms debounce window data loss on crash          |
| PR-REL-05 | Significant | MergeButton / CloseButton        | No confirmation dialog for destructive operations |
| PR-REL-06 | Significant | DiffViewer                       | Virtualized mode silently disables commenting     |
| PR-REL-07 | Moderate    | github-api.ts                    | No pagination depth limit                         |
| PR-REL-08 | Moderate    | pr-poller.ts                     | No error backoff, console-only logging            |
| PR-REL-09 | Moderate    | PRStationDetail                  | repoOptions ref instability causes double fetch   |
| PR-REL-10 | Moderate    | PRStationDiff                    | Nested fire-and-forget comments fetch             |
| PR-REL-11 | Moderate    | DiffViewer                       | Keyboard handler fires in contentEditable         |
| PR-REL-12 | Moderate    | DiffViewer                       | ResizeObserver default viewport flash             |
| PR-REL-13 | Minor       | CloseButton                      | No test coverage                                  |
| PR-REL-14 | Minor       | pendingReview store              | restoreFromStorage untested                       |
| PR-REL-15 | Minor       | github-cache.ts                  | O(n) LRU eviction scan                            |
| PR-REL-16 | Minor       | pr-poller.ts                     | Silent error swallowing per-repo                  |
| PR-REL-17 | Minor       | PRStationConflictBanner          | Missing async cleanup                             |
| PR-REL-18 | Minor       | PRStationDiff                    | Uses uncached API while Detail uses cached        |

---

## Recommended Priority

1. **PR-REL-05** -- Add merge/close confirmation dialogs (low effort, high impact on data safety)
2. **PR-REL-04** -- Add `beforeunload` flush for pending review store (low effort)
3. **PR-REL-06** -- Surface indicator when virtualized diff disables commenting (medium effort)
4. **PR-REL-03** -- Wire cache invalidation to trigger detail refetch (medium effort)
5. **PR-REL-08** -- Add backoff and structured logging to PR poller (low effort)
6. **PR-REL-18** -- Switch `PRStationDiff` to cached comments fetch (trivial)
7. **PR-REL-09** -- Stabilize `repoOptions` reference to prevent double API calls (low effort)
8. **PR-REL-02** -- Remove or wire the unused abort signal parameter (low effort)
