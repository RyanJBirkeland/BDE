# revision

**Layer:** Shared
**Source:** `src/shared/types/revision.ts`

## Purpose

Structured revision feedback for pipeline retry prompts. When pre-review verification fails, diagnostics are serialized into `sprint_tasks.notes` so retry agents receive machine-readable feedback instead of raw stderr.

## Public API

- `RevisionFeedback` — Object carrying `summary: string` and `diagnostics: RevisionDiagnostic[]`
- `RevisionDiagnostic` — Single diagnostic entry with `file`, optional `line`, `kind`, `message`, and optional `suggestedFix`
- `parseRevisionFeedback(notes)` — Deserializes a task's notes field as RevisionFeedback; returns null if not valid JSON or not a RevisionFeedback shape
- `isRevisionFeedback(value)` — Type guard for RevisionFeedback objects

## Key Dependencies

- None (pure types and validation functions)
