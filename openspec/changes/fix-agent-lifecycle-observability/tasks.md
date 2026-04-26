## 1. Fix agent.completed status field (T-9)

- [x] 1.1 In `src/main/agent-manager/run-agent.ts`, after the `await resolveAgentExit(...)` call in `finalizeAgentRun`, add `const finalTask = deps.repo.getTask(task.id)` and `const finalStatus = finalTask?.status ?? 'unknown'`
- [x] 1.2 Replace the hardcoded `status: 'review'` in the `logger.event('agent.completed', ...)` call with `status: finalStatus`
- [x] 1.3 Run `npm run typecheck` — zero errors

## 2. Add taskId to agent:error abort events (T-103)

- [x] 2.1 Confirm that the `AgentEvent` / `agent:error` type in `src/main/agent-event-mapper.ts` or `src/shared/` includes an optional `taskId` field (it should — other callers include it)
- [x] 2.2 In `src/main/agent-manager/message-consumer.ts` max-turns abort block (~line 246), add `taskId: task.id` to the `emitAgentEvent` payload
- [x] 2.3 In `src/main/agent-manager/message-consumer.ts` budget-cap abort block (~line 265), add `taskId: task.id` to the `emitAgentEvent` payload
- [x] 2.4 Run `npm run typecheck` — zero errors

## 3. Log every successful status transition (T-117)

- [x] 3.1 In `src/main/services/task-state-service.ts`, immediately after the `updateTask(taskId, patch, { caller: callerAttribution })` call in `transition()`, add `this.logger.info(\`[task-state] task ${taskId}: ${currentStatus} → ${targetStatus} (caller=${callerAttribution})\`)`
- [x] 3.2 Run `npm run typecheck` — zero errors

## 4. Emit structured event on auto-complete (T-96)

- [x] 4.1 In `src/main/agent-manager/task-claimer.ts`, locate `skipIfAlreadyOnMain` — the `try` block that calls `deps.taskStateService.transition(task.id, 'done', ...)`
- [x] 4.2 After the `try` block exits successfully (before `return true`), add `deps.logger.event('task.auto-complete', { taskId: task.id, sha: match.sha, matchedOn: match.matchedOn })`
- [x] 4.3 Run `npm run typecheck` — zero errors

## 5. Log task-claimed line before agent dispatch (T-97)

- [x] 5.1 In `src/main/agent-manager/task-claimer.ts`, inside `processQueuedTask`, immediately before `await deps.spawnAgent(task, wt, repoPath)`, add `deps.logger.info(\`[agent-manager] Task ${task.id} claimed — spawning agent in ${wt.worktreePath}\`)`
- [x] 5.2 Run `npm run typecheck` — zero errors

## 6. Verification

- [x] 6.1 Run `npm test` — all tests pass
- [x] 6.2 Run `npm run test:main` — all tests pass
- [x] 6.3 Run `npm run lint` — zero errors
- [x] 6.4 Update `docs/modules/agent-manager/index.md` row for `run-agent.ts`, `message-consumer.ts`, and `task-claimer.ts` to note the new observability emissions
- [x] 6.5 Update `docs/modules/services/index.md` row for `task-state-service.ts` to note transition logging
