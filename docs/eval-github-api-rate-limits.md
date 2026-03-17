# GitHub API Rate Limit Analysis

**Date:** 2026-03-16
**Trigger:** Hit GraphQL 5000 pts/hr limit after ~27 agent runs in one day.
REST 5000 req/hr bucket was NOT exhausted.

---

## 1. Where `gh` CLI (GraphQL) Is Used

### A. Agent prompt templates — `gh pr create` (per-agent)

Every spawned Claude Code agent is instructed to run `gh pr create` at the end of its work.
This appears in all 8 BDE prompt files (`scripts/prompts/bde-*.md`) and all ~25 life-os
prompt files (`life-os/scripts/prompts/*.md`).

**Pattern in every prompt:**
```
gh pr create --base main --title "..." --body "..."
```

Claude Code agents may also call `gh pr create` based on CLAUDE.md `## PR Rules`, even
without explicit prompt instructions — Claude Code's built-in `/commit` skill uses
`gh pr create` by default.

### B. Sprint runner (`run-life-os-sprint.sh`) — `gh pr view` + `gh pr create`

- **`gh pr view $branch`** — called once per task to check if a PR already exists (line 30)
- **`gh pr create`** — called if the branch has work but no PR yet (line 48)

### C. BDE main process (`src/main/git.ts`) — `gh pr view` (polling)

`pollPrStatuses()` (line 159) calls `gh pr view <number> --repo ... --json state,mergedAt`
for every sprint task that has a `pr_url`. This is polled at `POLL_PR_STATUS_MS = 15_000`
(every 15 seconds) from `SprintCenter.tsx` (line 86).

### D. BDE renderer (`src/renderer/src/lib/github-api.ts`) — REST (already!)

`listOpenPRs()` and `mergePR()` already use the REST API directly via `fetch()`. These
do NOT consume GraphQL points. The `PRList` component polls at
`POLL_PR_LIST_INTERVAL = 60_000` (every 60 seconds).

---

## 2. Estimated GraphQL Points Per Agent Run

| Source | Command | Points | Frequency |
|--------|---------|--------|-----------|
| Agent prompt | `gh pr create` | ~3-5 pts | 1x per agent run |
| Agent (Claude Code internals) | `gh pr view` during creation | ~1-2 pts | 1x (implicit) |
| Task runner reconciliation | `gh pr view` | ~1 pt | On restart only |
| Sprint runner (life-os) | `gh pr view` (existence check) | ~1 pt | 1x per task |
| Sprint runner (life-os) | `gh pr create` | ~3-5 pts | 1x per task |

**Estimated per-agent GraphQL cost: ~5-7 points** for a clean run.

### The real problem: BDE's PR status polling

With `POLL_PR_STATUS_MS = 15_000` and N tasks with PR URLs:

| Open PRs being polled | Points/hour |
|----------------------|-------------|
| 5 | 5 × 240 polls/hr × ~1 pt = **1,200 pts/hr** |
| 10 | 10 × 240 × 1 = **2,400 pts/hr** |
| 15 | 15 × 240 × 1 = **3,600 pts/hr** |
| 20 | 20 × 240 × 1 = **4,800 pts/hr** |

**This is almost certainly the primary cause of hitting the limit.** With 27 agent
runs producing PRs, the BDE app was polling 20+ PRs every 15 seconds via `gh pr view`,
burning ~4,800 GraphQL points/hour on status polling alone.

### Daily budget math (27 agents)

| Source | GraphQL pts/day |
|--------|----------------|
| Agent `gh pr create` (27×) | ~135-189 pts |
| BDE PR status polling (20 PRs, 8hr workday) | **~38,400 pts** |
| Sprint runner `gh pr view` checks | ~27 pts |
| **Total** | **~38,500+ pts** |
| **Budget** | 5,000 pts/hr × 24hr = 120,000/day |

The per-hour rate is the binding constraint: 4,800 pts/hr for polling alone leaves
only 200 pts/hr for everything else.

---

## 3. REST API Drop-In Replacements

### A. `gh pr create` → REST POST

**Current (GraphQL via gh CLI):**
```bash
gh pr create --base main --title "..." --body "..." --head "..."
```

**REST replacement (for agent prompts):**
```bash
gh api repos/{owner}/{repo}/pulls \
  --method POST \
  -f title="feat: ..." \
  -f body="..." \
  -f head="agent/branch-name" \
  -f base="main"
```

`gh api` uses REST by default. Output is JSON — the PR URL is in `.html_url`.

To print just the URL:
```bash
gh api repos/{owner}/{repo}/pulls \
  --method POST \
  -f title="..." -f body="..." -f head="..." -f base="main" \
  --jq '.html_url'
```

**Cost: 1 REST request (from the separate 5000 req/hr REST bucket).**

### B. `gh pr view` (PR status polling in git.ts) → REST GET

**Current (GraphQL via gh CLI):**
```bash
gh pr view 123 --repo owner/repo --json state,mergedAt
```

**REST replacement (direct fetch in git.ts):**
```
GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}
```

Response includes `state` ("open"|"closed") and `merged_at` (null or ISO timestamp).
The merged check becomes: `state === "closed" && merged_at !== null`.

Since `github-api.ts` already has `githubFetch()`, this can be implemented in the
renderer or moved to main process with the same pattern.

### C. `gh pr view $branch` (existence check in sprint runner) → REST

**REST replacement:**
```bash
gh api repos/{owner}/{repo}/pulls \
  --method GET \
  -f head="{owner}:{branch}" \
  -f state="open" \
  --jq 'length'
```

Returns `0` if no PR exists, `>0` if it does.

---

## 4. Recommended Changes

### Short-term (immediate — change today)

#### 4a. Convert PR status polling from `gh` CLI to REST fetch

**File:** `src/main/git.ts` — `fetchPrStatusAsync()`

Replace `execFile('gh', ['pr', 'view', ...])` with a direct HTTPS fetch:

```typescript
async function fetchPrStatusRest(pr: PrStatusInput): Promise<PrStatusResult> {
  const parsed = parsePrUrl(pr.prUrl)
  if (!parsed) return { taskId: pr.taskId, merged: false, state: 'unknown', mergedAt: null }
  const token = getGitHubToken() // reuse existing token retrieval
  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  )
  if (!res.ok) return { taskId: pr.taskId, merged: false, state: 'error', mergedAt: null }
  const data = await res.json()
  return {
    taskId: pr.taskId,
    merged: data.state === 'closed' && data.merged_at !== null,
    state: data.merged_at ? 'MERGED' : data.state.toUpperCase(),
    mergedAt: data.merged_at ?? null
  }
}
```

**Impact:** Eliminates ~4,800 GraphQL pts/hr (the main offender). Moves to REST
bucket which was at 0% utilization.

#### 4b. Increase polling interval for merged PRs

**File:** `src/renderer/src/lib/constants.ts`

```typescript
export const POLL_PR_STATUS_MS = 60_000  // was 15_000
```

Even after switching to REST, polling 20 PRs every 15s = 4,800 REST req/hr.
At 60s it's 1,200/hr — much more sustainable.

Better yet: only poll PRs in `OPEN` state. Once merged, stop polling.

#### 4c. Update agent prompt templates to use `gh api` (REST)

**All 8 BDE prompts + all life-os prompts:**

Replace:
```
gh pr create --base main --title "..." --body "..."
```

With:
```
gh api repos/RyanJBirkeland/{REPO}/pulls \
  --method POST \
  -f title="..." \
  -f body="..." \
  -f head="$(git branch --show-current)" \
  -f base="main" \
  --jq '.html_url'
```

### Long-term

#### 4d. Move all PR creation into task-runner.js post-processing

Instead of each agent creating its own PR, the task runner can:
1. Detect the agent pushed commits (it already knows the branch name)
2. Create the PR via REST after the agent exits successfully
3. Extract PR URL and write it to the sprint task

This centralizes all GitHub API calls, makes them auditable, and eliminates
the need for `GH_TOKEN` credential-filling hacks in prompts.

#### 4e. Add rate limit monitoring

Add a pre-flight check in the task runner:
```bash
gh api rate_limit --jq '.resources.graphql.remaining'
```

If remaining < 500, pause agent spawning or switch to REST-only mode.

#### 4f. Batch PR status checks

Instead of N individual `gh pr view` calls, use a single GraphQL query:
```graphql
query {
  repository(owner: "RyanJBirkeland", name: "BDE") {
    pr1: pullRequest(number: 101) { state mergedAt }
    pr2: pullRequest(number: 102) { state mergedAt }
    ...
  }
}
```

One query, one point — regardless of how many PRs. But this only makes sense if
staying on GraphQL. The REST switch (4a) is simpler and sufficient.

---

## 5. Gotchas with REST Replacements

| Issue | Detail | Mitigation |
|-------|--------|------------|
| **Output format** | `gh pr create` prints URL to stdout. `gh api` prints JSON. | Use `--jq '.html_url'` to extract URL |
| **Auth in worktrees** | Worktree agents may not inherit `gh` auth. Current prompts use `GH_TOKEN=$(git credential fill ...)` hack. | `gh api` respects the same `GH_TOKEN` env var — no change needed |
| **PR state naming** | GraphQL returns `MERGED`/`OPEN`/`CLOSED`. REST returns `open`/`closed` + separate `merged_at` field. | Check `state === 'closed' && merged_at !== null` for merged |
| **Error handling** | `gh pr create` prints user-friendly errors. `gh api` returns JSON error bodies. | Parse `response.message` from error JSON |
| **Draft PRs** | `gh pr create --draft` works. REST equivalent: `-f draft=true` | Straightforward mapping |

---

## 6. Summary

| Action | Effort | GraphQL savings |
|--------|--------|----------------|
| Convert `pollPrStatuses` to REST fetch | 30 min | **~4,800 pts/hr** |
| Increase `POLL_PR_STATUS_MS` to 60s | 1 min | 75% reduction in REST calls |
| Update 8 BDE prompt templates to `gh api` | 15 min | ~40 pts/day |
| Update ~25 life-os prompt templates to `gh api` | 30 min | ~125 pts/day |
| Move PR creation into task-runner.js | 2 hr | Centralizes all API calls |
| Add rate limit pre-flight check | 15 min | Early warning system |

**Priority order:** 4a → 4b → 4c → 4d → 4e → 4f

The PR status polling in `git.ts` is the critical fix — it accounts for ~96% of
GraphQL consumption. The agent prompt changes are nice-to-have but low impact by
comparison.
