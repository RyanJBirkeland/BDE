# PR Station -- Reliability Engineer Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** PR Station source files, diff components, github-api/cache layer, pendingReview store, pr-poller, git-handlers
**Persona:** Reliability Engineer -- data loss, crashes, silent failures
**Baseline:** `docs/superpowers/audits/prod-audit/pr-station-reliability.md` (18 findings)

---

## Summary of Remediation Status

Of the 18 original findings plus synthesis items, **10 are Fixed**, **3 are Partially Fixed**, **3 are Not Fixed**, and **2 new issues** were identified.

---

## Findings from Previous Audit

### Fixed

| ID        | Issue                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-REL-02 | Abort signal parameter accepted but never used in `getPrMergeability`      | **Fixed.** The `_signal` parameter has been removed entirely. `github-api.ts:64-78` now takes only `(owner, repo, prNumber)` -- no misleading unused parameter.                                                                                                                                                                                                        |
| PR-REL-04 | Pending review comments lost on 500ms debounce window crash/close          | **Fixed.** `pendingReview.ts:114-115` adds `window.addEventListener('beforeunload', flushToStorage)` which calls a synchronous `flushToStorage()` that clears the timer and writes immediately. Additionally, `restoreFromStorage()` is confirmed called on app init at `App.tsx:125-127`.                                                                             |
| PR-REL-05 | Merge/Close operations have no confirmation dialog                         | **Fixed.** Both `MergeButton.tsx:58-65` and `CloseButton.tsx:26-33` now use `useConfirm()` with `ConfirmModal` rendering a danger-variant confirmation dialog before executing the destructive operation. The merge dialog includes the strategy label; the close dialog warns "cannot be undone".                                                                     |
| PR-REL-06 | Virtualized diff mode silently disables all commenting features            | **Fixed.** `DiffViewer.tsx:451-465` adds a `VirtualizedDiffBanner` component that displays "Large diff -- commenting disabled in virtualized mode" with a "Load full diff to enable comments" button. A `forceFullDiff` state (line 491) lets the user toggle to non-virtualized mode. The `useVirtualization` condition at line 496 now includes `&& !forceFullDiff`. |
| PR-REL-07 | `fetchAllPages` has no pagination depth limit                              | **Fixed.** `github-api.ts:15` adds `const MAX_PAGES = 100` and the while loop at line 23 checks `pageCount < MAX_PAGES`. Each iteration increments `pageCount`.                                                                                                                                                                                                        |
| PR-REL-08 | PR poller has no error recovery or backoff                                 | **Fixed.** `pr-poller.ts:10` uses `createLogger('pr-poller')` instead of `console.error`. Lines 20-21 add `errorCount` and `backoffDelay` state. `safePoll()` at lines 101-115 implements exponential backoff (`Math.pow(2, errorCount - 1)`) capped at 5 minutes, resetting on success.                                                                               |
| PR-REL-11 | DiffViewer keyboard handler fires in contentEditable                       | **Fixed.** `DiffViewer.tsx:668` adds `if (target.isContentEditable) return` check in the keyboard handler, before processing `]`, `[`, or arrow keys.                                                                                                                                                                                                                  |
| PR-REL-13 | No test file for `CloseButton` component                                   | **Fixed.** `CloseButton.test.tsx` exists with 6 tests covering: rendering, successful close with confirmation, error handling, callback behavior on failure, disabled state when merged, and cancellation of the confirm dialog.                                                                                                                                       |
| PR-REL-16 | PR poller swallows individual repo fetch errors silently                   | **Fixed.** `pr-poller.ts:31` now logs `logger.warn(...)` with repo name and error message in the catch block of `fetchOpenPrs`.                                                                                                                                                                                                                                        |
| PR-REL-18 | `PRStationDiff` uses uncached `getReviewComments` while Detail uses cached | **Fixed.** `PRStationDiff.tsx:3` imports `cachedGetReviewComments` from `github-cache`, and line 80 calls `cachedGetReviewComments(...)`. Both Detail and Diff now use the cached version.                                                                                                                                                                             |

### Partially Fixed

| ID        | Issue                                                                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Remaining Gap |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR-REL-01 | Race between repo settings load and initial API calls                    | **Partially Fixed.** `useRepoOptions.ts` now returns `[]` while loading (lines 48-50: `if (!loaded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |               | !repos) return []`) and uses `useMemo`to stabilize the reference. However, components like`PRStationDetail`don't show a distinct "loading repos" state -- they just silently skip the`fetchAll()`call (line 96:`if (!repo) return`) and remain in a generic loading skeleton. The user sees an indefinite spinner until settings load, with no indication of what's being waited on. |
| PR-REL-03 | Cache invalidation doesn't trigger refetch in consuming components       | **Partially Fixed.** `PRStationDetail.tsx:85` adds a `retryKey` state and a retry button (lines 87-89, 181-183) for the error state. However, the core issue remains: after `MergeButton` calls `invalidatePRCache()`, the detail panel's `useEffect` dependency array `[pr.repo, pr.number, repoOptions, retryKey]` does not change, so data is not automatically refetched. The user still sees stale data after merge/close until they manually navigate away or the PR list polling refreshes. The `retryKey` only helps the error case (explicit user click), not the post-mutation staleness case. |
| PR-REL-14 | `pendingReview` store `restoreFromStorage` not tested for malformed data | **Partially Fixed.** A separate test file `pendingReview-persistence.test.ts` now exists with tests for: empty localStorage, valid data, corrupt JSON, and non-object values (arrays). However, it still does not test wrong-shape data (e.g., `{ "pr-1": "not-an-array" }`) or entries with invalid `PendingComment` fields (missing `id`, wrong `side` value). The `restoreFromStorage` code at lines 69-81 now validates individual comment fields (`typeof c.id === 'string'`, `typeof c.path === 'string'`, etc.), which is an improvement, but this validation path is not covered by tests.       |

### Not Fixed

| ID        | Issue                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR-REL-09 | `PRStationDetail` `useEffect` dependency on `repoOptions` causes unnecessary refetches | **Not Fixed.** While `useRepoOptions()` now uses `useMemo` to stabilize the reference after load, the memoization only prevents re-renders from reference instability _within the same load cycle_. The fundamental double-fetch still occurs: (1) mount with `repoOptions = []` -> effect runs but bails at `if (!repo) return`, (2) settings load completes -> `repos` state updates -> `useMemo` returns new array -> effect re-runs and fetches. This is actually worse than before: the first render now shows a loading state that does nothing, then the second render actually fetches. The original audit's fix recommendation of deriving the repo config object outside the effect was not implemented. |
| PR-REL-10 | `PRStationDiff` review comments fetch is fire-and-forget inside a `.then()` chain      | **Not Fixed.** `PRStationDiff.tsx:80-86` still nests the `cachedGetReviewComments` call inside the `getPRDiff` `.then()` handler. While it now uses the cached version (fixing PR-REL-18), it remains a nested untracked promise not gated by the `abortRef` controller. The `cancelled` flag check is present but the HTTP request still runs to completion even after cancellation. The recommendation to use `Promise.allSettled` alongside the diff fetch was not implemented.                                                                                                                                                                                                                                 |
| PR-REL-17 | `PRStationConflictBanner` useEffect missing cleanup for async operation                | **Not Fixed.** `PRStationConflictBanner.tsx:17-40` still has no cancellation flag or AbortController. The `then`/`catch`/`finally` handlers at lines 31-39 set state unconditionally. If the user switches PRs while a conflict check is in-flight, the old result overwrites state for the new PR. The error state handling was improved (line 35-37 now calls `setError(...)` instead of silently swallowing), but the race condition remains.                                                                                                                                                                                                                                                                   |

### Previously Reported Synthesis Items

| Synthesis ID      | Issue                                                           | Status                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-3             | `github:fetch` IPC is an open proxy                             | **Fixed (strengthened).** `git-handlers.ts:43-57` adds `getConfiguredRepos()` which builds a Set of `owner/repo` from settings. `isGitHubRequestAllowed()` at lines 112-121 validates that the target repo is in the configured set. PATCH requests are further restricted to `title`/`body` fields only (lines 124-129). |
| ARCH-3            | Hardcoded `REPO_OPTIONS` in PR Station                          | **Partially Fixed** (same as PR-REL-01 above). Dynamic loading works but fallback-then-update race is only partially mitigated.                                                                                                                                                                                           |
| UX-2              | Virtualized diff silently disables commenting                   | **Fixed** (same as PR-REL-06 above). Banner + force-full-diff toggle added.                                                                                                                                                                                                                                               |
| UX-4              | Duplicate merge controls                                        | **Fixed.** Only `MergeButton.tsx` and `CloseButton.tsx` exist. Both have confirmation dialogs. No `PRStationActions.tsx` found.                                                                                                                                                                                           |
| PR-5 (synthesis)  | DOMPurify default config allows style tags, tracking pixels     | **Fixed.** `render-markdown.ts:21-38` now uses explicit `ALLOWED_TAGS` (no `style`, `img`, or `iframe`) and `ALLOWED_ATTR` restricted to `href`, `title`, `class`. `ALLOW_DATA_ATTR: false` blocks data attributes.                                                                                                       |
| PR-6 (synthesis)  | CSS injection via unvalidated PR label colors                   | **Fixed.** `PRStationDetail.tsx:68-71` adds `safeLabelColor()` which validates hex format with `/^[0-9a-fA-F]{6}$/` before use, falling back to a CSS variable.                                                                                                                                                           |
| PR-12 (synthesis) | PR detail error state has no retry button                       | **Fixed.** `PRStationDetail.tsx:181-183` renders a retry button in the error state that increments `retryKey`.                                                                                                                                                                                                            |
| PR-17 (synthesis) | Check run `html_url` not validated as GitHub URL                | **Fixed.** `PRStationChecks.tsx:55` validates `run.html_url.startsWith('https://github.com/')` before rendering the link.                                                                                                                                                                                                 |
| PR-18 (synthesis) | `invalidatePRCache` uses `includes()` causing over-invalidation | **Fixed.** `github-cache.ts:73-81` now builds a precise prefix `${owner}/${repo}#${number}` and matches by extracting the substring after the first colon, using `===` instead of `includes()`.                                                                                                                           |
| PR-28 (synthesis) | Review submit dialog has no focus trap                          | **Fixed.** `ReviewSubmitDialog.tsx:33-71` implements a manual focus trap: queries all focusable elements, auto-focuses the first, and wraps Tab/Shift+Tab at boundaries.                                                                                                                                                  |

---

## New Issues

### NEW-01: PR poller backoff timer creates recursive `setInterval` replacement (Moderate)

**File:** `src/main/pr-poller.ts:117-125`

**Evidence:**

```typescript
export function startPrPoller(): void {
  safePoll()
  timer = setInterval(() => {
    clearInterval(timer!)
    timer = setInterval(safePoll, backoffDelay)
    safePoll()
  }, backoffDelay)
}
```

The backoff implementation replaces the interval timer inside the interval callback itself. Each tick clears the current interval and creates a new one with the updated `backoffDelay`. However, this means `safePoll()` is called both (a) as the direct call inside the lambda and (b) immediately when the new interval starts its first tick after `backoffDelay`. This double-fires the poll on every interval replacement. Additionally, if `safePoll()` updates `backoffDelay` asynchronously (via the `.then`/`.catch` handlers), the new interval may be created with a stale `backoffDelay` value since the promise hasn't resolved yet.

**Impact:** Double poll calls on each interval cycle. Backoff delay may lag one cycle behind the actual error count.

**Fix:** Use `setTimeout` chains instead of `setInterval` replacement -- each successful/failed poll schedules the next one with the current delay.

---

### NEW-02: `PRStationConflictBanner` error state surfaces raw error messages to user (Minor)

**File:** `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx:35-37`

**Evidence:**

```typescript
.catch((err) => {
  setConflictFiles([])
  setError(err instanceof Error ? err.message : 'Failed to fetch conflict files')
})
```

While other components in the PR Station (MergeButton, CloseButton, github-api.ts) were updated to use generic user-friendly messages, `PRStationConflictBanner` still surfaces raw error messages from the IPC call. This could expose internal details (e.g., git command output, file paths, stack traces).

**Impact:** Minor information disclosure in the conflict banner error state.

**Fix:** Use a generic message like "Unable to determine conflicting files" instead of forwarding the raw error.

---

## Test Coverage Gaps (Updated)

| ID        | Status                 | Gap                                                                                    |
| --------- | ---------------------- | -------------------------------------------------------------------------------------- |
| PR-REL-13 | **Resolved**           | `CloseButton.test.tsx` added with 6 tests                                              |
| PR-REL-14 | **Partially Resolved** | `pendingReview-persistence.test.ts` added; missing wrong-shape and invalid-field tests |
| TCG-01    | **Not Resolved**       | `github-cache.ts` still has no test file                                               |
| TCG-02    | **Not Resolved**       | `pr-poller.ts` still has no test file                                                  |
| TCG-03    | **Not Resolved**       | No test covers GitHub API rate limit (403) handling                                    |
| TCG-04    | **Not Resolved**       | No test covers `fetchAllPages` with > 2 pages (though MAX_PAGES guard was added)       |
| TCG-05    | **Not Resolved**       | No test covers concurrent merge attempts (double-click)                                |
| TCG-06    | **Not Resolved**       | `PRStationDiff` test still mocks `parseDiffChunked` away                               |

---

## Summary Table

| ID        | Original Severity | Status                     | Notes                                                                                   |
| --------- | ----------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| PR-REL-01 | Significant       | Partially Fixed            | Empty array during load prevents stale fallback race, but no distinct loading indicator |
| PR-REL-02 | Significant       | Fixed                      | Unused `_signal` parameter removed entirely                                             |
| PR-REL-03 | Significant       | Partially Fixed            | Retry button added for error state; post-mutation staleness still present               |
| PR-REL-04 | Significant       | Fixed                      | `beforeunload` flush handler added; `restoreFromStorage` called on init                 |
| PR-REL-05 | Significant       | Fixed                      | Both merge and close have confirmation dialogs via `useConfirm`                         |
| PR-REL-06 | Significant       | Fixed                      | Banner + force-full-diff toggle implemented                                             |
| PR-REL-07 | Moderate          | Fixed                      | `MAX_PAGES = 100` limit added                                                           |
| PR-REL-08 | Moderate          | Fixed                      | Exponential backoff + structured logging added                                          |
| PR-REL-09 | Moderate          | Not Fixed                  | `useMemo` added but double-fetch still occurs on initial load                           |
| PR-REL-10 | Moderate          | Not Fixed                  | Still nested fire-and-forget (now cached, reducing impact)                              |
| PR-REL-11 | Moderate          | Fixed                      | `isContentEditable` check added                                                         |
| PR-REL-12 | Moderate          | Not Fixed (de-prioritized) | Viewport height default still 800; low severity unchanged                               |
| PR-REL-13 | Minor             | Fixed                      | `CloseButton.test.tsx` with 6 tests                                                     |
| PR-REL-14 | Minor             | Partially Fixed            | Persistence tests added; edge cases incomplete                                          |
| PR-REL-15 | Minor             | N/A (no action needed)     | Accepted as-is at current scale                                                         |
| PR-REL-16 | Minor             | Fixed                      | `logger.warn` added to per-repo catch                                                   |
| PR-REL-17 | Minor             | Not Fixed                  | No cancellation flag in conflict banner async                                           |
| PR-REL-18 | Minor             | Fixed                      | Switched to `cachedGetReviewComments`                                                   |
| NEW-01    | Moderate          | New                        | PR poller backoff creates recursive setInterval, double-fires polls                     |
| NEW-02    | Minor             | New                        | Conflict banner leaks raw error messages                                                |

---

## Overall Assessment

The PR Station has undergone significant remediation since the initial audit. **10 of 18 findings are fully resolved**, including all Critical/Significant-severity items related to data safety (confirmation dialogs, debounce flush, abort signal cleanup, commenting visibility). The security posture has improved substantially: DOMPurify is properly configured, label colors are validated, the GitHub proxy has repo-scoped allowlisting with PATCH field restrictions, and check run URLs are validated.

**Remaining risk areas:**

1. **Post-mutation data staleness** (PR-REL-03) -- the most impactful remaining issue. After merge/close/review, the detail panel shows stale data. Users may attempt duplicate operations.
2. **PR poller backoff implementation** (NEW-01) -- the recursive setInterval pattern double-fires polls and uses stale delay values.
3. **Minor race conditions** (PR-REL-09, PR-REL-10, PR-REL-17) -- all low-impact but accumulate to create unnecessary API calls and brief UI inconsistencies.

**Recommended next actions (priority order):**

1. Wire `MergeButton`/`CloseButton`/`ReviewSubmitDialog` mutations to increment a shared refresh counter in `PRStationDetail` (fixes PR-REL-03)
2. Replace recursive `setInterval` in pr-poller with `setTimeout` chain (fixes NEW-01)
3. Add cancellation flag to `PRStationConflictBanner` useEffect (fixes PR-REL-17)
4. Add `github-cache.ts` unit tests (addresses TCG-01)
