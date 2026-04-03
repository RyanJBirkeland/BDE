# PR Station -- Red Team Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** 37 files (20 source + 17 tests) in PR Station, diff viewer, GitHub API layer, and git handlers
**Persona:** Red Team (Security)
**Baseline:** `docs/superpowers/audits/prod-audit/pr-station-red.md` (14 findings)

---

## v1 Finding Verification

### PR-RED-1: Allowlist regex permits overly broad GET reads (High)

**Original:** GET regexes used prefix matching and were not scoped to configured repos.

**Status: Fixed.**

Two changes address this:

1. **Repo scoping** (`git-handlers.ts:112-121`): `getConfiguredRepos()` reads the `repos` JSON setting, builds a Set of `owner/repo` strings, and `isGitHubRequestAllowed()` validates that the extracted `owner/repo` from the API path matches a configured repo. Requests to unconfigured repos are rejected with a log warning.
2. **GET regex breadth** remains unchanged -- the regexes still use prefix matching (e.g., `/^\/repos\/[^/]+\/[^/]+\/pulls/`), allowing access to any sub-path under pulls/issues/commits. However, combined with repo scoping, the blast radius is limited to configured repos only.

**Residual:** GET regex breadth within configured repos (see PR-RED-V2-2).

---

### PR-RED-2: PATCH allowlist permits arbitrary PR field mutation (High)

**Original:** PATCH pattern allowed patching any field on any PR on any repo.

**Status: Fixed.**

Two changes address this:

1. **Repo scoping** (same as PR-RED-1): PATCH requests are now restricted to configured repos.
2. **PATCH body validation** (`git-handlers.ts:73-87, 123-129`): `validatePatchBody()` parses the JSON body and checks that all fields are in `Set(['title', 'body'])`. Non-allowed fields are rejected.

**Regression introduced -- see PR-RED-V2-1 (Critical).**

---

### PR-RED-3: CSS injection via unvalidated PR label colors (Medium)

**Original:** `label.color` interpolated directly into CSS `background` property.

**Status: Fixed.**

`PRStationDetail.tsx:68-71` now uses `safeLabelColor()`:

```typescript
function safeLabelColor(color: string): string {
  return /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : 'var(--neon-text-dim)'
}
```

Labels are rendered at line 214 via `style={{ background: safeLabelColor(label.color) }}`. The regex validates exactly 6 hex characters and falls back to a CSS variable for invalid values.

---

### PR-RED-4: DOMPurify default configuration (Medium)

**Original:** DOMPurify called with no tag/attribute restrictions.

**Status: Fixed.**

`render-markdown.ts:20-39` now configures DOMPurify with an explicit allowlist:

- ALLOWED_TAGS: p, h1, h2, h3, strong, em, code, pre, ul, ol, li, a, br, blockquote
- ALLOWED_ATTR: href, title, class
- ALLOW_DATA_ATTR: false

This blocks `<style>`, `<img>`, `<form>`, `<input>`, and all other tags not in the allowlist. Tracking pixels and CSS injection are no longer possible. All 4 sites that use `renderMarkdown()` with innerHTML (PRStationDetail, PRStationReviews, PRStationConversation, DiffCommentWidget) are protected.

---

### PR-RED-5: Merge and close operations lack confirmation dialog (Medium)

**Original:** Single-click merge/close with no confirmation.

**Status: Fixed.**

Both `MergeButton.tsx` and `CloseButton.tsx` now import `useConfirm` and `ConfirmModal` from `../ui/ConfirmModal`.

- `MergeButton.tsx:57-65`: Calls `await confirm({ title: 'Confirm Merge', message: ..., variant: 'danger' })` before executing. Returns early if not confirmed.
- `CloseButton.tsx:26-33`: Calls `await confirm({ title: 'Confirm Close', message: ..., variant: 'danger' })` before executing. Returns early if not confirmed.
- Both render `<ConfirmModal {...confirmProps} />` in their JSX output.

---

### PR-RED-6: Pending review localStorage restore lacks field-level validation (Medium)

**Original:** Only checked that parsed value was a non-array object.

**Status: Fixed.**

`pendingReview.ts:68-81` now validates individual fields:

```typescript
validated[key] = comments.filter(
  (c) =>
    typeof c.id === 'string' &&
    typeof c.path === 'string' &&
    typeof c.body === 'string' &&
    typeof c.line === 'number' &&
    (c.side === 'LEFT' || c.side === 'RIGHT')
)
```

Invalid entries are silently dropped. Only comments matching the `PendingComment` interface shape are retained.

---

### PR-RED-7: GitHub API error messages leaked verbatim to renderer (Low)

**Original:** Raw GitHub error messages surfaced via `toast.error()`.

**Status: Fixed.**

All mutation functions in `github-api.ts` now use generic error messages:

- `mergePR` (line 198): `"Merge failed: unable to merge pull request (status ${res.status})"`
- `createReview` (line 250): `"Review failed: unable to submit review (status ${res.status})"`
- `closePR` (line 284): `"Close failed: unable to close pull request (status ${res.status})"`
- `replyToComment` (line 271): `"Reply failed: unable to post comment (status ${res.status})"`

Status codes are still exposed (useful for debugging), but internal GitHub error details are no longer leaked.

---

### PR-RED-8: Check run `html_url` not validated as GitHub URL (Low)

**Original:** `html_url` used as href without origin validation.

**Status: Fixed.**

`PRStationChecks.tsx:55` now validates the URL origin:

```tsx
{run.html_url && run.html_url.startsWith('https://github.com/') && (
```

Links with non-GitHub URLs are simply not rendered. Combined with the existing Electron `setWindowOpenHandler` protocol validation, this provides defense-in-depth.

---

### PR-RED-9: Cache key collision via `includes()` match in `invalidatePRCache` (Low)

**Original:** `includes()` caused PR #1 invalidation to also invalidate PR #10, #100, etc.

**Status: Fixed.**

`github-cache.ts:73-82` now uses exact matching after the colon separator:

```typescript
const colonIndex = key.indexOf(':')
if (colonIndex !== -1 && key.substring(colonIndex + 1) === prefix) {
  cache.delete(key)
}
```

With cache keys in format `detail:owner/repo#42`, this extracts the portion after the first colon and compares with strict equality. PR #1 no longer collides with PR #10.

---

### PR-RED-10: Renderer-side owner/repo parameters not validated (Low)

**Original:** No validation of owner/repo strings in renderer-side API functions.

**Status: Partially Fixed.**

The renderer-side `github-api.ts` still does not validate `owner` and `repo` parameters. However, the backend allowlist now enforces (1) regex pattern matching on the path and (2) configured repo scoping. A path traversal attempt like `owner = "../../orgs"` would fail the `extractRepoFromPath` regex (which expects `[^/]+` segments) and would not match any configured repo.

**Residual:** No renderer-side input validation, but backend defense is effective.

---

### PR-RED-11: Unused AbortSignal parameter in getPrMergeability (Low)

**Original:** `_signal` parameter accepted but never passed to fetch.

**Status: Fixed.**

The `_signal` parameter has been removed entirely from `getPrMergeability` (line 64-68 of `github-api.ts`). The function signature is now `(owner, repo, prNumber)`.

---

### PR-RED-12: No rate limiting on renderer-initiated GitHub API calls (Info)

**Status: Not Fixed.**

No rate limiting or request queuing has been added. The renderer can still fire unlimited parallel requests through `github:fetch` IPC. The `pr-poller.ts` has exponential backoff on errors (lines 101-114), but this only applies to the main-process poller, not renderer-initiated requests.

---

### PR-RED-13: Pending comments stored with crypto.randomUUID() IDs (Info)

**Status: N/A (no issue).**

---

### PR-RED-14: No CSRF protection on GitHub API mutations (Info)

**Status: Not Fixed.**

Still a consequence of disabled renderer sandbox (SEC-1). No additional mitigation.

---

## New Findings

### Critical

#### PR-RED-V2-1: PATCH body validation rejects `closePR()` -- regression breaks Close button

**File:** `src/main/handlers/git-handlers.ts:73-87, 123-129` and `src/renderer/src/lib/github-api.ts:276-286`
**Evidence:**

The `closePR()` function sends:

```typescript
body: JSON.stringify({ state: 'closed' })
```

The `validatePatchBody()` function allows only `title` and `body` fields:

```typescript
const allowedFields = new Set(['title', 'body'])
```

When `closePR()` fires `PATCH /repos/{owner}/{repo}/pulls/{number}`, the body validation at line 124 checks for exact path match (`/pulls/\d+$`) and calls `validatePatchBody()`. Since `state` is not in `allowedFields`, the request is rejected with `"PATCH body contains disallowed fields"`.

This means the Close button's confirmation dialog works, but the actual close operation fails at the IPC layer. The toast will show a generic error, but the PR remains open.

**Severity:** Critical -- regression that silently breaks a core feature
**Fix:** Add `'state'` to the `allowedFields` Set in `validatePatchBody()`. The allowed values for `state` on the GitHub Pulls PATCH endpoint are `'open'` and `'closed'`, both of which are legitimate operations.

---

### High

#### PR-RED-V2-2: Allowlist test suite does not mock configured repos -- tests pass vacuously

**File:** `src/main/handlers/__tests__/git-handlers.test.ts:291-421`
**Evidence:**

The allowlist tests use `owner/repo` in API paths (e.g., `/repos/owner/repo/pulls`) but do not mock `getSettingJson('repos')` to return a configured repo list containing `owner/repo`. Since `getSettingJson` is not mocked, `getConfiguredRepos()` returns an empty Set. This means:

1. Tests that expect requests to **succeed** (lines 297-375) should now **fail** because the repo `owner/repo` is not in the configured Set.
2. Tests that expect requests to be **rejected** (lines 377-420) pass, but for the wrong reason (repo not configured, not pattern mismatch).

If these tests are passing in CI, it suggests either (a) the real `getSettingJson` returns repo data from the test environment's SQLite, or (b) there is an import-order issue where the repo scoping code is not being exercised. Either way, the test suite does not properly validate the allowlist logic.

**Severity:** High -- security-critical code lacks meaningful test coverage
**Fix:** Add `vi.mock('../../settings', ...)` to the test file and set up `getSettingJson` to return `[{ githubOwner: 'owner', githubRepo: 'repo', name: 'repo', localPath: '/tmp/repo' }]` for the allowlist tests. Also add dedicated tests for: (a) requests to unconfigured repos being rejected, (b) `closePR` body (`{ state: 'closed' }`) being allowed, (c) arbitrary PATCH fields being rejected.

---

### Medium

#### PR-RED-V2-3: No test coverage for PATCH body validation logic

**File:** `src/main/handlers/__tests__/git-handlers.test.ts`
**Evidence:**

There are zero tests for PATCH body validation behavior. The following scenarios are untested:

- PATCH with `{ state: 'closed' }` (should succeed after fix)
- PATCH with `{ title: 'new title' }` (should succeed)
- PATCH with `{ base: 'other-branch' }` (should fail)
- PATCH with `{ state: 'closed', labels: [...] }` (should fail -- mixed allowed/disallowed)
- PATCH with unparseable body (should fail)

**Severity:** Medium -- untested security boundary
**Fix:** Add dedicated test cases for `validatePatchBody` logic covering all edge cases.

---

### Low

#### PR-RED-V2-4: Exponential backoff in PR poller creates double-poll on tick

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

Each tick clears the interval and creates a new one with the current `backoffDelay`. However, the callback both creates a new interval AND calls `safePoll()` immediately. This means every backoff adjustment tick fires an extra poll. Not a security vulnerability, but could cause unexpected double-polls during error recovery.

**Severity:** Low -- minor timing anomaly
**Fix:** Restructure to use `setTimeout` recursion instead of `setInterval` replacement, which is simpler and avoids the double-fire.

---

## Summary Table

| ID          | Severity     | Status              | Component               | Issue                                              |
| ----------- | ------------ | ------------------- | ----------------------- | -------------------------------------------------- |
| PR-RED-1    | High         | **Fixed**           | git-handlers.ts         | Allowlist regex too broad + no repo scoping        |
| PR-RED-2    | High         | **Fixed**           | git-handlers.ts         | PATCH allowlist permits arbitrary mutation         |
| PR-RED-3    | Medium       | **Fixed**           | PRStationDetail.tsx     | CSS injection via label colors                     |
| PR-RED-4    | Medium       | **Fixed**           | render-markdown.ts      | DOMPurify default config too permissive            |
| PR-RED-5    | Medium       | **Fixed**           | MergeButton/CloseButton | No confirmation dialog                             |
| PR-RED-6    | Medium       | **Fixed**           | pendingReview.ts        | localStorage restore lacks validation              |
| PR-RED-7    | Low          | **Fixed**           | github-api.ts           | Error messages leaked verbatim                     |
| PR-RED-8    | Low          | **Fixed**           | PRStationChecks.tsx     | html_url not validated                             |
| PR-RED-9    | Low          | **Fixed**           | github-cache.ts         | Cache key over-invalidation                        |
| PR-RED-10   | Low          | **Partially Fixed** | github-api.ts           | No renderer-side owner/repo validation             |
| PR-RED-11   | Low          | **Fixed**           | github-api.ts           | Unused AbortSignal parameter                       |
| PR-RED-12   | Info         | **Not Fixed**       | github-api.ts           | No rate limiting                                   |
| PR-RED-13   | Info         | **N/A**             | PRStationDiff.tsx       | UUID generation (no issue)                         |
| PR-RED-14   | Info         | **Not Fixed**       | git-handlers.ts         | No CSRF protection                                 |
| PR-RED-V2-1 | **Critical** | **New**             | git-handlers.ts         | PATCH body validation rejects closePR (regression) |
| PR-RED-V2-2 | **High**     | **New**             | git-handlers.test.ts    | Allowlist tests don't mock configured repos        |
| PR-RED-V2-3 | **Medium**   | **New**             | git-handlers.test.ts    | Zero test coverage for PATCH body validation       |
| PR-RED-V2-4 | **Low**      | **New**             | pr-poller.ts            | Backoff timer creates double-poll on tick          |

---

## Overall Assessment

**Remediation quality: Good with one critical regression.**

10 of 14 original findings are fully fixed. The fixes for DOMPurify (PR-RED-4), label color validation (PR-RED-3), confirmation dialogs (PR-RED-5), error message sanitization (PR-RED-7), cache key collision (PR-RED-9), html_url validation (PR-RED-8), and pending review validation (PR-RED-6) are all clean and well-implemented.

The allowlist fixes for PR-RED-1 and PR-RED-2 are architecturally sound -- repo scoping and PATCH body validation are the right approaches. However, the PATCH body validation introduces a **critical regression** (PR-RED-V2-1): `closePR()` sends `{ state: 'closed' }` which is not in the allowed fields, breaking the Close PR feature. The fix is trivial (add `'state'` to the allowed fields), but the fact that this was not caught exposes the second issue (PR-RED-V2-2): the test suite does not properly exercise the new security code because it never mocks `getSettingJson` to set up configured repos.

**Recommended priority:**

1. **PR-RED-V2-1** (Critical): Add `'state'` to `validatePatchBody` allowed fields -- 1-line fix
2. **PR-RED-V2-2** (High): Fix allowlist test mocks to properly validate security boundaries
3. **PR-RED-V2-3** (Medium): Add PATCH body validation test cases
4. **PR-RED-V2-4** (Low): Clean up poller backoff logic

**Score: 10/14 original findings fixed, 1 partially fixed, 2 info-level not fixed (acceptable), 1 critical regression, 1 high test gap introduced.**
