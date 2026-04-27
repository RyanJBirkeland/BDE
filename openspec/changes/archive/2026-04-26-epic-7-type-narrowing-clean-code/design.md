## Context

`SprintTask` is BDE's core task record type — 43 fields spanning core identity, agent runtime state, spec/template data, and PR lifecycle data. Four named view types already exist in `src/shared/types/task-types.ts`:

- `SprintTaskCore` — 11 fields: id, status, title, repo, priority, created_at, completed_at, depends_on, tags, epic_id, notes
- `SprintTaskSpec` — Core + spec/template fields (spec, spec_type, prompt, template_name, playground_enabled)
- `SprintTaskExecution` — Core + agent runtime fields (agent_run_id, claimed_by, worktree_path, branch, retry_count, max_runtime_ms, failure_reason, error_context)
- `SprintTaskPR` — Core + PR lifecycle fields (pr_url, pr_number, pr_status, pr_merged_at, rebase_base_sha, review_diff_snapshot)

Despite existing, only 6 call sites use narrow types; the rest pass the full 43-field type. Additionally, several data layer modules compute millisecond durations inline (e.g. `retentionDays * 86400000`) rather than using a shared constant.

## Goals / Non-Goals

**Goals:**
- Narrow return types on the 5–6 highest-value data/service functions where the full type is never needed by callers
- Narrow parameter types in orphan recovery, health check, and PR-poller call sites
- Introduce a single `MS_PER_DAY` constant (and optionally `MS_PER_HOUR`) shared across the data modules that compute time-window cutoffs
- All changes must be compile-clean (`npm run typecheck` passes) and test-clean (`npm test` passes); no runtime behavior changes

**Non-Goals:**
- Mass-replacing every `SprintTask` occurrence (72 sites) — high noise, low signal
- Narrowing the `ISprintTaskRepository` core interface methods (`getTask`, `updateTask`, `createTask`) — those legitimately return/accept the full type since the repository sits at the data boundary
- Narrowing `listTasks()` or `listTasksRecent()` — these are the general-purpose list endpoints used by the renderer
- Changing any runtime data paths

## Decisions

### D1 — Target call sites

High-value narrowing targets (callers only use a handful of fields):

| Function | Current return | Narrowed to | Rationale |
|---|---|---|---|
| `ISprintPollerRepository.listTasksWithOpenPrs()` | `SprintTask[]` | `SprintTaskPR[]` | PR poller only reads pr_number/pr_url/pr_status |
| `ISprintPollerRepository.getOrphanedTasks()` | `SprintTask[]` | `SprintTaskExecution[]` | Orphan recovery reads agent_run_id, claimed_by, worktree_path only |
| `ISprintPollerRepository.getHealthCheckTasks()` | `SprintTask[]` | `SprintTaskCore[]` | Health check reads status + basic identity only |
| `sprint-queue-ops.claimTask()` return | `SprintTask \| null` | `SprintTaskExecution \| null` | Drain loop uses agent_run_id, worktree_path after claim |
| `sprint-pr-ops.listTasksWithOpenPrs()` | `SprintTask[]` | `SprintTaskPR[]` | Matches repository interface narrowing |
| Agent manager `_drainQueuedTasks` parameter | `SprintTask[]` | `SprintTaskExecution[]` | Receives claimed tasks, reads execution fields |

Leave `getQueuedTasks()` returning `SprintTask` — the drain loop's prompt builder consumes spec fields.

### D2 — Named time constants

Introduce `MS_PER_DAY = 24 * 60 * 60 * 1000` and `MS_PER_HOUR = 60 * 60 * 1000` in `src/shared/time.ts` (alongside the existing `nowIso`). Apply at the four inline sites:

- `sprint-maintenance.ts:39` — `retentionDays * 86400000`
- `event-queries.ts:26` — `retentionDays * 24 * 60 * 60 * 1000`
- `task-changes.ts:141` — `daysToKeep * 86400000`
- `sprint-agent-queries.ts:126` — `60 * 60 * 1000` (one-hour lookback)

### D3 — Concrete implementation pattern

TypeScript structural typing means narrowing return types does not require changes to implementations — functions already return values that satisfy both `SprintTask` and `SprintTaskPR` etc. The only code change is the declared return type and matching parameter types at callers. The pattern:

```typescript
// Before
listTasksWithOpenPrs(): SprintTask[]
// After
listTasksWithOpenPrs(): SprintTaskPR[]
```

Both `SprintTask` and `SprintTaskPR` extend `SprintTaskCore`; since `SprintTask` satisfies `SprintTaskPR` structurally, returning `SprintTask` values with a narrowed declared type is valid.

## Risks / Trade-offs

- **Structural subtype risk**: A caller that previously relied on a non-PR field from `listTasksWithOpenPrs()` would get a type error after narrowing. This is the *intended effect* — expose incorrect assumptions. Fix call sites rather than reverting the narrowing.
- **Interface drift**: If new fields are added to `SprintTask` that PR-poller callers need, the narrow type must be widened explicitly. This is preferable to silent over-access.
- **MS_PER_DAY in shared/time.ts vs data/**: Placing it in `shared/time.ts` makes it available to both the renderer and main process if needed. No downside.
