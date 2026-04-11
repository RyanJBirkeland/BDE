/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { parseNumstat } from '../review-merge-service'

describe('parseNumstat', () => {
  it('should parse numstat output with patch map', () => {
    const numstatInput = `10\t5\tsrc/main/handlers/review.ts
0\t20\tsrc/main/services/deleted.ts
15\t0\tsrc/main/services/new.ts`

    const patchMap = new Map([
      ['src/main/handlers/review.ts', 'diff --git a/src/main/handlers/review.ts...'],
      ['src/main/services/deleted.ts', 'diff --git a/src/main/services/deleted.ts...'],
      ['src/main/services/new.ts', 'diff --git a/src/main/services/new.ts...']
    ])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      path: 'src/main/handlers/review.ts',
      status: 'modified',
      additions: 10,
      deletions: 5,
      patch: 'diff --git a/src/main/handlers/review.ts...'
    })
    expect(result[1]).toEqual({
      path: 'src/main/services/deleted.ts',
      status: 'deleted',
      additions: 0,
      deletions: 20,
      patch: 'diff --git a/src/main/services/deleted.ts...'
    })
    expect(result[2]).toEqual({
      path: 'src/main/services/new.ts',
      status: 'added',
      additions: 15,
      deletions: 0,
      patch: 'diff --git a/src/main/services/new.ts...'
    })
  })

  it('should handle files not in patch map', () => {
    const numstatInput = '5\t3\tREADME.md'
    const patchMap = new Map<string, string>()

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0].patch).toBe('')
  })

  it('should handle binary files with "-" markers', () => {
    const numstatInput = '-\t-\tsrc/assets/image.png'
    const patchMap = new Map([['src/assets/image.png', 'Binary files differ']])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: 'src/assets/image.png',
      status: 'deleted',
      additions: 0,
      deletions: 0,
      patch: 'Binary files differ'
    })
  })

  it('should handle empty input', () => {
    const result = parseNumstat('', new Map())
    expect(result).toEqual([])
  })

  it('should handle file paths with tabs', () => {
    const numstatInput = '5\t2\tpath/with\ttab.txt'
    const patchMap = new Map([['path/with\ttab.txt', 'diff --git...']])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('path/with\ttab.txt')
  })
})
