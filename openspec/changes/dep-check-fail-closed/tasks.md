## 1. Update return type

- [x] 1.1 Add optional `reason?: string` field to the return type of `checkTaskDependencies` (update the inline return type annotation in `dependency-service.ts`)
- [x] 1.2 Add optional `reason?: string` field to the return type of `checkEpicDependencies`
- [x] 1.3 Add optional `reason?: string` field to the return type of `computeBlockState`

## 2. Fix catch blocks — fail closed

- [x] 2.1 In `checkTaskDependencies`, replace `return { shouldBlock: false, blockedBy: [] }` in the catch block with `return { shouldBlock: true, blockedBy: [], reason: 'dep-check-failed: ' + (err instanceof Error ? err.message : String(err)) }`
- [x] 2.2 Emit `logger.event('dependency.check.error', { taskId, error: String(err) })` in that same catch block (after the existing `logger.warn`)
- [x] 2.3 In `checkEpicDependencies`, replace `return { shouldBlock: false, blockedBy: [] }` in the catch block with the same fail-closed return
- [x] 2.4 Emit `logger.event('dependency.check.error', { groupId, error: String(err) })` in the `checkEpicDependencies` catch block

## 3. Propagate reason through computeBlockState

- [x] 3.1 In `computeBlockState`, capture `reason` from `taskResult` when `taskResult.shouldBlock` is true and `taskResult.reason` is set
- [x] 3.2 Capture `reason` from `epicResult` similarly when only the epic check failed
- [x] 3.3 Include `reason` in the final return object when either check produced one

## 4. Update tests

- [x] 4.1 In `dependency-service.test.ts`, update the existing `'returns shouldBlock: false when listTasks fails (graceful degradation)'` test: change assertion to `shouldBlock: true`, add assertion that `reason` starts with `'dep-check-failed: '`, update the test description to reflect fail-closed behavior
- [x] 4.2 Add test: `checkTaskDependencies` returns `shouldBlock: true` with correct `reason` when `areDependenciesSatisfied` throws
- [x] 4.3 Add test: `checkEpicDependencies` returns `shouldBlock: true` with correct `reason` when `listGroups` throws
- [x] 4.4 Add test: `checkEpicDependencies` returns `shouldBlock: true` with correct `reason` when `listTasks` throws
- [x] 4.5 Verify existing happy-path tests (`shouldBlock: false` when deps satisfied, `shouldBlock: true` when deps unsatisfied) still pass without modification
- [x] 4.6 Add test: `computeBlockState` surfaces `reason` in its result when `checkTaskDependencies` returns a fail-closed result

## 5. Verify and update module docs

- [x] 5.1 Run `npm run typecheck` — zero errors required
- [x] 5.2 Run `npm test` — all tests must pass
- [x] 5.3 Run `npm run lint` — zero errors required
- [x] 5.4 Update `docs/modules/services/index.md` row for `dependency-service.ts` to note the updated return type
