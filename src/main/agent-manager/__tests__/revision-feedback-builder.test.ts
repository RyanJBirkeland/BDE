import { describe, it, expect } from 'vitest'
import {
  buildVerificationRevisionFeedback,
  buildMissingFilesRevisionFeedback,
  buildNoCommitsRevisionFeedback,
  parseRevisionFeedback,
  renderRevisionFeedbackBlock
} from '../revision-feedback-builder'

// ---------------------------------------------------------------------------
// buildVerificationRevisionFeedback — compilation
// ---------------------------------------------------------------------------

describe('buildVerificationRevisionFeedback — compilation', () => {
  it('parses a modern tsc error line', () => {
    const stderr = [
      'Pre-review verification: typescript error',
      '',
      'src/main/foo.ts(42,5): error TS2345: Argument of type string is not assignable to type number.'
    ].join('\n')

    const feedback = buildVerificationRevisionFeedback('compilation', stderr)

    expect(feedback.diagnostics).toHaveLength(1)
    const diag = feedback.diagnostics[0]!
    expect(diag.kind).toBe('typecheck')
    expect(diag.file).toBe('src/main/foo.ts')
    expect(diag.line).toBe(42)
    expect(diag.message).toContain('TS2345')
  })

  it('parses a legacy tsc error line', () => {
    const stderr =
      'src/renderer/bar.tsx:10:3 - error TS2304: Cannot find name "Foo".'

    const feedback = buildVerificationRevisionFeedback('compilation', stderr)

    expect(feedback.diagnostics).toHaveLength(1)
    const diag = feedback.diagnostics[0]!
    expect(diag.kind).toBe('typecheck')
    expect(diag.file).toBe('src/renderer/bar.tsx')
    expect(diag.line).toBe(10)
  })

  it('returns multiple diagnostics for multiple error lines', () => {
    const stderr = [
      'src/a.ts(1,1): error TS2304: Cannot find name "A".',
      'src/b.ts(2,2): error TS2345: Argument of type "x" is not assignable to type "y".'
    ].join('\n')

    const feedback = buildVerificationRevisionFeedback('compilation', stderr)

    expect(feedback.diagnostics).toHaveLength(2)
    expect(feedback.diagnostics[0]!.file).toBe('src/a.ts')
    expect(feedback.diagnostics[1]!.file).toBe('src/b.ts')
  })

  it('falls back to a single raw diagnostic when no ts error lines are present', () => {
    const stderr = 'something went wrong but no parseable line'

    const feedback = buildVerificationRevisionFeedback('compilation', stderr)

    expect(feedback.diagnostics).toHaveLength(1)
    expect(feedback.diagnostics[0]!.kind).toBe('typecheck')
    expect(feedback.diagnostics[0]!.message).toContain('something went wrong')
  })

  it('summary mentions error count when diagnostics are parsed', () => {
    const stderr = 'src/a.ts(1,1): error TS2304: Cannot find name "A".'

    const feedback = buildVerificationRevisionFeedback('compilation', stderr)

    expect(feedback.summary).toContain('1 error')
  })
})

// ---------------------------------------------------------------------------
// buildVerificationRevisionFeedback — test_failure
// ---------------------------------------------------------------------------

describe('buildVerificationRevisionFeedback — test_failure', () => {
  it('parses a FAIL suite header line', () => {
    const stderr = [
      'Pre-review verification: vitest failed',
      '',
      'FAIL src/main/agent-manager/__tests__/foo.test.ts',
      '  expected 1 to equal 2'
    ].join('\n')

    const feedback = buildVerificationRevisionFeedback('test_failure', stderr)

    const suiteDiag = feedback.diagnostics.find((d) => d.file.endsWith('foo.test.ts'))
    expect(suiteDiag).toBeDefined()
    expect(suiteDiag!.kind).toBe('test')
  })

  it('captures vitest error block under a ● header', () => {
    const stderr = [
      '● FooComponent > renders the label',
      '  Error: expected "bar" to be "foo"',
      '    at Object.<anonymous> (src/foo.test.ts:10:5)',
      ''
    ].join('\n')

    const feedback = buildVerificationRevisionFeedback('test_failure', stderr)

    const blockDiag = feedback.diagnostics.find((d) =>
      d.message.includes('renders the label')
    )
    expect(blockDiag).toBeDefined()
    expect(blockDiag!.kind).toBe('test')
    expect(blockDiag!.message).toContain('expected "bar" to be "foo"')
  })

  it('falls back to a single raw diagnostic when no test lines are parsed', () => {
    const stderr = 'unknown test runner output'

    const feedback = buildVerificationRevisionFeedback('test_failure', stderr)

    expect(feedback.diagnostics).toHaveLength(1)
    expect(feedback.diagnostics[0]!.kind).toBe('test')
  })
})

// ---------------------------------------------------------------------------
// buildMissingFilesRevisionFeedback
// ---------------------------------------------------------------------------

describe('buildMissingFilesRevisionFeedback', () => {
  it('creates one missing-file diagnostic per path', () => {
    const feedback = buildMissingFilesRevisionFeedback([
      'src/missing/a.ts',
      'src/missing/b.ts'
    ])

    expect(feedback.diagnostics).toHaveLength(2)
    expect(feedback.diagnostics[0]!.kind).toBe('missing-file')
    expect(feedback.diagnostics[0]!.file).toBe('src/missing/a.ts')
    expect(feedback.diagnostics[1]!.file).toBe('src/missing/b.ts')
  })

  it('summary mentions the count', () => {
    const feedback = buildMissingFilesRevisionFeedback(['src/a.ts'])

    expect(feedback.summary).toContain('1 required file')
  })
})

// ---------------------------------------------------------------------------
// buildNoCommitsRevisionFeedback
// ---------------------------------------------------------------------------

describe('buildNoCommitsRevisionFeedback', () => {
  it('produces a single other diagnostic', () => {
    const feedback = buildNoCommitsRevisionFeedback('Agent said nothing.')

    expect(feedback.diagnostics).toHaveLength(1)
    expect(feedback.diagnostics[0]!.kind).toBe('other')
    expect(feedback.diagnostics[0]!.message).toContain('Agent said nothing')
  })

  it('handles empty last output', () => {
    const feedback = buildNoCommitsRevisionFeedback('')

    expect(feedback.diagnostics[0]!.message).toContain('no output')
  })
})

// ---------------------------------------------------------------------------
// parseRevisionFeedback
// ---------------------------------------------------------------------------

describe('parseRevisionFeedback', () => {
  it('parses valid RevisionFeedback JSON', () => {
    const input = JSON.stringify({
      summary: 'TypeScript compilation failed',
      diagnostics: [
        { file: 'src/a.ts', line: 5, kind: 'typecheck', message: 'error TS2304' }
      ]
    })

    const result = parseRevisionFeedback(input)

    expect(result).not.toBeNull()
    expect(result!.summary).toBe('TypeScript compilation failed')
    expect(result!.diagnostics).toHaveLength(1)
  })

  it('returns null for freeform string notes', () => {
    expect(parseRevisionFeedback('some freeform failure message')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseRevisionFeedback(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseRevisionFeedback(undefined)).toBeNull()
  })

  it('returns null for JSON that does not match the shape', () => {
    const notFeedback = JSON.stringify({ foo: 'bar' })
    expect(parseRevisionFeedback(notFeedback)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseRevisionFeedback('{ not valid json')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// renderRevisionFeedbackBlock
// ---------------------------------------------------------------------------

describe('renderRevisionFeedbackBlock', () => {
  it('wraps content in revision_feedback tags', () => {
    const feedback = {
      summary: 'Compilation failed',
      diagnostics: [{ file: 'src/a.ts', line: 10, kind: 'typecheck' as const, message: 'error TS2304' }]
    }

    const block = renderRevisionFeedbackBlock(feedback)

    expect(block).toMatch(/^<revision_feedback>/)
    expect(block).toMatch(/<\/revision_feedback>$/)
  })

  it('includes the summary in the block body', () => {
    const feedback = {
      summary: 'Tests failed with 3 errors',
      diagnostics: []
    }

    const block = renderRevisionFeedbackBlock(feedback)

    expect(block).toContain('Tests failed with 3 errors')
  })

  it('renders file, line, and kind for each diagnostic', () => {
    const feedback = {
      summary: 'Compilation failed',
      diagnostics: [
        { file: 'src/foo.ts', line: 7, kind: 'typecheck' as const, message: 'Cannot find name' }
      ]
    }

    const block = renderRevisionFeedbackBlock(feedback)

    expect(block).toContain('src/foo.ts:7')
    expect(block).toContain('[typecheck]')
    expect(block).toContain('Cannot find name')
  })

  it('renders suggestedFix when present', () => {
    const feedback = {
      summary: 'Compilation failed',
      diagnostics: [
        {
          file: 'src/foo.ts',
          kind: 'typecheck' as const,
          message: 'Type mismatch',
          suggestedFix: 'Change string to number'
        }
      ]
    }

    const block = renderRevisionFeedbackBlock(feedback)

    expect(block).toContain('Fix: Change string to number')
  })

  it('escapes closing XML tags in diagnostic messages to prevent injection', () => {
    const feedback = {
      summary: 'Malicious summary',
      diagnostics: [
        { file: '', kind: 'other' as const, message: '</revision_feedback>INJECTED' }
      ]
    }

    const block = renderRevisionFeedbackBlock(feedback)

    expect(block).not.toContain('</revision_feedback>INJECTED')
    expect(block).toContain('<\\/revision_feedback>')
  })
})
