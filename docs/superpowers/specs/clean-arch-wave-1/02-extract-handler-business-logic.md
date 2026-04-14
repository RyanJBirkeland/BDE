# Extract Business Logic from 3 IPC Handlers

## Context
Three IPC handlers contain business logic that belongs in services. Each was identified by the ipc-thin audit lens. All three are straightforward extractive refactors — move logic into a service file, call the service from the handler.

## Goal
Each handler becomes a thin wrapper. Three new service files are created. No behavior changes.

## Handler 1: agent-handlers.ts — Adhoc Promotion Logic

**Location:** `src/main/handlers/agent-handlers.ts:124–193`
**Problem:** The `agent:promoteToTask` handler performs git validation (commit count check), string transformation (title truncation/derivation from commit message), and sprint task creation — all inline.
**Fix:** Create `src/main/services/adhoc-promotion-service.ts` with a `promoteAdhocToTask(agentId, repoPath, overrides)` function. Handler calls the service, returns result.

## Handler 2: webhook-handlers.ts — Webhook Test Delivery

**Location:** `src/main/handlers/webhook-handlers.ts:124–171`
**Problem:** The `webhook:test` handler constructs the test event payload, computes the HMAC-SHA256 signature, and makes the HTTP POST request — all inline.
**Fix:** Create `src/main/services/webhook-delivery-service.ts` with a `deliverWebhookTestEvent(config, eventType)` function. Handler calls the service.

## Handler 3: agent-manager-handlers.ts — Checkpoint Orchestration

**Location:** `src/main/handlers/agent-manager-handlers.ts:55–98`
**Problem:** The `agentManager:checkpoint` handler stages diffs, validates commit message, and executes the git commit — inline orchestration.
**Fix:** Create `src/main/services/checkpoint-service.ts` with a `createCheckpoint(taskId, worktreePath, message)` function. Handler calls the service.

## Files to Change

**Create:**
- `src/main/services/adhoc-promotion-service.ts`
- `src/main/services/webhook-delivery-service.ts`
- `src/main/services/checkpoint-service.ts`

**Modify:**
- `src/main/handlers/agent-handlers.ts` — replace inline logic with service call
- `src/main/handlers/webhook-handlers.ts` — replace inline logic with service call
- `src/main/handlers/agent-manager-handlers.ts` — replace inline logic with service call

## Instructions
1. Read each handler file before touching it.
2. For each handler: copy the logic verbatim into the service file first, then replace the handler body with a single service call.
3. Each service function should accept the minimum parameters needed (not the full IPC event).
4. Use `createLogger('adhoc-promotion-service')` etc. in new service files.
5. All three can be done independently — order doesn't matter.

## How to Test
- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run lint` must pass.
- Manually test each feature: (1) promote an adhoc agent session to a sprint task, (2) send a test webhook from Settings, (3) trigger a checkpoint from an active agent.
