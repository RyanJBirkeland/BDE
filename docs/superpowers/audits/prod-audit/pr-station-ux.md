# PR Station -- UX QA Audit

**Date:** 2026-03-29
**Scope:** 37 files (20 source, 17 tests) in PR Station feature
**Persona:** UX QA
**Auditor:** Claude Opus 4.6

---

## Cross-Reference: March 28 Synthesis Report

### UX-2: Virtualized diff silently disables all commenting

**Status: PARTIALLY ADDRESSED.**

The virtualization logic at `DiffViewer.tsx:444` now reads:

```ts
const useVirtualization = totalLines > DIFF_VIRTUALIZE_THRESHOLD && !hasComments
```

When existing GitHub review comments are present (`hasComments = comments.length > 0`), virtualization is disabled and plain mode is used, preserving commenting. However, the underlying issue persists for diffs with **no existing comments**: if a diff exceeds 500 lines and has no pre-existing comments, the virtualized renderer (`VirtualizedDiffContent`) renders line rows without any commenting affordances -- no gutter click handlers, no composer, no pending comment display. There is **no visible indicator** that commenting is disabled. The user simply cannot interact with line gutters to add comments.

### UX-4: Duplicate merge controls with divergent behavior

**Status: FIXED.**

`PRStationActions` component has been deleted (confirmed via grep and test comment at `PRStationView.test.tsx:171`). A single `MergeButton` component in `PRStationDetail` is the only merge control. The `CloseButton` is separate and serves a different function. No duplicate merge controls remain.

---

## Findings

### Critical

**PR-UX-1: Merge button has no confirmation dialog for destructive action**

- **File:** `src/renderer/src/components/pr-station/MergeButton.tsx:51-65`
- **Evidence:** `handleMerge()` calls `mergePR()` directly on click with no confirmation step. Compare with `CloseButton` which also lacks confirmation but is visually de-emphasized. Merging is irreversible on GitHub (especially squash/rebase which rewrite history).
- **Impact:** Accidental click on the merge button permanently merges a PR. The dropdown trigger is immediately adjacent (`merge-button__dropdown-trigger`), increasing misclick risk when the user intends to change strategy.
- **Fix:** Wrap `handleMerge()` with a `useConfirm()` dialog: "Merge PR #N using {strategy}? This cannot be undone." The `PRStationView` already imports and uses `useConfirm` for pending-comments confirmation, so the pattern exists in the codebase.

**PR-UX-2: Close button has no confirmation dialog**

- **File:** `src/renderer/src/components/pr-station/CloseButton.tsx:20-33`
- **Evidence:** `handleClose()` calls `closePR()` directly. Closing a PR discards its review state and CI context.
- **Impact:** Accidental PR closure requires manually reopening on GitHub. No undo mechanism exists in BDE.
- **Fix:** Add confirmation dialog: "Close PR #N without merging?" using the same `useConfirm()` pattern.

### Significant

**PR-UX-3: Virtualized diff silently disables commenting with no user feedback**

- **File:** `src/renderer/src/components/diff/DiffViewer.tsx:444,94-211`
- **Evidence:** `VirtualizedDiffContent` (lines 94-211) renders line rows with no `onMouseDown` gutter handlers, no `DiffCommentComposer`, no `DiffCommentWidget`, and no pending comment display. Meanwhile `PlainDiffContent` (lines 214-412) has all of these. The threshold is 500 lines (`DIFF_VIRTUALIZE_THRESHOLD` in `constants.ts:32`).
- **Impact:** On PRs with >500 changed lines and no existing comments, the user sees a fully rendered diff that looks interactive but provides zero commenting affordance. There is no banner, tooltip, or visual cue explaining why commenting is unavailable.
- **Fix:** Either (a) add a banner above the virtualized diff: "Large diff -- commenting disabled. Load full diff to enable comments." with a button to force plain mode, or (b) add commenting support to `VirtualizedDiffContent` for the visible rows.

**PR-UX-4: `getPrMergeability` ignores abort signal -- stale mergeability can display**

- **File:** `src/renderer/src/lib/github-api.ts:61-76`
- **Evidence:** The function signature accepts `_signal?: AbortSignal` (underscore-prefixed, unused). The `githubFetchRaw` call on line 67 does not forward the signal. In `PRStationView.tsx:107`, the caller passes `controller.signal` expecting cancellation on PR switch, but it is never wired.
- **Impact:** When switching between PRs rapidly, the mergeability response from a previous PR can arrive after `setMergeability(null)` on line 103 and overwrite the null with stale data. The user sees merge/blocked status from the wrong PR.
- **Fix:** Forward the signal to `githubFetchRaw` or use the existing abort check pattern. Rename `_signal` to `signal` and pass it through.

**PR-UX-5: Pending review comments at risk of loss -- no `beforeunload` flush**

- **File:** `src/renderer/src/stores/pendingReview.ts:76-88`
- **Evidence:** The store persists to localStorage via a 500ms debounced `setTimeout`. If the user adds a comment and closes the app (or the app crashes) within 500ms, the comment is lost.
- **Impact:** User adds inline review comments, closes BDE quickly, comments are gone on reopen.
- **Fix:** Add a synchronous `beforeunload` flush: `window.addEventListener('beforeunload', () => localStorage.setItem(STORAGE_KEY, JSON.stringify(usePendingReviewStore.getState().pendingComments)))`.

**PR-UX-6: Review submission resets selected PR via unmount/remount hack**

- **File:** `src/renderer/src/views/PRStationView.tsx:207-212`
- **Evidence:**
  ```tsx
  onSubmitted={() => {
    const pr = selectedPr
    setSelectedPr(null)
    setTimeout(() => setSelectedPr(pr), 0)
  }}
  ```
  After review submission, the selected PR is set to null and then restored in the next tick. This causes a full unmount/remount of `PRStationDetail`, `PRStationDiff`, and all child components.
- **Impact:** The user sees a flash of the "Select a PR" empty state. All component state is lost (scroll position, active tab, expanded comment threads, active file in diff). The detail section re-fetches all data from GitHub (detail, files, checks, reviews, comments).
- **Fix:** Invalidate the cache via `invalidatePRCache()` and trigger a re-fetch within the existing component tree (e.g., via a `refreshKey` counter state) instead of unmounting.

**PR-UX-7: PR detail fetch error state shows no retry action**

- **File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:166-173`
- **Evidence:**
  ```tsx
  if (!detail) {
    return (
      <div className="pr-detail pr-detail--error">
        <FileCode2 size={24} />
        <span>Failed to load PR details</span>
      </div>
    )
  }
  ```
  No retry button, no "try again" link, no suggestion to check connection.
- **Impact:** If the GitHub API is temporarily unreachable, the user must deselect and reselect the PR to retry. No affordance communicates this.
- **Fix:** Add a retry button that re-triggers `fetchAll()`. The `PRStationList` already has a retry pattern via its refresh button.

### Moderate

**PR-UX-8: Filter state is not persisted -- resets on view switch**

- **File:** `src/renderer/src/views/PRStationView.tsx:29`
- **Evidence:** `const [filters, setFilters] = useState<PRFilters>({ repo: null, sort: 'updated' })` -- local state, not persisted to settings or stored in Zustand.
- **Impact:** User filters to a specific repo, switches to Agents view (Cmd+2) and back (Cmd+5), filters reset to "All" / "Last updated". Minor annoyance for users who work in multi-repo setups.
- **Fix:** Persist filters to a Zustand store or to the `settings` table via IPC.

**PR-UX-9: Active tab (Info/Diff) resets when switching between PRs**

- **File:** `src/renderer/src/views/PRStationView.tsx:26`
- **Evidence:** `activeTab` is independent local state. No logic resets it on PR change, BUT the `setSelectedPr(null)` + `setTimeout` hack in `onSubmitted` (PR-UX-6) does cause reset by unmounting. Additionally, if the user is reviewing diffs across multiple PRs, each PR switch requires re-clicking the Diff tab.
- **Impact:** Minor friction when reviewing diffs sequentially across PRs. The tab preference is not "sticky."
- **Fix:** Keep `activeTab` state independent of PR selection (already the case for normal PR switches; only the `onSubmitted` hack causes reset).

**PR-UX-10: Diff size warning provides no information about commenting impact**

- **File:** `src/renderer/src/components/diff/DiffSizeWarning.tsx:19-28`
- **Evidence:** The warning says "Large diff ({size}) may slow down the editor." with a "Load anyway" button. It does not mention that loading in virtualized mode (which happens automatically for >500 lines) disables commenting.
- **Impact:** User clicks "Load anyway" for a 5MB diff, gets virtualized render, cannot comment. The warning was about performance, not about commenting loss.
- **Fix:** Add a note: "Loading large diffs disables inline commenting. Click 'Load full diff' to enable comments (may be slow)."

**PR-UX-11: Conflict banner swallows fetch errors silently**

- **File:** `src/renderer/src/components/pr-station/PRStationConflictBanner.tsx:31-32`
- **Evidence:** `.catch(() => { setConflictFiles([]) })` -- if the conflict files API call fails, the banner shows "This PR has merge conflicts" with no file list and no error indication.
- **Impact:** User sees the conflict warning but gets no file list and no indication that file detection failed. They may assume there are no specific conflicting files.
- **Fix:** Track error state and show "Could not determine conflicting files" text when the API call fails.

**PR-UX-12: Keyboard navigation in diff only works when PR Station is the active view**

- **File:** `src/renderer/src/components/diff/DiffViewer.tsx:608`
- **Evidence:** `if (activeView !== 'pr-station') return` -- the keyboard handler checks the active view. However, `DiffViewer` is also used (or could be used) in the Source Control view's `InlineDiffDrawer`. Keyboard shortcuts would not work there.
- **Impact:** If `DiffViewer` is reused outside PR Station, keyboard navigation silently fails. The check is correct for preventing shortcut conflicts, but the implementation ties the component to a specific view.
- **Fix:** Accept an `enableKeyboard` prop rather than checking `activeView` internally. The parent view can control when keyboard navigation is active.

**PR-UX-13: Label colors rendered without validation -- CSS injection possible**

- **File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:201`
- **Evidence:** `style={{ background: \`#${label.color}\` }}`--`label.color`comes directly from the GitHub API response. While GitHub sanitizes this field, the`#` prefix + raw string insertion into a CSS value is a vector if any non-hex value leaks through.
- **Impact:** Unlikely but possible CSS injection via malformed label color values from GitHub API or a compromised API proxy.
- **Fix:** Validate with regex: `const safeColor = /^[0-9a-fA-F]{6}$/.test(label.color) ? \`#${label.color}\` : 'var(--neon-text-dim)'`.

**PR-UX-14: Diff comment selection only works on RIGHT (new) side**

- **File:** `src/renderer/src/components/diff/DiffViewer.tsx:317-330`
- **Evidence:** The `onMouseDown` handler is only attached to `.diff-line__gutter--new` (the right/new side gutter). Deleted lines (left side) have no click handler. The `side` is always hardcoded to `'RIGHT'`.
- **Impact:** Users cannot add review comments on deleted lines. GitHub's review API supports `side: 'LEFT'` for commenting on the old version of a line. This limits the review workflow for deletion-heavy PRs.
- **Fix:** Add `onMouseDown` to `.diff-line__gutter--old` with `side: 'LEFT'`. Update the `LineRange` and comment creation logic to handle left-side comments.

### Minor

**PR-UX-15: No reply-to-comment UI in conversation or diff viewer**

- **File:** `src/renderer/src/components/diff/DiffCommentWidget.tsx`, `src/renderer/src/components/pr-station/PRStationConversation.tsx`
- **Evidence:** `replyToComment()` is exported from `github-api.ts:252-272` and tested, but no UI component calls it. `DiffCommentWidget` renders existing threads read-only with collapse/expand but no reply affordance. `PRStationConversation` renders threads but has no reply buttons.
- **Impact:** Users must switch to GitHub web to reply to existing review comments. This breaks the review flow that PR Station otherwise supports (view thread, compose new, submit batch).
- **Fix:** Add a "Reply" button to `DiffCommentWidget` comment threads and `PRStationConversation` thread items that opens an inline composer.

**PR-UX-16: PR list shows stale data during refresh**

- **File:** `src/renderer/src/components/pr-station/PRStationList.tsx:98-108`
- **Evidence:** `handleRefresh` sets `loading=true` and `error=null`, but keeps the old `prs` array visible. The refresh button is disabled during loading. The existing PR rows remain visible with potentially stale check badges and timestamps.
- **Impact:** Minor -- the user sees old data while refreshing, which is generally acceptable. However, the refresh button uses a plain unicode character (`&#x21bb;`) rather than a spinner, so there is no clear "refreshing" visual state beyond the button being disabled.
- **Fix:** Show a subtle loading indicator (spinner overlay or opacity reduction on the list) during refresh.

**PR-UX-17: Checks section in detail panel does not auto-refresh**

- **File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:126-130`
- **Evidence:** Check runs are fetched once when the detail loads. There is no polling or re-fetch mechanism. The main-process `pr-poller` updates check summaries every 60s in the PR list, but the detail panel's individual check run list does not refresh.
- **Impact:** User opens a PR detail, CI checks are "pending." They wait. The checks complete on GitHub, but the detail panel still shows "pending" until the user deselects and reselects the PR.
- **Fix:** Add a polling interval (e.g., 30s) for check runs when the detail panel is visible, or add a manual "refresh checks" button.

**PR-UX-18: Review submit dialog dismisses on backdrop click without confirmation**

- **File:** `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx:71`
- **Evidence:** `<div className="review-dialog-backdrop" onClick={onClose}>` -- clicking the backdrop immediately closes the dialog. If the user has typed a review body or selected a review type, this is lost.
- **Impact:** Accidental backdrop click loses typed review body. The pending inline comments are safe (stored in Zustand), but the overall review body text is local state.
- **Fix:** Check if `body.trim()` is non-empty before allowing backdrop dismiss, or show a micro-confirmation.

**PR-UX-19: Review submit dialog has no keyboard trap (focus management)**

- **File:** `src/renderer/src/components/pr-station/ReviewSubmitDialog.tsx:70-118`
- **Evidence:** The dialog uses `role="dialog"` and `aria-modal="true"` but has no focus trap. Tab key can move focus behind the dialog backdrop to the PR list and detail panel.
- **Impact:** Accessibility issue -- screen readers and keyboard users can interact with background content while the modal is open, violating WAI-ARIA dialog pattern requirements.
- **Fix:** Add a focus trap (e.g., `focus-trap-react` or a manual implementation) that constrains tab order to dialog elements. Auto-focus the textarea on mount (already done via `textareaRef` pattern, but the dialog itself does not have it).

**PR-UX-20: Conversation comment count includes reply comments in the badge**

- **File:** `src/renderer/src/components/pr-station/PRStationConversation.tsx:106`
- **Evidence:** `const totalComments = issueComments.length + reviewComments.length` -- this counts every review comment including replies. The badge shows 5 when there are 2 threads with 3 replies.
- **Impact:** The count badge is inflated relative to what the user sees (threads, not individual messages). GitHub shows thread count, not message count.
- **Fix:** Count unique threads + issue comments: `const totalComments = issueComments.length + timeline.filter(i => i.kind === 'review-thread').length`.

---

## Summary Table

| ID       | Severity    | Component                        | Summary                                                            |
| -------- | ----------- | -------------------------------- | ------------------------------------------------------------------ |
| PR-UX-1  | Critical    | MergeButton                      | No confirmation dialog before irreversible merge                   |
| PR-UX-2  | Critical    | CloseButton                      | No confirmation dialog before closing PR                           |
| PR-UX-3  | Significant | DiffViewer                       | Virtualized diff silently disables commenting with no indicator    |
| PR-UX-4  | Significant | github-api                       | Abort signal ignored in `getPrMergeability` -- stale data possible |
| PR-UX-5  | Significant | pendingReview store              | No `beforeunload` flush -- comments lost on fast close             |
| PR-UX-6  | Significant | PRStationView                    | Review submission causes full unmount/remount flash                |
| PR-UX-7  | Significant | PRStationDetail                  | Error state has no retry button                                    |
| PR-UX-8  | Moderate    | PRStationView                    | Filter state not persisted across view switches                    |
| PR-UX-9  | Moderate    | PRStationView                    | Active tab resets on review submit                                 |
| PR-UX-10 | Moderate    | DiffSizeWarning                  | Warning does not mention commenting impact                         |
| PR-UX-11 | Moderate    | ConflictBanner                   | Fetch errors silently swallowed                                    |
| PR-UX-12 | Moderate    | DiffViewer                       | Keyboard nav hardcoded to pr-station view                          |
| PR-UX-13 | Moderate    | PRStationDetail                  | Label colors not validated before CSS injection                    |
| PR-UX-14 | Moderate    | DiffViewer                       | Comment selection only works on RIGHT (new) side                   |
| PR-UX-15 | Minor       | DiffCommentWidget / Conversation | No reply-to-comment UI despite API support                         |
| PR-UX-16 | Minor       | PRStationList                    | No visual refresh indicator beyond disabled button                 |
| PR-UX-17 | Minor       | PRStationDetail                  | Check runs do not auto-refresh                                     |
| PR-UX-18 | Minor       | ReviewSubmitDialog               | Backdrop click dismisses without body-loss check                   |
| PR-UX-19 | Minor       | ReviewSubmitDialog               | No focus trap in modal dialog                                      |
| PR-UX-20 | Minor       | PRStationConversation            | Comment count badge inflated by reply count                        |

---

## Synthesis Cross-Reference Status

| Original Issue                                     | Status          | Notes                                                                                                                      |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| UX-2 (virtualized diff disables commenting)        | Partially fixed | Plain mode forced when comments exist, but new commenting still impossible in virtualized mode with no indicator (PR-UX-3) |
| UX-4 (duplicate merge controls)                    | Fixed           | `PRStationActions` deleted; single `MergeButton` in `PRStationDetail`                                                      |
| ARCH-3 (hardcoded REPO_OPTIONS)                    | Fixed           | All components now use `useRepoOptions()` hook                                                                             |
| SEC-3 (open GitHub API proxy)                      | Fixed           | Allowlist implemented in `git-handlers.ts:31-48`                                                                           |
| Quick Win #12 (abort signal)                       | Not fixed       | `_signal` still unused in `getPrMergeability` (PR-UX-4)                                                                    |
| Quick Win #13 (cache invalidation after mutations) | Fixed           | `invalidatePRCache()` called in `MergeButton`, `CloseButton`, `ReviewSubmitDialog`                                         |
