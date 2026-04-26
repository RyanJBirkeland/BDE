## 1. Shared Types

- [x] 1.1 Add `'unknown'` to the `CheckStatus` union in `src/shared/types/git-types.ts`
- [x] 1.2 Add optional `repoErrors?: Record<string, string>` to `PrListPayload` in `src/shared/types/git-types.ts`

## 2. Direct Dependency

- [x] 2.1 Add `"p-limit": "^3.1.0"` to the `dependencies` section of `package.json` and run `npm install` to update the lock file

## 3. Core Poller Changes (T-112, T-113, T-114, T-115)

- [x] 3.1 Change `fetchOpenPrs` return type to `{ prs: OpenPr[]; error?: string }` and return `{ prs: [], error: getErrorMessage(err) }` in the catch block instead of `[]`
- [x] 3.2 In `fetchCheckRuns`, replace the `empty` sentinel `{ status: 'pending', … }` with `{ status: 'unknown', total: 0, passed: 0, failed: 0, pending: 0 }` returned when `!result.ok`
- [x] 3.3 Import `pLimit` from `'p-limit'` at the top of `src/main/pr-poller.ts`
- [x] 3.4 In `poll()`, create `const limit = pLimit(4)` and wrap each `fetchCheckRuns` call with `limit(() => fetchCheckRuns(…))`
- [x] 3.5 In `poll()`, add `const startMs = Date.now()` before the repo fetches and a `logger.info('pr-poller: poll started', { repos: repos.length })` call
- [x] 3.6 In `poll()`, collect per-repo errors from the `fetchOpenPrs` results into a `repoErrors: Record<string, string>` map and include it in `latestPayload`
- [x] 3.7 At the end of `poll()` (after setting `latestPayload`), add `logger.info('pr-poller: poll completed', { prs: prs.length, repos: repos.length, durationMs: Date.now() - startMs })`

## 4. Test Updates

- [x] 4.1 In `src/main/__tests__/pr-poller.test.ts`, update the assertion on line ~233 (`handles check run fetch failure gracefully`) from `toBe('pending')` to `toBe('unknown')`
- [x] 4.2 Update the assertion on line ~389 (`degrades gracefully when check-run fetch returns 5xx`) from `toBe('pending')` to `toBe('unknown')`
- [x] 4.3 Add test: `'surfaces fetchOpenPrs error in repoErrors on the payload (T-112)'` — mock `fetchAllGitHubPages` to throw, assert `result.repoErrors` contains the repo key with an error string
- [x] 4.4 Add test: `'check-run fetches are capped at 4 concurrent calls (T-114)'` — use a deferred promise to stall fetches and assert the 5th call does not start until one of the first 4 resolves
- [x] 4.5 Add test: `'poll() logs start and completion with PR count and durationMs per cycle (T-115)'` — assert `mockLogger.info` is called twice with expected field shapes

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors required
- [x] 5.2 Run `npm test` — all tests must pass (including the updated and new pr-poller tests)
- [x] 5.3 Run `npm run lint` — zero errors required
