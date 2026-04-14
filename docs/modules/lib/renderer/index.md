# Lib — Renderer

Utility functions and shared helpers for the renderer process.
Source: `src/renderer/src/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `dashboard-types.ts` | Shared dashboard domain types used by stores and components. Owns `FeedEvent` to keep the store layer free of component imports. | `FeedEvent` |
| `optimisticUpdateManager.ts` | Pure functions for managing optimistic update state in the sprint tasks store. No Zustand dependency. | `mergePendingFields`, `expirePendingUpdates`, `trackPendingOperation` |
| `task-status-ui.ts` | Backward-compatible re-export shim. `STATUS_METADATA`, `BucketKey`, and `StatusMetadata` now live in `src/shared/task-statuses.ts`; this file re-exports them for renderer callers. | `STATUS_METADATA`, `BucketKey`, `StatusMetadata` |
