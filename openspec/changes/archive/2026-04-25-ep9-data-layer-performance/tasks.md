## 1. Audit and Fix SELECT * Sites

- [x] 1.1 Grep `src/main/data/` for `SELECT \*` and `SELECT\s+\*` — list every hit
- [x] 1.2 Replace each hit with `SPRINT_TASK_COLUMNS` (full row) or `SPRINT_TASK_LIST_COLUMNS` (no blob) as appropriate — check wave 1 already fixed `listTasksRecent`; fix remaining sites
- [x] 1.3 Add a comment in `sprint-query-constants.ts` warning future authors not to use `SELECT *`

## 2. Post-Claim Targeted Reload

- [x] 2.1 Find the post-claim reload in `src/main/agent-manager/drain-loop.ts` (after `claimTask` succeeds)
- [x] 2.2 Replace any full-catalog reload with `repo.getTask(claimedId)` — single primary-key lookup
- [x] 2.3 Verify existing drain-loop tests still pass

## 3. Incremental Dependency Refresh

- [x] 3.1 Read `src/main/agent-manager/dependency-refresher.ts` fully
- [x] 3.2 Add optional `dirtyTaskIds?: Set<string>` parameter to `refreshDependencyIndex` — when provided, skip re-reading tasks not in the set (unless their fingerprint changed)
- [x] 3.3 Pass the set of claimed task IDs from the drain loop tick to `refreshDependencyIndex`
- [x] 3.4 Add unit test: dirty-set path re-reads only specified tasks

## 4. mapRowsToTasks Export

- [x] 4.1 Ensure `mapRowsToTasks` is exported from `src/main/data/sprint-task-mapper.ts` for callers doing bulk reads
- [x] 4.2 Update any inline `.map(mapRowToTask)` call sites to use `mapRowsToTasks`

## 5. Verification

- [x] 5.1 `npm run typecheck` — zero errors
- [x] 5.2 `npx vitest run --config src/main/vitest.main.config.ts` — all pass
- [x] 5.3 `npm run lint` — zero errors (5 pre-existing errors in `scripts/audit-phase-a.mjs`, unrelated to ep9)
- [x] 5.4 Update `docs/modules/data/index.md` and `docs/modules/agent-manager/index.md` for changed files
