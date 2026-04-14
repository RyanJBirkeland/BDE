# Lib — Renderer

Utility functions and shared helpers for the renderer process.
Source: `src/renderer/src/lib/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `optimisticUpdateManager.ts` | Pure functions for managing optimistic update state in the sprint tasks store. No Zustand dependency. | `mergePendingFields`, `expirePendingUpdates`, `trackPendingOperation` |
