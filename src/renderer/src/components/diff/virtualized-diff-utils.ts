import type { DiffFile, DiffLine } from '../../lib/diff-parser'
import type { PrComment } from '../../../../shared/types'
import type { PendingComment } from '../../stores/pendingReview'

export const ROW_HEIGHT = 20
export const FILE_HEADER_HEIGHT = 36
export const HUNK_HEADER_HEIGHT = 28
export const COMMENT_ROW_HEIGHT = 60

export interface FileHeaderRow {
  kind: 'file-header'
  file: DiffFile
  fileIndex: number
}

export interface HunkHeaderRow {
  kind: 'hunk-header'
  header: string
  fileIndex: number
  hunkIndex: number
}

export interface LineRow {
  kind: 'line'
  line: DiffLine
  lineIndex: number
}

export interface CommentRow {
  kind: 'comment'
  comments: PrComment[]
  pendingComments: PendingComment[]
  filePath: string
  lineNum: number
}

export type FlatRow = FileHeaderRow | HunkHeaderRow | LineRow | CommentRow

export interface HunkAddress {
  fileIndex: number
  hunkIndex: number
}

export function rowHeight(row: FlatRow): number {
  if (row.kind === 'file-header') return FILE_HEADER_HEIGHT
  if (row.kind === 'hunk-header') return HUNK_HEADER_HEIGHT
  if (row.kind === 'comment') return COMMENT_ROW_HEIGHT
  return ROW_HEIGHT
}

export interface FlatRowsResult {
  flatRows: FlatRow[]
  totalHeight: number
  fileIndexToRow: Map<number, number>
  hunkAddressToRow: Map<string, number>
}

/** Build the flat row list used by the virtualized diff renderer.
 *  Injects a CommentRow after each code line that has associated comments or
 *  pending comments at that file-path:line-number position. */
export function buildFlatRows(
  files: DiffFile[],
  commentsByPosition: Map<string, PrComment[]>,
  pendingByPosition: Map<string, PendingComment[]>
): FlatRowsResult {
  const rows: FlatRow[] = []
  const fiToRow = new Map<number, number>()
  const haToRow = new Map<string, number>()
  let height = 0

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi]
    if (!file) continue
    fiToRow.set(fi, rows.length)
    rows.push({ kind: 'file-header', file, fileIndex: fi })
    height += FILE_HEADER_HEIGHT

    for (let hi = 0; hi < file.hunks.length; hi++) {
      const hunk = file.hunks[hi]
      if (!hunk) continue
      haToRow.set(`${fi}-${hi}`, rows.length)
      rows.push({ kind: 'hunk-header', header: hunk.header, fileIndex: fi, hunkIndex: hi })
      height += HUNK_HEADER_HEIGHT

      for (let li = 0; li < hunk.lines.length; li++) {
        const line = hunk.lines[li]
        if (!line) continue
        rows.push({ kind: 'line', line, lineIndex: li })
        height += ROW_HEIGHT

        const lineNum = line.lineNo.new ?? line.lineNo.old
        if (lineNum != null) {
          const key = `${file.path}:${lineNum}`
          const lineComments = commentsByPosition.get(key) ?? []
          const pending = pendingByPosition.get(key) ?? []
          if (lineComments.length > 0 || pending.length > 0) {
            rows.push({
              kind: 'comment',
              comments: lineComments,
              pendingComments: pending,
              filePath: file.path,
              lineNum
            })
            height += COMMENT_ROW_HEIGHT
          }
        }
      }
    }
  }

  return { flatRows: rows, totalHeight: height, fileIndexToRow: fiToRow, hunkAddressToRow: haToRow }
}
