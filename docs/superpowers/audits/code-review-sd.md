# Code & Review Domain -- Senior Developer Audit

## 1. Executive Summary

The Code & Review domain (PR Station, Source Control, diff viewer, GitHub API layer) is architecturally sound. The GitHub token never enters renderer memory -- all API calls are proxied through the main process via `github:fetch` IPC, and the handler correctly strips any caller-supplied `Authorization` header before injecting the server-side token. Markdown from GitHub is sanitized via DOMPurify before rendering with `innerHTML` insertion. However, there are several significant issues: the `github:fetch` IPC proxy allows the renderer to make arbitrary mutating GitHub API calls with the user's token (SSRF-adjacent), the `github-cache.ts` `Map` grows unboundedly, diff line content is rendered as raw text nodes (safe) but the PR label `color` field from GitHub is injected unsanitized into inline `style.background`, and the `pendingReview` localStorage persistence has a race window during the 500ms debounce.

## 2. Critical Issues

### 2.1 `github:fetch` IPC is an open proxy for any GitHub API call

- **File:** `/Users/ryan/projects/BDE/src/main/handlers/git-handlers.ts`, lines 40-70
- **Severity:** Critical (security)
- **Detail:** The `github:fetch` handler accepts any path string from the renderer and forwards it to `api.github.com` with the user's token. While it validates the hostname is `api.github.com`, there is no restriction on which endpoints or HTTP methods are used. A compromised renderer (or XSS in rendered markdown) could call `DELETE /repos/{owner}/{repo}`, `PUT /repos/{owner}/{repo}/collaborators/{username}`, create deploy keys, etc. The handler also forwards arbitrary `body` content.
- **Recommendation:** Implement an allowlist of permitted path patterns and HTTP methods. At minimum, restrict to `GET` + the specific `PUT/POST/PATCH` endpoints the PR Station actually needs (merge, reviews, close).

### 2.2 PR label color injected unsanitized into inline style

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDetail.tsx`, line 199
- **Detail:** `style={{ background: '#' + label.color }}` where `label.color` comes directly from the GitHub API response. GitHub typically returns hex color strings, but a crafted label color like `red; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh` could break layout (CSS injection). React's `style` prop mitigates most attack vectors (it does not parse string values as CSS), but the `#` prefix concatenation means any non-hex value results in an invalid but rendered style.
- **Recommendation:** Validate `label.color` matches `/^[0-9a-fA-F]{6}$/` before using it.

## 3. Significant Issues

### 3.1 Unbounded `github-cache.ts` Map -- potential memory leak

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/github-cache.ts`, lines 21-38
- **Detail:** The `cache` Map grows without bound. Entries are only removed on read (lazy expiry at line 29-31) or via explicit `invalidateCache()`. If the user browses many PRs across many repos over a long session, stale entries accumulate. There is no maximum size cap or periodic sweep.
- **Recommendation:** Add a max-size eviction policy (LRU or simple size cap with oldest-first eviction) or a periodic sweep timer.

### 3.2 `pendingReview` localStorage race during debounce window

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/stores/pendingReview.ts`, lines 76-88
- **Detail:** The `subscribe` handler debounces localStorage writes by 500ms. If the user adds a comment and immediately closes/refreshes the app within that 500ms window, the comment is lost. Since pending review comments represent user-authored content, data loss here is a real UX concern.
- **Recommendation:** Write synchronously on `beforeunload`, or flush the debounce timer in a `beforeunload` handler.

### 3.3 `fetchAllPages` in `github-api.ts` has no page limit

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/github-api.ts`, lines 13-29
- **Detail:** The `fetchAllPages` function follows `linkNext` until `null` with no upper bound. For endpoints like review comments on very active PRs, this could result in thousands of API calls. Combined with the 30s timeout per request in `githubFetch`, a pathological case could hang the UI for minutes.
- **Recommendation:** Add a maximum page count (e.g., 10 pages = 1000 items) with a warning when truncated.

### 3.4 `getPrMergeability` AbortSignal parameter is unused

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/github-api.ts`, line 64-66
- **Detail:** `_signal?: AbortSignal` is accepted but never passed to `githubFetchRaw`. The abort controller created in `PRStationView.tsx` (line 106) has no effect -- the HTTP request continues even after the component unmounts and the controller aborts. The `.catch` at line 111 catches the wrong error (AbortError from signal, but the signal is never connected).
- **Recommendation:** Wire the signal through to the IPC call, or remove the parameter to avoid false confidence.

### 3.5 Stale closure in `PRStationDiff` parallel comment fetch

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationDiff.tsx`, lines 77-83
- **Detail:** `getReviewComments` is fired inside a `.then()` callback after `getPRDiff` resolves. The `cancelled` flag is checked, but if the user switches PRs rapidly, the inner `.then` for comments can resolve after the outer effect's cleanup runs, potentially setting comments from a previous PR onto the new PR's state. The `cancelled` boolean only prevents state updates if it was set before the promise resolves, but the check is correct -- however, the nested async pattern is fragile and harder to audit for correctness compared to a single `Promise.all` with abort.
- **Recommendation:** Refactor to use a single `Promise.all` or `Promise.allSettled` with the `cancelled` check after both resolve.

### 3.6 Duplicate merge functionality -- `MergeButton` and `PRStationActions`

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/MergeButton.tsx` and `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationActions.tsx`
- **Detail:** Both components independently implement merge strategy selection, dropdown UX, and the actual `mergePR` call. They maintain separate `method` state and are both rendered for the same PR (one in the header via `PRStationDetail`, one in the actions section). A user could trigger two concurrent merges if they click both buttons rapidly.
- **Recommendation:** Consolidate into a single merge component or share merge-in-progress state to prevent double-merge.

### 3.7 No error feedback when GitHub token is missing/expired during renderer API calls

- **File:** `/Users/ryan/projects/BDE/src/main/handlers/git-handlers.ts`, lines 41-43
- **Detail:** When the token is missing, the handler throws `'GitHub token not configured...'`. This surfaces as a generic IPC error in the renderer. The `githubFetch` wrapper in `github-fetch.ts` broadcasts `github:tokenExpired` on 401, but there is no renderer listener shown in the PR Station code that handles this event to show a meaningful "re-authenticate" UX.
- **Recommendation:** Add a listener for `github:tokenExpired` in the PR Station view to show an actionable error state.

## 4. Minor Issues

### 4.1 Inline styles throughout GitTreeView and git-tree components

- **Files:** `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx`, all files in `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/`
- **Detail:** The entire Source Control view uses inline `style={{}}` objects with `tokens.*` instead of CSS classes. This is inconsistent with the neon styling convention documented in CLAUDE.md (`*-neon.css` files). Every render creates new style objects, which is a minor GC pressure concern for frequently-polled views.
- **Recommendation:** Migrate to a `git-tree-neon.css` file with BEM classes, consistent with other views.

### 4.2 `useGitTreeStore.getState()` called outside selector for actions

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx`, line 43
- **Detail:** `const { fetchStatus, selectFile, ... } = useGitTreeStore.getState()` extracts action functions outside React's subscription model. This is actually a valid Zustand pattern for stable function refs, but it mixes two subscription styles in one component (selectors for data, `.getState()` for actions), which can confuse future maintainers.
- **Recommendation:** Either use selectors for everything or document why `.getState()` is intentional for actions.

### 4.3 Missing `eslint-disable` justification for `useEffect` deps

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/views/GitTreeView.tsx`, line 57
- **Detail:** The `useEffect` at line 52 depends on `[activeRepo]` but calls `clearSelection`, `fetchStatus`, and `fetchBranches` which are extracted via `.getState()`. The missing deps are intentional (stable refs), but there is no eslint-disable comment to document this, unlike similar patterns elsewhere in the codebase.

### 4.4 `parseDiffChunked` uses `requestAnimationFrame` -- inappropriate in hidden tabs

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/diff-parser.ts`, lines 169-176
- **Detail:** `requestAnimationFrame` is throttled (or paused entirely) when the tab is not visible. If a user switches to another panel while a large diff is loading, parsing stalls. `setTimeout(processNext, 0)` would be more appropriate for a non-visual chunking mechanism.
- **Recommendation:** Use `setTimeout(processNext, 0)` or `queueMicrotask` batching instead of `requestAnimationFrame`.

### 4.5 `PRStationList` filters `removedKeys` three separate times

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/pr-station/PRStationList.tsx`, lines 98, 119, 127
- **Detail:** The `prs.filter(p => !removedKeys?.has(...))` operation is repeated three times with the same predicate -- once for the count badge, once for the empty state check, and once for the actual rendering. This should be computed once.
- **Recommendation:** Compute `visiblePrs` once with `useMemo` and use it in all three places.

### 4.6 `InlineDiffDrawer` uses hardcoded `rgba()` values

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/InlineDiffDrawer.tsx`, lines 28-31
- **Detail:** `lineBackground` uses hardcoded `rgba(0, 211, 127, 0.07)`, `rgba(255, 77, 77, 0.07)`, etc. This violates the CSS theming rule from CLAUDE.md: "Never use hardcoded `rgba()` for overlays or `box-shadow`."
- **Recommendation:** Use CSS custom properties or design tokens for these colors.

### 4.7 `PRStationConflictBanner` returns all changed files, not just conflicting ones

- **File:** `/Users/ryan/projects/BDE/src/main/github-conflict-check.ts`, lines 43-50
- **Detail:** The `checkConflictFiles` function fetches all PR changed files, not the actual conflicting files. The GitHub REST API does not directly expose which specific files have conflicts. The banner title says "This PR has merge conflicts" and lists all changed files, which is misleading.
- **Recommendation:** Either rename to "Changed files in this PR" or note that GitHub API does not provide per-file conflict data.

### 4.8 `BranchSelector` dropdown has no focus trap

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/components/git-tree/BranchSelector.tsx`, lines 94-173
- **Detail:** The dropdown uses a fixed-position backdrop for click-outside dismissal and handles `Escape`, but there is no focus trap. Tab key can move focus behind the dropdown. The listbox items are buttons but not managed with `aria-activedescendant` or arrow-key navigation.
- **Recommendation:** Add keyboard arrow-key navigation and focus trapping for the listbox.

### 4.9 `PRStationView` re-selects PR via setTimeout hack

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/views/PRStationView.tsx`, lines 214-216
- **Detail:** `onSubmitted` callback sets `selectedPr` to null then restores it via `setTimeout(() => setSelectedPr(pr), 0)` to force a re-render/re-fetch of the detail panel. This is a code smell -- a proper cache invalidation + refetch would be cleaner.
- **Recommendation:** Call `invalidateCache()` from `github-cache.ts` and trigger a refetch instead of the null/restore trick.

## 5. Security Surface Map

All locations where external (GitHub API) data is rendered in the UI:

| Location                         | Data Source                                         | Rendering Method                         | Sanitized?                                  |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `PRStationDetail.tsx:225`        | `detail.body` (PR description)                      | innerHTML via `renderMarkdown()`         | Yes (DOMPurify)                             |
| `PRStationConversation.tsx:73`   | `comment.body` (issue/review comments)              | innerHTML via `renderMarkdown()`         | Yes (DOMPurify)                             |
| `PRStationReviews.tsx:96`        | `review.body` (review body)                         | innerHTML via `renderMarkdown()`         | Yes (DOMPurify)                             |
| `DiffCommentWidget.tsx:36`       | `comment.body` (inline diff comments)               | innerHTML via `renderMarkdown()`         | Yes (DOMPurify)                             |
| `PRStationDetail.tsx:181`        | `detail.title`                                      | Text node                                | Safe (React escapes)                        |
| `PRStationDetail.tsx:184`        | `detail.user.login`                                 | Text node                                | Safe                                        |
| `PRStationDetail.tsx:188-190`    | `detail.head.ref`, `detail.base.ref`                | Text node                                | Safe                                        |
| `PRStationDetail.tsx:199`        | `label.color`                                       | Inline `style.background` as `#${color}` | **NOT validated** -- CSS injection possible |
| `PRStationDetail.tsx:200`        | `label.name`                                        | Text node                                | Safe                                        |
| `PRStationList.tsx:141-147`      | `pr.repo`, `pr.number`, `pr.title`, `pr.updated_at` | Text nodes                               | Safe                                        |
| `PRStationConversation.tsx:131`  | `comment.path` (file path in review thread)         | Text node                                | Safe                                        |
| `PRStationChecks.tsx:54`         | `run.name`                                          | Text node                                | Safe                                        |
| `PRStationChecks.tsx:59`         | `run.html_url`                                      | `<a href={...}>`                         | **No URL validation** -- could be non-HTTPS |
| `DiffViewer.tsx:204`             | `line.content` (diff line text)                     | Text node                                | Safe                                        |
| `DiffViewer.tsx:166,187`         | `file.path`, `hunk.header`                          | Text nodes                               | Safe                                        |
| `PRStationConflictBanner.tsx:49` | `file` (filename from GitHub)                       | Text node                                | Safe                                        |
| `InlineDiffDrawer.tsx:83,147`    | `selectedFile.path`, diff line content              | Text node / `whiteSpace: pre`            | Safe                                        |
| `GitFileRow.tsx:116-122`         | `path`, `status` (from git CLI)                     | Text nodes                               | Safe (local git data)                       |
| `PRStationView.tsx:148-149`      | `selectedPr.number`, `selectedPr.title`             | Text node                                | Safe                                        |
| `DiffViewer.tsx:389`             | `pc.body` (pending comment body, user-authored)     | Text node                                | Safe (own content)                          |

### Notes on `renderMarkdown` sanitization

- **File:** `/Users/ryan/projects/BDE/src/renderer/src/lib/render-markdown.ts`
- Uses DOMPurify which strips dangerous tags/attributes. The custom markdown-to-HTML conversion is simplistic (regex-based), but since DOMPurify runs after conversion, any HTML smuggled through the regex patterns gets sanitized.
- The regex for inline code could theoretically match across backtick-delimited content containing HTML, but DOMPurify handles the output regardless.

### Token security

- **GitHub token:** Stored in SQLite `settings` table (key: `github.token`) or `GITHUB_TOKEN` env var. Never sent to renderer. The `github:fetch` handler at `/Users/ryan/projects/BDE/src/main/handlers/git-handlers.ts:57` explicitly strips any `Authorization` header from the renderer's request before injecting the server-side token.
- **No token logging:** The token value is not logged anywhere in the audited code paths.
