# PR Station -- Red Team Audit

**Date:** 2026-03-29
**Scope:** 37 files (20 source + 17 tests) in PR Station, diff viewer, GitHub API layer, and git handlers
**Persona:** Red Team (Security)

---

## Cross-Reference: SEC-3 Status

The March 28 audit (synthesis-final-report.md) flagged **SEC-3**: `github:fetch` IPC is an open proxy allowing arbitrary GitHub API calls.

**Status: FIXED.** An endpoint/method allowlist was implemented in `src/main/handlers/git-handlers.ts:31-42`. The allowlist restricts:

- GET to `/repos/.../pulls`, `/repos/.../issues`, `/repos/.../commits`, `/repos/.../branches`, `/repos/.../check-runs`
- POST to `/repos/.../pulls/{id}/reviews` and `/repos/.../pulls/{id}/comments`
- PUT to `/repos/.../pulls/{id}/merge`
- PATCH to `/repos/.../pulls/{id}`
- DELETE is entirely blocked
- Non-`api.github.com` hostnames are rejected

Tests in `git-handlers.test.ts:291-421` cover allowlist enforcement including rejection of DELETE, non-allowlisted POST, admin endpoints, and repo deletion.

**Residual issues exist** -- see PR-RED-1 and PR-RED-2 below.

---

## Findings

### Critical

None found.

### High

#### PR-RED-1: Allowlist regex permits overly broad GET reads

**File:** `src/main/handlers/git-handlers.ts:32-36`
**Evidence:**

```typescript
{ method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls/ },
{ method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/issues/ },
{ method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/commits/ },
```

These regexes use prefix matching (`/pulls/` not `/pulls$` or `/pulls?`). This means any GET under these paths is allowed, including:

- `/repos/{owner}/{repo}/pulls/{number}/requested_reviewers` -- reveals who was asked to review
- `/repos/{owner}/{repo}/issues/{number}/reactions` -- reveals who reacted
- `/repos/{owner}/{repo}/commits/{sha}/comments` -- access commit comments
- Any sub-resource under these paths on any repo (not scoped to configured repos)

The allowlist also does not restrict which `owner/repo` combinations can be queried. A compromised renderer can read PR data from any public or accessible private repository, not just the configured ones.

**Severity:** High -- information disclosure beyond intended scope
**Fix:** (1) Anchor regexes more tightly to only allow the specific sub-paths PR Station actually uses. (2) Validate that `owner/repo` matches one of the configured repos from `getConfiguredRepos()`.

---

#### PR-RED-2: PATCH allowlist permits arbitrary PR field mutation

**File:** `src/main/handlers/git-handlers.ts:40`
**Evidence:**

```typescript
{ method: 'PATCH', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+/ },
```

The PATCH pattern allows patching any field on any PR number on any accessible repo. The only PATCH operation PR Station uses is `closePR()` (setting `state: 'closed'`), but the allowlist permits:

- Changing PR title, body, base branch
- Converting a PR to/from draft
- Modifying milestone, labels, assignees (via the PR endpoint)
- These operations on any repo, not just configured ones

**Severity:** High -- write operations beyond intended scope
**Fix:** Either (1) tighten the regex to only match the exact endpoints used, or (2) scope PATCH to configured repos only, or (3) move the `closePR` to a dedicated IPC channel with hardcoded behavior instead of going through the generic proxy.

---

### Medium

#### PR-RED-3: CSS injection via unvalidated PR label colors

**File:** `src/renderer/src/components/pr-station/PRStationDetail.tsx:201`
**Evidence:**

```tsx
style={{ background: `#${label.color}` }}
```

The `label.color` field from the GitHub API is interpolated directly into a CSS `background` property. While the GitHub API normally returns 6-character hex strings, a malicious GitHub App or crafted API response could return unexpected values.

React's `style` prop does provide protection by treating values as property values (not raw CSS text), so semicolon-based injection is blocked. However, `label.color` could contain values that produce unexpected visual results.

**Severity:** Medium (mitigated by React's style prop sanitization, but still a defense-in-depth gap)
**Fix:** Validate `label.color` matches `/^[0-9a-fA-F]{6}$/` before interpolation. The March 28 synthesis report Quick Win #6 already recommended this.

---

#### PR-RED-4: DOMPurify called with default configuration -- no tag/attribute restriction

**File:** `src/renderer/src/lib/render-markdown.ts:20`
**Evidence:**

```typescript
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}
```

DOMPurify with default configuration allows a wide range of HTML tags including `<img>` (with onerror stripped but src allowed), `<a>` (with href), `<form>`, `<input>`, `<table>`, and `<style>` tags. Specifically:

- `<style>` tags are allowed by default and can inject CSS that alters the page layout or creates visual spoofing (e.g., overlaying fake UI elements, hiding the merge button, making the "Approve" radio appear selected)
- `<a href="javascript:...">` is blocked, but `<a href="https://phishing.com">` styled to look like a merge button is not
- `<img src="https://tracker.evil.com/pixel.gif">` enables tracking/exfiltration of the fact that a user is viewing a specific PR

This affects 4 sites where `dangerouslySetInnerHTML` is used with `renderMarkdown()`: PR body (`PRStationDetail.tsx:228`), review bodies (`PRStationReviews.tsx:96`), conversation comments (`PRStationConversation.tsx:73`), and diff comment bodies (`DiffCommentWidget.tsx:36`). All of these render user-authored content from GitHub and the content is sanitized through DOMPurify, which prevents script execution. However, the default DOMPurify configuration is more permissive than needed.

**Severity:** Medium -- CSS injection, tracking pixels, and visual spoofing are possible through PR bodies and review comments authored by any GitHub user
**Fix:** Configure DOMPurify with an explicit allowlist:

```typescript
DOMPurify.sanitize(html, {
  ALLOWED_TAGS: [
    'p',
    'h1',
    'h2',
    'h3',
    'strong',
    'em',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'a',
    'br',
    'blockquote'
  ],
  ALLOWED_ATTR: ['href', 'title', 'class'],
  ALLOW_DATA_ATTR: false
})
```

---

#### PR-RED-5: Merge and close operations lack confirmation dialog

**File:** `src/renderer/src/components/pr-station/MergeButton.tsx:51-65`, `src/renderer/src/components/pr-station/CloseButton.tsx:20-33`
**Evidence:**

`MergeButton.handleMerge()` immediately calls `mergePR()` on click with no confirmation. `CloseButton.handleClose()` immediately calls `closePR()` on click with no confirmation.

These are destructive, irreversible operations on a remote repository. A single misclick merges or closes a PR. The March 28 synthesis report flagged this as UX-4 ("Duplicate merge controls with divergent behavior" -- one had confirmation, this one does not).

**Severity:** Medium -- accidental destructive action on a remote repository
**Fix:** Add a confirmation step using the existing `useConfirm()` hook before executing merge or close operations.

---

#### PR-RED-6: Pending review comments persisted to localStorage without integrity check

**File:** `src/renderer/src/stores/pendingReview.ts:62-73`
**Evidence:**

```typescript
restoreFromStorage: () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, PendingComment[]>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      set({ pendingComments: parsed })
    }
  } catch {
    // Corrupt localStorage -- ignore and start fresh
  }
}
```

The validation only checks that the parsed value is a non-array object. It does not validate the structure of individual `PendingComment` entries. Malformed data in localStorage (from a prior bug, corruption, or if the renderer sandbox is compromised) could inject unexpected properties that propagate to the `createReview` API call in `ReviewSubmitDialog.tsx:35-45`. For example, if `path` contained a very long string or special characters, it would be sent verbatim to the GitHub API.

Additionally, the `body` field of pending comments is displayed via `{pc.body}` in `DiffViewer.tsx:389` as text content (safe), but the data flows to `createReview` where it is JSON-serialized and sent to GitHub -- no length validation.

**Severity:** Medium (low exploitability, but defense-in-depth gap)
**Fix:** Validate individual `PendingComment` fields during restore: check that `id`, `path`, `body` are strings, `line` is a number, `side` is one of `'LEFT' | 'RIGHT'`.

---

### Low

#### PR-RED-7: GitHub API error messages may leak internal details to renderer

**File:** `src/renderer/src/lib/github-api.ts:195-197`, `src/renderer/src/lib/github-api.ts:248-249`, `src/renderer/src/lib/github-api.ts:268-270`
**Evidence:**

```typescript
const err = (res.body ?? {}) as { message?: string }
throw new Error(`Merge failed: ${res.status} -- ${err.message ?? 'unknown'}`)
```

GitHub API error responses can contain internal details (e.g., "Resource not accessible by personal access token", OAuth scope requirements, or internal error IDs). These error messages are surfaced directly to the user via `toast.error()` in `MergeButton.tsx:61`, `CloseButton.tsx:29`, and `ReviewSubmitDialog.tsx:54`. While not a direct vulnerability, this could leak information about token scope/permissions.

**Severity:** Low -- information disclosure via error messages
**Fix:** Map known GitHub error statuses to user-friendly messages. For unknown errors, show a generic message and log the details.

---

#### PR-RED-8: Check run `html_url` not validated as GitHub URL

**File:** `src/renderer/src/components/pr-station/PRStationChecks.tsx:56-64`
**Evidence:**

```tsx
<a
  href={run.html_url}
  target="_blank"
  rel="noopener noreferrer"
  className="pr-detail__check-link"
  title="View on GitHub"
>
```

The `html_url` from check runs is used directly as an href. The main process has a `setWindowOpenHandler` that routes external URLs through `shell.openExternal` (src/main/index.ts:69-72), and `will-navigate` prevents in-frame navigation (src/main/index.ts:79). The window handler in `src/main/handlers/window-handlers.ts:10-16` validates the protocol (blocks non-http/https), which mitigates `file://` and `data:` URLs.

**Severity:** Low (mitigated by existing protocol validation in Electron shell)
**Fix:** Optionally validate that `html_url` starts with `https://github.com/` before rendering the link.

---

#### PR-RED-9: Cache key collision via `includes()` match in `invalidatePRCache`

**File:** `src/renderer/src/lib/github-cache.ts:73-81`
**Evidence:**

```typescript
export function invalidatePRCache(owner: string, repo: string, number: number): void {
  const prefix = `${owner}/${repo}#${number}`
  for (const key of cache.keys()) {
    if (key.includes(prefix)) {
      cache.delete(key)
    }
  }
}
```

The `includes()` check means `invalidatePRCache('owner', 'repo', 1)` would also invalidate cache entries for PR #10, #100, #1234, etc. (since `"owner/repo#1"` is a substring of `"detail:owner/repo#100"`). This is a logic bug, not a security vulnerability per se, but could cause stale cache issues that mask data.

**Severity:** Low (correctness bug that affects cache integrity)
**Fix:** Use a more precise match. For example, ensure the number portion matches exactly by checking for a trailing non-digit or end-of-string after the number.

---

#### PR-RED-10: Renderer-side `owner`/`repo` parameters not validated

**File:** `src/renderer/src/lib/github-api.ts` (entire file)
**Evidence:**

All API functions accept `owner` and `repo` as strings and interpolate them into URL paths:

```typescript
;`/repos/${owner}/${repo}/pulls?state=open&per_page=100`
```

There is no validation that `owner` and `repo` are alphanumeric/dash/underscore. A value containing `/` or URL-encoded characters could construct unintended API paths (e.g., `owner = "../../orgs"` would produce `/repos/../../orgs/{repo}/pulls`).

However, the main process allowlist regexes in `git-handlers.ts` would reject malformed paths that don't match the expected pattern, providing backend defense. The URL constructor in the main process would also normalize path traversal attempts.

**Severity:** Low (mitigated by backend allowlist)
**Fix:** Add a simple alphanumeric+dash validation regex to `owner` and `repo` parameters in the renderer-side functions.

---

#### PR-RED-11: Unused `AbortSignal` parameter in `getPrMergeability`

**File:** `src/renderer/src/lib/github-api.ts:65`
**Evidence:**

```typescript
export async function getPrMergeability(
  owner: string, repo: string, prNumber: number,
  _signal?: AbortSignal
): Promise<PrMergeability> {
```

The `_signal` parameter is accepted but never passed to `githubFetchRaw`. This means the caller cannot abort stale mergeability requests. While not a security vulnerability, it means stale responses could be applied to a different PR if the user navigates quickly, potentially showing incorrect merge status.

**Severity:** Low (stale data display, not exploitable)
**Fix:** Pass `signal` through to the fetch call, or remove the parameter to avoid false safety.

---

### Informational

#### PR-RED-12: No rate limiting on renderer-initiated GitHub API calls

The renderer can fire unlimited parallel requests through the `github:fetch` IPC proxy. `PRStationDetail` fires 5+ concurrent requests on each PR selection (`Promise.allSettled` of detail, files, reviews, review comments, issue comments). Combined with `checkOpenPrsMergeability` which fires N parallel requests (one per PR), a user rapidly clicking through PRs could exhaust the GitHub API rate limit. The main process `github-fetch.ts` has rate-limit awareness and retry logic, but no request queuing or throttling.

#### PR-RED-13: Pending comments stored with `crypto.randomUUID()` IDs

`PRStationDiff.tsx:33` generates comment IDs via `crypto.randomUUID()`. These IDs are used as React keys and for comment removal. This is fine -- `crypto.randomUUID()` is cryptographically random and the IDs are only used locally.

#### PR-RED-14: No CSRF protection on GitHub API mutations

The `github:fetch` proxy injects the GitHub token server-side, but there is no additional CSRF token or nonce. Since the renderer sandbox is disabled (SEC-1 from synthesis report), any code running in the renderer context can invoke `window.api.github.fetch` to perform mutations. This is a direct consequence of SEC-1 (disabled sandbox) and does not introduce additional risk beyond it.

---

## Summary Table

| ID        | Severity | Component                        | Issue                                                                            | Status |
| --------- | -------- | -------------------------------- | -------------------------------------------------------------------------------- | ------ |
| PR-RED-1  | High     | git-handlers.ts                  | Allowlist regex too broad -- allows GET reads on any repo, any sub-path          | Open   |
| PR-RED-2  | High     | git-handlers.ts                  | PATCH allowlist permits arbitrary PR field mutation on any repo                  | Open   |
| PR-RED-3  | Medium   | PRStationDetail.tsx              | CSS injection via unvalidated PR label colors                                    | Open   |
| PR-RED-4  | Medium   | render-markdown.ts               | DOMPurify default config allows style tags, img tracking pixels, visual spoofing | Open   |
| PR-RED-5  | Medium   | MergeButton.tsx, CloseButton.tsx | No confirmation dialog for destructive merge/close operations                    | Open   |
| PR-RED-6  | Medium   | pendingReview.ts                 | localStorage restore lacks field-level validation                                | Open   |
| PR-RED-7  | Low      | github-api.ts                    | GitHub error messages leaked verbatim to user                                    | Open   |
| PR-RED-8  | Low      | PRStationChecks.tsx              | Check run html_url not validated as GitHub URL (mitigated)                       | Open   |
| PR-RED-9  | Low      | github-cache.ts                  | invalidatePRCache uses includes() causing over-invalidation                      | Open   |
| PR-RED-10 | Low      | github-api.ts                    | No renderer-side validation of owner/repo path parameters (mitigated)            | Open   |
| PR-RED-11 | Low      | github-api.ts                    | Unused AbortSignal in getPrMergeability -- stale data risk                       | Open   |
| PR-RED-12 | Info     | github-api.ts                    | No rate limiting on renderer-initiated API calls                                 | Open   |
| PR-RED-13 | Info     | PRStationDiff.tsx                | UUID generation for pending comments -- no issue                                 | N/A    |
| PR-RED-14 | Info     | git-handlers.ts                  | No CSRF on API mutations (consequence of SEC-1)                                  | Open   |

---

## SEC-3 Cross-Reference Verdict

**SEC-3 is remediated** with an allowlist approach. The fix is functional and tested. However, the allowlist has **residual scope issues** (PR-RED-1, PR-RED-2) where the regexes are broader than necessary and not scoped to configured repos. These are not "open proxy" level but represent defense-in-depth gaps.

---

## Recommended Priority

1. **PR-RED-1 + PR-RED-2** (High): Tighten allowlist regexes and add configured-repo scoping
2. **PR-RED-4** (Medium): Configure DOMPurify with explicit tag allowlist -- blocks style tags and img tracking
3. **PR-RED-3** (Medium): Validate label color regex -- simple 1-line fix
4. **PR-RED-5** (Medium): Add confirmation dialogs to merge/close
5. **PR-RED-9** (Low): Fix cache invalidation logic
