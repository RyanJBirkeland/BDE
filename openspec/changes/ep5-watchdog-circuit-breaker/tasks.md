## 1. Spawn-Phase Circuit Breaker Scope

- [x] 1.1 Read `src/main/agent-manager/run-agent.ts` and `drain-loop.ts` — find where circuit breaker is incremented
- [x] 1.2 Add a `spawnSucceeded: boolean` flag to `RunAgentResult` (or use a try/catch boundary in `runAgent` to distinguish spawn vs stream phase)
- [x] 1.3 Only increment the circuit breaker when `spawnSucceeded === false` — stream/cleanup failures do NOT count
- [x] 1.4 Circuit breaker OPEN log: include `{ triggeringTask, recentFailures: [{taskId, reason}] }` in the structured event
- [x] 1.5 Unit test: stream error → breaker NOT incremented; spawn error → breaker IS incremented

## 2. Fast-Fail Sliding Window

- [x] 2.1 Find fast-fail tracking in `AgentManagerImpl` (now in `ErrorRegistry` after EP-2)
- [x] 2.2 Replace simple count with `Map<taskId, { ts: number; reason: string }[]>` — timestamped entries per task
- [x] 2.3 Evict entries older than `FAST_FAIL_WINDOW_MS` (30s) before evaluating count
- [x] 2.4 Unit tests: old failure not counted; 3 within 30s exhausts; clock jump (>30s) resets window

## 3. Watchdog Idempotency

- [x] 3.1 In `runWatchdog` in `watchdog-loop.ts`, add check before terminal dispatch: `if (!activeAgents.has(agentRunId)) { logger.debug('watchdog: agent already removed, skipping terminal'); return }`
- [x] 3.2 Unit test: terminal notify called exactly once even when orphan recovery races watchdog

## 4. classifyExit Debug Logging

- [x] 4.1 In `src/main/agent-manager/failure-classifier.ts`, add `logger.debug('[failure-classifier] matched', { pattern: p.name, verdict, taskId })` on each pattern match
- [x] 4.2 Determinize classifier test precedence: ensure tests assert the specific pattern name matched, not just the verdict

## 5. Verification

- [x] 5.1 `npm run typecheck` zero errors
- [x] 5.2 `npx vitest run --config src/main/vitest.main.config.ts` all pass
- [x] 5.3 `npm run lint` zero errors
- [x] 5.4 Update `docs/modules/agent-manager/index.md` for changed files

> Phase A invariant: this change satisfies the **force-kill escalation reaches SIGKILL on shutdown** invariant in `pipeline-stop-the-bleeding/specs/pipeline-correctness-baseline/spec.md`.
