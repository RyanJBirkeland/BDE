# Split useSingleTaskReviewActions into Focused Hooks

## Context
`src/renderer/src/hooks/useSingleTaskReviewActions.ts` is 250+ lines and owns six distinct concerns: state management (loading flags, confirmation dialogs), modal orchestration (discard confirm, PR form), polling for PR status, navigation (view routing after action), and 6 discrete review actions (shipIt, mergeLocally, createPr, requestRevision, rebase, discard). It was flagged by 2 audit lenses (SRP, cohesion).

## Goal
Decompose into focused hooks with single responsibilities. The public API consumed by `CodeReviewView.tsx` must not change — the parent component should continue receiving the same shape of props/callbacks.

## Proposed Decomposition

- `useReviewActionModals.ts` — confirmation dialog state, discard modal, PR form modal open/close state. No IPC calls.
- `useReviewActionState.ts` — loading flags (`isShipping`, `isMerging`, etc.), error state per action. No IPC calls.
- `useReviewPolling.ts` — polls PR status for the active task, returns current PR state. Uses `useBackoffInterval`.
- Individual action hooks (or a single `useReviewActionCallbacks.ts`) — each action function calls IPC and on success updates state via the above hooks. Keep actions co-located unless they naturally separate.
- `useSingleTaskReviewActions.ts` — becomes a composition hook: imports and composes the above, returns the unified interface expected by consumers.

## Files to Change

**Create:**
- `src/renderer/src/hooks/useReviewActionModals.ts`
- `src/renderer/src/hooks/useReviewActionState.ts`
- `src/renderer/src/hooks/useReviewPolling.ts`
- `src/renderer/src/hooks/useReviewActionCallbacks.ts` (or keep callbacks in the main hook if they're tightly coupled to state)

**Modify:**
- `src/renderer/src/hooks/useSingleTaskReviewActions.ts` — reduce to composition only, ~30–50 lines
- No changes to consumers (`CodeReviewView.tsx`, `ReviewDetail.tsx`, etc.) — the returned interface must remain identical

## Instructions
1. Read `useSingleTaskReviewActions.ts` in full first.
2. Read all files that import from it to understand the required return shape.
3. Identify natural split boundaries by running a mental "what reasons does this hook have to change?" test.
4. Extract one hook at a time, running `npm run typecheck` after each extraction.
5. The composition hook must produce an identical return value — use TypeScript to enforce this by keeping the return type annotation unchanged.

## How to Test
- `npm run typecheck` must pass.
- `npm test` must pass (the review hooks likely have unit tests — do not delete them).
- `npm run lint` must pass.
- Manually test all 6 review actions in Code Review Station: Ship It, Merge Locally, Create PR, Request Revision, Rebase, Discard. Each should work identically to before.
