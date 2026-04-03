# WS1: Fix Dependency Direction

**Date:** 2026-03-20
**Status:** Draft
**Effort:** ~30 minutes
**Dependencies:** None

## Problem

`AgentEvent` and `AgentEventType` are defined in `src/main/agents/types.ts` but used across all process boundaries (shared, preload, renderer). This creates the only dependency direction violation in the codebase — the shared layer imports from main.

### Violation Map

```
src/shared/ipc-channels.ts:11        → imports ../main/agents/types
src/preload/index.ts:6               → imports ../main/agents/types
src/preload/index.d.ts:5             → imports ../main/agents/types
src/renderer/src/stores/agentEvents.ts    → imports main/agents/types
src/renderer/src/components/agents/AgentDetail.tsx   → imports main/agents/types
src/renderer/src/components/agents/ChatRenderer.tsx  → imports main/agents/types
src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx → imports main/agents/types
```

## Solution

Move `AgentEvent` and `AgentEventType` to `src/shared/types.ts` where all other cross-boundary types live. Update import paths in 8 files (7 cross-boundary + 1 main-process). Re-export from `src/main/agents/types.ts` temporarily if any other main-process code imports from there (verify first).

## Changes

### 1. Add types to `src/shared/types.ts`

Move `AgentEventType` (string union) and `AgentEvent` (interface) from `src/main/agents/types.ts` to `src/shared/types.ts`. Place them near other domain types.

### 2. Remove from `src/main/agents/types.ts`

Delete the `AgentEvent` and `AgentEventType` definitions. Keep `AgentProvider`, `AgentHandle`, and any other main-process-only types.

### 3. Update imports in 8 files

| File                                                                 | Old Import               | New Import                            |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------- |
| `src/shared/ipc-channels.ts`                                         | `../main/agents/types`   | `./types`                             |
| `src/preload/index.ts`                                               | `../main/agents/types`   | `../shared/types`                     |
| `src/preload/index.d.ts`                                             | `../main/agents/types`   | `../shared/types`                     |
| `src/main/queue-api/router.ts`                                       | `../agents/types`        | `../../shared/types`                  |
| `src/renderer/src/stores/agentEvents.ts`                             | `main/agents/types` path | `@shared/types` or relative to shared |
| `src/renderer/src/components/agents/AgentDetail.tsx`                 | `main/agents/types` path | `@shared/types` or relative to shared |
| `src/renderer/src/components/agents/ChatRenderer.tsx`                | `main/agents/types` path | `@shared/types` or relative to shared |
| `src/renderer/src/components/agents/__tests__/ChatRenderer.test.tsx` | `main/agents/types` path | `@shared/types` or relative to shared |

### 4. Update remaining main-process consumers

Check if any other files in `src/main/` import `AgentEvent` from `./agents/types` (beyond `queue-api/router.ts` already listed above). If so, update to import from `../../shared/types` or re-export from agents/types for convenience.

## Verification

- `npm run typecheck` passes
- `npm test` passes
- `grep -r "from.*main/agents/types" src/shared src/preload src/renderer` returns zero results

## Risk

Effectively zero. This is a pure import-path refactor with no logic changes.
