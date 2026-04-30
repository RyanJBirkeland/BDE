import { describe, it, expect } from 'vitest'
import { parseReviewResponse, MalformedReviewError } from '../review-response-parser'

describe('parseReviewResponse — valid JSON', () => {
  it('parses a minimal valid review with no per-file findings', () => {
    const raw = JSON.stringify({
      qualityScore: 80,
      openingMessage: 'Looks good overall.',
      perFile: []
    })

    const result = parseReviewResponse(raw)

    expect(result.qualityScore).toBe(80)
    expect(result.openingMessage).toBe('Looks good overall.')
    expect(result.perFile).toHaveLength(0)
  })

  it('parses a review with per-file findings and comments', () => {
    const raw = JSON.stringify({
      qualityScore: 55,
      openingMessage: 'Several issues found.',
      perFile: [
        {
          path: 'src/foo.ts',
          status: 'issues',
          comments: [
            { line: 12, severity: 'high', category: 'security', message: 'Possible injection' }
          ]
        },
        {
          path: 'src/bar.ts',
          status: 'clean',
          comments: []
        }
      ]
    })

    const result = parseReviewResponse(raw)

    expect(result.qualityScore).toBe(55)
    expect(result.perFile).toHaveLength(2)
    expect(result.perFile[0]?.path).toBe('src/foo.ts')
    expect(result.perFile[0]?.status).toBe('issues')
    expect(result.perFile[0]?.comments[0]?.severity).toBe('high')
    expect(result.perFile[1]?.status).toBe('clean')
  })

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n{"qualityScore":90,"openingMessage":"Clean.","perFile":[]}\n```'

    const result = parseReviewResponse(raw)

    expect(result.qualityScore).toBe(90)
  })

  it('rounds a non-integer qualityScore', () => {
    const raw = JSON.stringify({
      qualityScore: 73.7,
      openingMessage: 'Mostly clean.',
      perFile: []
    })

    const result = parseReviewResponse(raw)

    expect(result.qualityScore).toBe(74)
  })

  it('preserves extraneous top-level fields in perFile comments (unknown keys ignored)', () => {
    const raw = JSON.stringify({
      qualityScore: 70,
      openingMessage: 'Fine.',
      perFile: [
        {
          path: 'x.ts',
          status: 'issues',
          comments: [{ line: 1, severity: 'low', category: 'style', message: 'ok', extra: 'ignored' }]
        }
      ]
    })

    const result = parseReviewResponse(raw)

    expect(result.perFile[0]?.comments[0]?.message).toBe('ok')
  })

  it('defaults unknown severity to "low"', () => {
    const raw = JSON.stringify({
      qualityScore: 60,
      openingMessage: 'Ok.',
      perFile: [
        {
          path: 'x.ts',
          status: 'issues',
          comments: [{ line: 1, severity: 'critical', category: 'correctness', message: 'x' }]
        }
      ]
    })

    const result = parseReviewResponse(raw)

    expect(result.perFile[0]?.comments[0]?.severity).toBe('low')
  })

  it('defaults unknown category to "correctness"', () => {
    const raw = JSON.stringify({
      qualityScore: 60,
      openingMessage: 'Ok.',
      perFile: [
        {
          path: 'x.ts',
          status: 'issues',
          comments: [{ line: 1, severity: 'high', category: 'unknown-cat', message: 'x' }]
        }
      ]
    })

    const result = parseReviewResponse(raw)

    expect(result.perFile[0]?.comments[0]?.category).toBe('correctness')
  })
})

describe('parseReviewResponse — malformed JSON', () => {
  it('throws MalformedReviewError when input is empty', () => {
    expect(() => parseReviewResponse('')).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when input is plain text with no JSON object', () => {
    expect(() => parseReviewResponse('No JSON here')).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when JSON.parse fails', () => {
    expect(() => parseReviewResponse('{invalid json')).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when qualityScore is missing', () => {
    const raw = JSON.stringify({ openingMessage: 'Hi', perFile: [] })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when qualityScore is out of range (> 100)', () => {
    const raw = JSON.stringify({ qualityScore: 150, openingMessage: 'Hi', perFile: [] })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when qualityScore is out of range (< 0)', () => {
    const raw = JSON.stringify({ qualityScore: -1, openingMessage: 'Hi', perFile: [] })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when openingMessage is absent', () => {
    const raw = JSON.stringify({ qualityScore: 80, perFile: [] })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when openingMessage is whitespace-only', () => {
    const raw = JSON.stringify({ qualityScore: 80, openingMessage: '   ', perFile: [] })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when perFile is not an array', () => {
    const raw = JSON.stringify({ qualityScore: 80, openingMessage: 'Hi', perFile: 'nope' })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('throws MalformedReviewError when a perFile entry has an invalid status', () => {
    const raw = JSON.stringify({
      qualityScore: 80,
      openingMessage: 'Hi',
      perFile: [{ path: 'x.ts', status: 'unknown', comments: [] }]
    })
    expect(() => parseReviewResponse(raw)).toThrow(MalformedReviewError)
  })

  it('attaches the raw response to the thrown error', () => {
    const raw = 'completely garbage'
    let caught: MalformedReviewError | undefined
    try {
      parseReviewResponse(raw)
    } catch (err) {
      caught = err as MalformedReviewError
    }

    expect(caught).toBeInstanceOf(MalformedReviewError)
    expect(caught?.rawResponse).toBe(raw)
  })
})
