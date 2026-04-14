# Agent Manager

Pipeline agent lifecycle orchestration — drain loop, worktree management, watchdog, completion handling.
Source: `src/main/agent-manager/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `sdk-message-protocol.ts` | SDK wire protocol type guards and field accessors | `SDKWireMessage`, `asSDKMessage`, `getNumericField`, `getSessionId`, `isRateLimitMessage` |
| `spawn-sdk.ts` | SDK-based agent spawn — session ID extraction, abort wiring, steer stub | `spawnViaSdk` |
| `spawn-cli.ts` | CLI fallback spawn — stream-json protocol, V8 heap cap, stdin steer | `spawnViaCli`, `withMaxOldSpaceOption`, `AGENT_PROCESS_MAX_OLD_SPACE_MB` |
| `prompt-assembly.ts` | Task validation + prompt context prep — upstream context, scratchpad, prompt build | `validateTaskForRun`, `assembleRunContext`, `fetchUpstreamContext`, `readPriorScratchpad` |
| `message-consumer.ts` | SDK message stream iteration, OAuth refresh on auth error, playground path accumulation | `consumeMessages`, `ConsumeMessagesResult` |
| `agent-telemetry.ts` | Cost/token tracking from SDK messages, SQL persistence of run telemetry | `trackAgentCosts`, `persistAgentRunTelemetry` |
| `agent-initialization.ts` | Agent record creation, stderr wiring, activeAgents registration, agent:started event. `createAgentRecord` failure is logged at `error` level (fire-and-forget: function is synchronous; untracked run is surfaced loudly so operators can investigate) | `initializeAgentTracking` |
| `spawn-and-wire.ts` | Spawn orchestration and error recovery — calls spawnWithTimeout then initializeAgentTracking | `spawnAndWireAgent`, `handleSpawnFailure` |
| `playground-sanitize.ts` (`src/main/`) | DOMPurify-based HTML sanitizer with explicit tag/attr allowlist — blocks iframe, embed, object, style; preserves canvas, svg, audio, video | `sanitizePlaygroundHtml` |
| `playground-handler.ts` | Detects HTML file writes from agents, reads and sanitizes the file, broadcasts `agent:playground` events to renderer | `detectHtmlWrite`, `tryEmitPlaygroundEvent` |
| `oauth-checker.ts` | OAuth token validation with TTL cache — size-guards reads before allocating buffer, proactively refreshes on age | `checkOAuthToken`, `invalidateCheckOAuthTokenCache`, `OAUTH_CHECK_CACHE_TTL_MS` |
| `prompt-sections.ts` | Shared prompt section builders and constants used by all agent prompt builders | `CODING_AGENT_PREAMBLE`, `SPEC_DRAFTING_PREAMBLE`, `buildPersonalitySection`, `buildUpstreamContextSection`, `buildCrossRepoContractSection`, `buildBranchAppendix`, `buildRetryContext`, `buildScratchpadSection`, `truncateSpec` |
| `prompt-pipeline.ts` | Pipeline agent prompt builder | `buildPipelinePrompt`, `classifyTask`, `TaskClass` |
| `prompt-assistant.ts` | Assistant and adhoc agent prompt builder | `buildAssistantPrompt` |
| `prompt-synthesizer.ts` | Synthesizer agent prompt builder (single-turn spec generation) | `buildSynthesizerPrompt` |
| `prompt-copilot.ts` | Copilot agent prompt builder (interactive spec drafting) | `buildCopilotPrompt` |
| `prompt-constants.ts` | Truncation limits for all prompt builders | `PROMPT_TRUNCATION` |
| `pr-operations.ts` | PR find/create operations via gh CLI — check existing, create new with retry/backoff, sanitize titles | `generatePrBody`, `sanitizeForGit`, `checkExistingPr`, `createNewPr`, `findOrCreatePR` |
| `worktree-lifecycle.ts` | Worktree add/remove/prune and branch delete operations | `listWorktrees`, `removeWorktreeForce`, `pruneWorktrees`, `deleteBranch`, `forceDeleteBranchRef`, `addWorktree`, `cleanupWorktreeAndBranch` |
| `index.ts` | `AgentManagerImpl` class — drain loop, watchdog, shutdown, `_validateAndClaimTask` (fresh-status guard), `onTaskTerminal` | `AgentManagerImpl`, `createAgentManager`, `AgentManager`, `AgentManagerStatus` |
| `run-agent.ts` | Orchestrator — delegates to prompt-assembly, message-consumer, agent-telemetry, spawn-and-wire; re-exports public symbols from extracted modules for backward compat | `runAgent`, `consumeMessages`, `validateTaskForRun`, `assembleRunContext`, `fetchUpstreamContext`, `RunAgentDeps`, `RunAgentTask`, `ConsumeMessagesResult` |
| `turn-tracker.ts` | Per-agent token/turn tracking — writes turn records to SQLite via optional `db?: Database.Database` constructor injection (defaults to `getDb()`). | `TurnTracker` |
| `agent-event-mapper.ts` (`src/main/`) | Maps SDK wire-protocol messages to AgentEvents and batches them to SQLite. `flushAgentEventBatcher(db?)` accepts optional db for injection. | `mapRawMessage`, `emitAgentEvent`, `flushAgentEventBatcher` |
| `agent-event-persister.ts` (`src/main/`) | Agent event persistence and broadcast (batcher twin). `flushAgentEventBatcher(db?)` accepts optional db for injection. | `emitAgentEvent`, `flushAgentEventBatcher` |
| `terminal-handler.ts` | Metrics recording and dependency resolution on task terminal events. Provides a `runInTransactionSafe` wrapper so cascade cancellations are atomic | `handleTaskTerminal`, `TerminalHandlerDeps` |
| `orphan-recovery.ts` | Detects tasks stuck in `active` status without a live agent and resets them to `queued` for retry | `recoverOrphans` |
| `completion.ts` | Thin dispatcher for agent task completion. Orchestrates success path (via `resolve-success-phases.ts`) and failure path (via `resolve-failure-phases.ts`). Auto-merge delegated to `auto-merge-coordinator.ts`. Public API surface unchanged — all existing callers import from here | `resolveSuccess`, `resolveFailure`, `findOrCreatePR`, `ResolveSuccessContext`, `ResolveFailureContext` |
| `resolve-success-phases.ts` | Success-path phase functions: worktree verification, branch detection, auto-commit, rebase, commit check, review transition | `verifyWorktreeExists`, `detectAgentBranch`, `autoCommitPendingChanges`, `performRebaseOntoMain`, `hasCommitsAheadOfMain`, `transitionTaskToReview`, `failTaskWithError`, `RebaseOutcome` |
| `resolve-failure-phases.ts` | Failure-path phase: requeue with exponential backoff or mark task permanently failed. Extracted `calculateRetryBackoff` as a pure function | `resolveFailure`, `calculateRetryBackoff`, `ResolveFailureContext` |
| `auto-merge-coordinator.ts` | Evaluates and executes automatic merges after agent completion. Best-effort — failures leave task in `review` for human action | `evaluateAutoMerge`, `AutoMergeContext` |
| `partial-diff-capture.ts` | Captures partial diffs from failed/cancelled agents for diagnostic notes | `capturePartialDiff` |
| `review-transition.ts` | Transitions a completed task to `review` status, preserving worktree path and branch | `transitionToReview`, `TransitionToReviewOpts` |
| `task-mapper.ts` | Maps raw sprint task rows to `RunAgentTask` shape and evaluates hard-dependency blocking | `checkAndBlockDeps`, `mapTaskForAgent` |
| `dependency-refresher.ts` | Rebuilds the in-memory dependency index from SQLite; debounced on task mutations | `refreshDependencyIndex`, `computeDepsFingerprint` |
| `types.ts` | Shared type definitions for agent manager internals | `ActiveAgent`, `AgentHandle`, `AgentManagerConfig`, `ResolveDependentsParams` |
| `drain-loop.ts` | Polling orchestration — precondition checks, dep-index refresh, queued-task fetching and processing | `runDrain`, `validateDrainPreconditions`, `buildTaskStatusMap`, `drainQueuedTasks`, `DrainLoopDeps` |
| `watchdog-loop.ts` | Agent health checks — idle/timeout/rate-limit/cost verdicts, kill helper | `runWatchdog`, `killActiveAgent`, `WatchdogLoopDeps` |
| `task-claimer.ts` | Task claim pipeline — fresh-status guard, dep blocking, repo path resolution, worktree setup, agent spawn | `validateAndClaimTask`, `prepareWorktreeForTask`, `processQueuedTask`, `resolveRepoPath` |
| `worktree-manager.ts` | Worktree prune pass and review-status check helper | `runPruneLoop`, `checkIsReviewTask`, `WorktreeManagerDeps` |
| `shutdown-coordinator.ts` | Graceful shutdown — waits for drain, aborts agents, re-queues active tasks, flushes event batcher | `executeShutdown`, `ShutdownCoordinatorDeps` |
| `config-manager.ts` | Hot-reload settings — updates maxConcurrent, maxRuntimeMs, defaultModel in place; flags worktreeBase as restart-required | `reloadConfiguration`, `ConfigManagerDeps` |
| `wip-tracker.ts` | Thin facade over ConcurrencyState for readable slot queries | `createConcurrencyState`, `getAvailableSlots`, `updateMaxSlots` |
