/**
 * Compile-time + runtime checks for the `ReviewGitOp` discriminated union.
 *
 * The point of these tests is to lock in the exhaustiveness contract: any new
 * variant added to `ReviewGitOp` without a corresponding case in callers'
 * switches MUST produce a TypeScript error at the `assertNeverGitOp` site.
 * The `@ts-expect-error` directives below FAIL the build if the line they
 * annotate stops being a type error — i.e. if the union accidentally widens
 * to accept arbitrary strings.
 */
import { describe, it, expect } from 'vitest'
import { assertNeverGitOp, type ReviewGitOp } from '../review-gitop-types'

describe('ReviewGitOp discriminated union', () => {
  it('rejects an unknown variant at compile time', () => {
    // @ts-expect-error 'unknownVariant' is not a member of ReviewGitOp.type
    const bogus: ReviewGitOp = { type: 'unknownVariant' }
    // Reference `bogus` so the const is not flagged as unused; the assertion
    // itself is irrelevant — the @ts-expect-error above is the real check.
    expect(bogus).toBeDefined()
  })

  it('accepts every declared variant', () => {
    const variants: ReviewGitOp[] = [
      { type: 'mergeLocally', strategy: 'squash' },
      { type: 'createPr', title: 't', body: 'b' },
      { type: 'requestRevision', feedback: 'fix it', mode: 'fresh' },
      { type: 'discard' },
      { type: 'shipIt', strategy: 'merge' },
      { type: 'rebase' }
    ]
    expect(variants).toHaveLength(6)
  })

  it('exhaustive-switch helper throws when reached at runtime', () => {
    // Simulate a forced cast to bypass TS — proves the runtime guard fires
    // if a future caller forgets to handle a new variant.
    const rogue = { type: 'rogue' } as unknown as never
    expect(() => assertNeverGitOp(rogue)).toThrow(/Unhandled ReviewGitOp/)
  })
})
