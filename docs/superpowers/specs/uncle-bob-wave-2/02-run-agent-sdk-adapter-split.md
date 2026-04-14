# run-agent.ts + sdk-adapter.ts Split

## Goal

Extract distinct concerns from `src/main/agent-manager/run-agent.ts` (773 LOC) and `src/main/agent-manager/sdk-adapter.ts` (342 LOC) into focused, single-responsibility modules. Separate agent lifecycle orchestration from SDK/CLI spawn logic, message consumption from cost tracking, and prompt assembly from validation.

## Prerequisites

- Task 3 (DB injection seam) must be complete
- Task 1 (AgentManagerImpl split) should be complete — both touch overlapping files

## Motivation (brief)

Both files conflate multiple responsibilities. `run-agent.ts` handles validation, spawning, message consumption, cost tracking, completion resolution, and worktree cleanup in a single flow. `sdk-adapter.ts` mixes SDK spawn logic, CLI fallback, environment setup, and message parsing. Splitting these reduces cognitive load, improves testability, and makes future changes more localized.

## Proposed Module Breakdown

### Extracted from `run-agent.ts`

| New File | Responsibility | Key Exports |
|----------|---------------|-------------|
| `prompt-assembly.ts` | Task validation + prompt context prep | `validateTaskForRun()`, `assembleRunContext()` |
| `message-consumer.ts` | SDK message stream handling, OAuth refresh | `consumeMessages()`, `ConsumeMessagesResult` |
| `agent-telemetry.ts` | Cost/token tracking, SQL persistence | `trackAgentCosts()`, `persistAgentRunTelemetry()` |
| `agent-initialization.ts` | Agent record creation, tracking map registration | `initializeAgentTracking()` |
| `spawn-and-wire.ts` | Spawn orchestration, error recovery | `spawnAndWireAgent()`, `handleSpawnFailure()` |

### Extracted from `sdk-adapter.ts`

| New File | Responsibility | Key Exports |
|----------|---------------|-------------|
| `sdk-message-protocol.ts` | SDK wire protocol type guards + field accessors | `asSDKMessage()`, `getNumericField()`, `isRateLimitMessage()` |
| `spawn-sdk.ts` | `@anthropic-ai/claude-agent-sdk` spawn logic | `spawnViaSdk()` |
| `spawn-cli.ts` | CLI fallback process spawn + line parsing | `spawnViaCli()`, `AGENT_PROCESS_MAX_OLD_SPACE_MB` |

### Already extracted (do NOT re-extract):
- `src/main/agent-manager/completion.ts` — post-run resolution
- `src/main/agent-manager/terminal-handler.ts` — terminal notifications
- `src/main/agent-manager/failure-classifier.ts` — failure classification
- `src/main/sdk-streaming.ts` — SDK streaming utility

## Implementation Steps

1. Create `sdk-message-protocol.ts` — extract message type guards and field accessors from `sdk-adapter.ts` (lines 8–71 approx)
2. Create `spawn-sdk.ts` — extract `spawnViaSdk()` logic
3. Create `spawn-cli.ts` — extract `spawnViaCli()`, `withMaxOldSpaceOption()`, constants
4. Update `sdk-adapter.ts` — import from new modules, keep `spawnAgent()` and `spawnWithTimeout()` as public API (no signature changes)
5. Create `prompt-assembly.ts` — extract validation and context functions from `run-agent.ts`
6. Create `message-consumer.ts` — extract `consumeMessages()` and OAuth refresh handling
7. Create `agent-telemetry.ts` — extract cost tracking and SQL persistence
8. Create `agent-initialization.ts` — extract agent record creation and map registration
9. Create `spawn-and-wire.ts` — extract spawn orchestration and failure handling
10. Update `run-agent.ts` — import from new modules; **`runAgent()`, `RunAgentDeps`, and `ConsumeMessagesResult` signatures must remain identical**
11. Update `docs/modules/agent-manager/index.md` — add rows for new modules

## Files to Change

**Create (8 new files):**
- `src/main/agent-manager/sdk-message-protocol.ts`
- `src/main/agent-manager/spawn-sdk.ts`
- `src/main/agent-manager/spawn-cli.ts`
- `src/main/agent-manager/prompt-assembly.ts`
- `src/main/agent-manager/message-consumer.ts`
- `src/main/agent-manager/agent-telemetry.ts`
- `src/main/agent-manager/agent-initialization.ts`
- `src/main/agent-manager/spawn-and-wire.ts`

**Modify:**
- `src/main/agent-manager/run-agent.ts` — import from new modules, public API unchanged
- `src/main/agent-manager/sdk-adapter.ts` — import from new modules, `spawnAgent()` API unchanged
- `docs/modules/agent-manager/index.md` — add rows for new modules

**Do NOT modify:**
- `src/main/agent-manager/index.ts` — no changes (public exports unchanged)
- Any IPC handler files

## How to Test

Write unit tests for each extracted module in `src/main/agent-manager/__tests__/`:

- **sdk-message-protocol.test.ts** — type guards, field extraction
- **spawn-sdk.test.ts** — session ID tracking with mocked SDK
- **spawn-cli.test.ts** — NODE_OPTIONS manipulation, JSON line parsing, process exit handling
- **prompt-assembly.test.ts** — validation logic, upstream context retrieval, scratchpad handling
- **message-consumer.test.ts** — message iteration, auth error detection, playground path accumulation
- **agent-telemetry.test.ts** — cost field extraction, SQL write mocking
- **agent-initialization.test.ts** — agent record persistence, map registration
- **spawn-and-wire.test.ts** — spawn error paths, worktree cleanup on failure

Existing tests for `run-agent.ts` and `sdk-adapter.ts` must pass unchanged. Public API contract verified by type assertions in tests.

```bash
npm run typecheck && npm test && npm run test:main
```
