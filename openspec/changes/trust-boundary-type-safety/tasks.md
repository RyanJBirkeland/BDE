## 1. SprintTask Row Validation

- [ ] 1.1 Audit all ~40 `SprintTask` fields and define explicit extraction + validation for each in `mapRowToTask` (`src/main/data/sprint-task-mapper.ts:93`)
- [ ] 1.2 Remove the `...row as SprintTask` spread; replace with a fully explicit object literal
- [ ] 1.3 Add `parseRevisionFeedback` return type as `RevisionFeedbackEntry[] | null` (currently declared `): unknown`)
- [ ] 1.4 Write tests: valid row maps correctly; invalid `status` throws; null optional field uses safe default

## 2. Sprint Row Validation

- [ ] 2.1 Create `mapRowToSprint(row: Record<string, unknown>): Sprint` in `src/main/data/sprint-planning-queries.ts`
- [ ] 2.2 Add `isSprintStatus` union guard; throw on invalid `id` or `status`
- [ ] 2.3 Update all Sprint query functions to use `mapRowToSprint` instead of inline field casts
- [ ] 2.4 Write tests: valid row; unknown status throws; null id throws

## 3. AgentRun Row Validation

- [ ] 3.1 Add `isAgentStatus` and `isAgentSource` union-membership guards to `src/main/data/agent-queries.ts`
- [ ] 3.2 Replace `row.status as AgentMeta['status']` and `row.source as AgentMeta['source']` with guard-checked assignments; log and skip rows that fail
- [ ] 3.3 Write tests: known values map correctly; unknown status row is skipped with warning

## 4. TaskGroup Row Validation

- [ ] 4.1 Add `isTaskGroupStatus` guard in `src/main/data/task-group-queries.ts`
- [ ] 4.2 Replace `String(row.status) as TaskGroup['status']` with the guard; fall back to `'draft'` on unknown value with a logged warning
- [ ] 4.3 Write tests: valid status; unknown status defaults to draft with warning logged

## 5. sprint-pr-ops Status Guard

- [ ] 5.1 Add `isTaskStatus(row.status)` guard in `src/main/data/sprint-pr-ops.ts` before the `validateTransition` call
- [ ] 5.2 Skip and warn on rows that fail the guard rather than passing a lying cast
- [ ] 5.3 Write tests: valid status proceeds; invalid status is skipped with warning

## 6. review-repository findings_json Validation

- [ ] 6.1 Add post-parse validation in `src/main/data/review-repository.ts:48` — confirm result is an array before returning
- [ ] 6.2 On validation failure return `[]` and log an error with the task id; do not propagate across IPC
- [ ] 6.3 Write tests: valid array returned; non-array returns `[]` with error logged

## 7. agent-history Import Validation

- [ ] 7.1 Add `isAgentMeta(entry: unknown): entry is AgentMeta` type guard in `src/main/agent-history.ts`
- [ ] 7.2 Replace `JSON.parse(raw) as AgentMeta[]` with: parse → confirm array → filter via `isAgentMeta` → log skipped entries
- [ ] 7.3 Write tests: valid array imports all; corrupt entry skips with warning; non-array exits early with error

## 8. tearoff-window-manager Settings Validation

- [ ] 8.1 Add `isPersistedTearoff(entry: unknown): entry is PersistedTearoff` guard in `src/main/tearoff-window-manager.ts`
- [ ] 8.2 Validate each entry from `getSettingJson('tearoff.windows')` before use; skip and warn on invalid entries
- [ ] 8.3 Write tests: valid entries restore; missing-views entry skipped; startup does not crash on malformed state

## 9. OAuth Refresh Response Validation

- [ ] 9.1 Write `isRefreshResponse(data: unknown): data is RefreshResponse` guard in `src/main/env-utils.ts`
- [ ] 9.2 Apply guard after `await response.json()`; throw descriptive error if guard fails
- [ ] 9.3 Write tests: valid response proceeds; missing `access_token` throws with descriptive error

## 10. GitHub Fetch Response Validation

- [ ] 10.1 Add a `validate?: (item: unknown) => item is T` parameter to the paginated fetch helpers in `src/main/github-fetch.ts`
- [ ] 10.2 Filter items failing the guard (log warning per item); throw if all items fail
- [ ] 10.3 Update the two most critical call sites (PR list, check-runs) to supply `isPullRequest` / `isCheckRun` guards
- [ ] 10.4 Write tests: all items valid returns full array; one invalid filters it out; all invalid throws

## 11. agent-message-classifier Type Guards

- [ ] 11.1 Write `isSdkMessage` and `isContentBlock` type-narrowing guard functions in `src/main/agent-message-classifier.ts`
- [ ] 11.2 Replace all `as`-casts with the guards; add a fallback `unknown` classification for unrecognized shapes
- [ ] 11.3 Validate `contentBlock.input` shape before assigning to `AgentEvent.input`
- [ ] 11.4 Write tests: well-formed message classifies correctly; malformed message with undefined type handled gracefully

## 12. Structured getSettingJson Validators

- [ ] 12.1 Write `isRepoConfigArray`, `isPanelLayout`, and any other needed validators for structured settings keys
- [ ] 12.2 Update call sites in `src/main/index.ts` and `src/main/lib/paths.ts` to pass validators to `getSettingJson`
- [ ] 12.3 Update `getSettingJson` to log a warning and return `null` on validation failure (validator supplied but fails)
- [ ] 12.4 Write tests: valid value passes validator and is returned; invalid value logs warning and returns null

## 13. QueueStats Status Membership Guard

- [ ] 13.1 Add a `isQueueStatsKey(status: string): status is keyof QueueStats` guard in `src/main/data/sprint-agent-queries.ts`
- [ ] 13.2 Use the guard before `stats[row.status as keyof QueueStats]`; skip unknown values with a logged warning
- [ ] 13.3 Write tests: known status increments correct counter; unknown status does not corrupt counts
