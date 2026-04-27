import { describe, it, expect } from 'vitest'
import {
  buildFlatRows,
  ROW_HEIGHT,
  FILE_HEADER_HEIGHT,
  HUNK_HEADER_HEIGHT,
  COMMENT_ROW_HEIGHT
} from '../virtualized-diff-utils'
import type { DiffFile } from '../../../lib/diff-parser'
import type { PrComment } from '../../../../../shared/types'
import type { PendingComment } from '../../../stores/pendingReview'

function makeFile(path: string, lineCount: number): DiffFile {
  return {
    path,
    additions: 0,
    deletions: 0,
    hunks: [
      {
        header: '@@ -1 +1 @@',
        lines: Array.from({ length: lineCount }, (_, i) => ({
          type: 'ctx' as const,
          content: `line ${i + 1}`,
          lineNo: { old: i + 1, new: i + 1 }
        }))
      }
    ]
  }
}

function makeComment(path: string, line: number, body: string): PrComment {
  return {
    id: line,
    path,
    line,
    body,
    user: { login: 'reviewer', avatar_url: '' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    html_url: '',
    diff_hunk: '',
    original_line: line,
    in_reply_to_id: null,
    pull_request_review_id: null
  }
}

function makePending(path: string, line: number, body: string): PendingComment {
  return { id: `p-${line}`, path, line, side: 'RIGHT', body }
}

describe('buildFlatRows', () => {
  it('produces file-header → hunk-header → line rows in order', () => {
    const { flatRows } = buildFlatRows(
      [makeFile('src/a.ts', 2)],
      new Map(),
      new Map()
    )
    expect(flatRows[0]?.kind).toBe('file-header')
    expect(flatRows[1]?.kind).toBe('hunk-header')
    expect(flatRows[2]?.kind).toBe('line')
    expect(flatRows[3]?.kind).toBe('line')
    expect(flatRows).toHaveLength(4)
  })

  it('injects a comment row immediately after the matching code line', () => {
    const file = makeFile('src/foo.ts', 3)
    const commentsByPosition = new Map([
      ['src/foo.ts:2', [makeComment('src/foo.ts', 2, 'nice change')]]
    ])

    const { flatRows } = buildFlatRows([file], commentsByPosition, new Map())

    const line2Idx = flatRows.findIndex((r) => r.kind === 'line' && r.line.lineNo.new === 2)
    expect(line2Idx).toBeGreaterThan(-1)
    expect(flatRows[line2Idx + 1]?.kind).toBe('comment')

    const commentRow = flatRows[line2Idx + 1]
    expect(commentRow?.kind === 'comment' && commentRow.comments[0]?.body).toBe('nice change')
  })

  it('injects no comment rows when there are no comments', () => {
    const { flatRows } = buildFlatRows([makeFile('src/b.ts', 5)], new Map(), new Map())
    expect(flatRows.filter((r) => r.kind === 'comment')).toHaveLength(0)
  })

  it('injects a comment row for pending comments', () => {
    const file = makeFile('src/c.ts', 2)
    const pendingByPosition = new Map([['src/c.ts:1', [makePending('src/c.ts', 1, 'todo')]]])

    const { flatRows } = buildFlatRows([file], new Map(), pendingByPosition)

    const commentRows = flatRows.filter((r) => r.kind === 'comment')
    expect(commentRows).toHaveLength(1)
    const row = commentRows[0]
    expect(row?.kind === 'comment' && row.pendingComments[0]?.body).toBe('todo')
  })

  it('groups both resolved and pending comments into one row per position', () => {
    const file = makeFile('src/d.ts', 1)
    const commentsByPosition = new Map([['src/d.ts:1', [makeComment('src/d.ts', 1, 'resolved')]]])
    const pendingByPosition = new Map([['src/d.ts:1', [makePending('src/d.ts', 1, 'pending')]]])

    const { flatRows } = buildFlatRows([file], commentsByPosition, pendingByPosition)

    const commentRows = flatRows.filter((r) => r.kind === 'comment')
    expect(commentRows).toHaveLength(1)
    const row = commentRows[0]
    expect(row?.kind === 'comment' && row.comments[0]?.body).toBe('resolved')
    expect(row?.kind === 'comment' && row.pendingComments[0]?.body).toBe('pending')
  })

  it('includes comment row height in totalHeight', () => {
    const file = makeFile('src/e.ts', 1)
    const commentsByPosition = new Map([['src/e.ts:1', [makeComment('src/e.ts', 1, 'x')]]])

    const { totalHeight } = buildFlatRows([file], commentsByPosition, new Map())

    const expected = FILE_HEADER_HEIGHT + HUNK_HEADER_HEIGHT + ROW_HEIGHT + COMMENT_ROW_HEIGHT
    expect(totalHeight).toBe(expected)
  })

  it('populates fileIndexToRow and hunkAddressToRow', () => {
    const { fileIndexToRow, hunkAddressToRow } = buildFlatRows(
      [makeFile('src/f.ts', 1)],
      new Map(),
      new Map()
    )
    expect(fileIndexToRow.get(0)).toBe(0)
    expect(hunkAddressToRow.get('0-0')).toBe(1)
  })
})
