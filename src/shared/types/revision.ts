/**
 * Structured revision feedback — replaces freeform notes in retry prompts.
 *
 * Pipeline agents that fail pre-review verification receive a `RevisionFeedback`
 * object serialised into `task.notes` so the retry agent gets unambiguous,
 * machine-readable diagnostics instead of raw tool output.
 */

export interface RevisionFeedback {
  summary: string
  diagnostics: RevisionDiagnostic[]
}

export interface RevisionDiagnostic {
  /** Relative file path (e.g. `src/foo.ts`). */
  file: string
  /** 1-based line number when available. */
  line?: number
  kind: 'typecheck' | 'test' | 'missing-file' | 'syntax' | 'other'
  /** Verbatim tool output preferred. */
  message: string
  suggestedFix?: string
}
