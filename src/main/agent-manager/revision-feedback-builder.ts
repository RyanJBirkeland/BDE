/**
 * revision-feedback-builder.ts — Parses raw tool output into structured RevisionFeedback.
 *
 * Pipeline failures produce raw stderr strings (typecheck errors, test failures,
 * missing-file notes, etc.). This module turns that unstructured text into a
 * RevisionFeedback object so retry-prompt builders can render machine-readable
 * diagnostics rather than a blob of text.
 */

import type { RevisionDiagnostic, RevisionFeedback } from '../../shared/types/revision'
import type { VerificationFailureKind } from './verify-worktree'

// ---------------------------------------------------------------------------
// TypeScript error parsing
//
// Two formats emitted by tsc:
//   Modern:  "src/foo.ts(10,5): error TS2304: Cannot find name 'X'."
//   Legacy:  "src/foo.ts:10:5 - error TS2304: Cannot find name 'X'."
// ---------------------------------------------------------------------------

// Matches "src/foo.ts(10,5): error TS2304: message" (tsc modern format)
const MODERN_TS_ERROR_RE =
  /^([^\s(]+)\((\d+),\d+\):\s+(?:error|warning)\s+TS\d+:\s+(.+)$/

// Matches "src/foo.ts:10:5 - error TS2304: message" (tsc legacy format)
const LEGACY_TS_ERROR_RE =
  /^([^\s:]+):(\d+):\d+\s+-\s+(?:error|warning)\s+TS\d+:\s+(.+)$/

// Matches "FAIL src/foo.test.ts" (vitest/jest test suite failure header)
const TEST_SUITE_FAIL_RE = /^(?:FAIL|×)\s+(\S+\.test\.[jt]sx?)(?:\s|$)/

// Matches "● TestSuite > test name" (vitest error block header)
const VITEST_BLOCK_HEADER_RE = /^●\s+(.+)/

function parseTsErrorLine(line: string): RevisionDiagnostic | null {
  const modern = MODERN_TS_ERROR_RE.exec(line)
  if (modern) {
    const [, file, lineStr] = modern
    return makeDiagnostic(file ?? '', parseLineNumber(lineStr), 'typecheck', line)
  }
  const legacy = LEGACY_TS_ERROR_RE.exec(line)
  if (legacy) {
    const [, file, lineStr] = legacy
    return makeDiagnostic(file ?? '', parseLineNumber(lineStr), 'typecheck', line)
  }
  return null
}

function makeDiagnostic(
  file: string,
  line: number | undefined,
  kind: RevisionDiagnostic['kind'],
  message: string
): RevisionDiagnostic {
  return line !== undefined ? { file, line, kind, message } : { file, kind, message }
}

function parseLineNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseTypecheckDiagnostics(stderr: string): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = []
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const diagnostic = parseTsErrorLine(trimmed)
    if (diagnostic) diagnostics.push(diagnostic)
  }
  return diagnostics
}

function parseTestDiagnostics(stderr: string): RevisionDiagnostic[] {
  const diagnostics: RevisionDiagnostic[] = []
  const lines = stderr.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''

    const suiteFail = TEST_SUITE_FAIL_RE.exec(line)
    if (suiteFail) {
      diagnostics.push({ file: suiteFail[1] ?? '', kind: 'test', message: line })
      continue
    }

    const vitestBlock = VITEST_BLOCK_HEADER_RE.exec(line)
    if (vitestBlock) {
      // Collect the indented block below the header as the message body
      const bodyLines: string[] = [line]
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? ''
        if (next.trim() === '' || !next.startsWith(' ')) break
        bodyLines.push(next.trimEnd())
      }
      diagnostics.push({ file: '', kind: 'test', message: bodyLines.join('\n') })
    }
  }

  return diagnostics
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Builds a RevisionFeedback from a pre-review verification failure.
 *
 * @param kind      - 'compilation' (typecheck failed) or 'test_failure' (tests failed)
 * @param stderr    - Raw combined output from the npm command
 */
export function buildVerificationRevisionFeedback(
  kind: VerificationFailureKind,
  stderr: string
): RevisionFeedback {
  if (kind === 'compilation') {
    const diagnostics = parseTypecheckDiagnostics(stderr)
    const summary =
      diagnostics.length > 0
        ? `TypeScript compilation failed with ${diagnostics.length} error(s). Fix all type errors before retrying.`
        : 'TypeScript compilation failed. See diagnostics for details.'
    return {
      summary,
      diagnostics: diagnostics.length > 0 ? diagnostics : [{ file: '', kind: 'typecheck', message: stderr }]
    }
  }

  // test_failure
  const diagnostics = parseTestDiagnostics(stderr)
  const summary =
    diagnostics.length > 0
      ? `${diagnostics.length} test suite(s) failed. Fix all failing tests before retrying.`
      : 'Test suite failed. See diagnostics for details.'
  return {
    summary,
    diagnostics: diagnostics.length > 0 ? diagnostics : [{ file: '', kind: 'test', message: stderr }]
  }
}

/**
 * Builds a RevisionFeedback for the missing-file failure path (agent produced
 * commits but required files are absent from the diff).
 */
export function buildMissingFilesRevisionFeedback(missingPaths: string[]): RevisionFeedback {
  return {
    summary: `${missingPaths.length} required file(s) were not produced by the agent. Create each missing file before retrying.`,
    diagnostics: missingPaths.map((file) => ({
      file,
      kind: 'missing-file' as const,
      message: `Required file not found: ${file}`
    }))
  }
}

/**
 * Builds a RevisionFeedback for the no-commits failure path.
 */
export function buildNoCommitsRevisionFeedback(lastAgentOutput: string): RevisionFeedback {
  const message = lastAgentOutput.trim()
    ? `Agent exited without producing any commits. Last output: ${lastAgentOutput.trim()}`
    : 'Agent exited without producing any commits and left no output.'
  return {
    summary: 'Agent produced no commits. Ensure all changes are committed before exiting.',
    diagnostics: [{ file: '', kind: 'other', message }]
  }
}

/**
 * Attempts to parse a task's notes field as RevisionFeedback.
 * Returns the parsed object on success, or null if the notes are not valid
 * RevisionFeedback JSON (e.g. legacy freeform strings).
 */
export function parseRevisionFeedback(notes: string | null | undefined): RevisionFeedback | null {
  if (!notes) return null
  try {
    const parsed: unknown = JSON.parse(notes)
    if (isRevisionFeedback(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

function isRevisionFeedback(value: unknown): value is RevisionFeedback {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.diagnostics)
  )
}

/**
 * Escapes `</` sequences in content destined for an XML boundary tag.
 * Mirrors the same escape used throughout prompt-sections.ts — extracted here
 * so the builder has no dependency on prompt-sections.ts (avoiding circular imports).
 */
function escapeXml(content: string): string {
  return content.replace(/<\//g, '<\\/')
}

/**
 * Renders a RevisionFeedback as a `<revision_feedback>` XML block for injection
 * into retry prompts. Each diagnostic is rendered as a single bullet so agents
 * can scan the list without parsing prose.
 */
export function renderRevisionFeedbackBlock(feedback: RevisionFeedback): string {
  const diagnosticLines = feedback.diagnostics.map((d) => {
    const location = d.file ? `${d.file}${d.line !== undefined ? `:${d.line}` : ''}` : '<unknown>'
    const fix = d.suggestedFix ? `\n  Fix: ${escapeXml(d.suggestedFix)}` : ''
    return `- ${location} [${d.kind}]: ${escapeXml(d.message)}${fix}`
  })

  const body =
    `Previous attempt failed: ${escapeXml(feedback.summary)}\n\n` +
    `Diagnostics:\n${diagnosticLines.join('\n')}`

  return `<revision_feedback>\n${body}\n</revision_feedback>`
}
