import type { DiffFile, DiffLine } from '../../lib/diff-parser'

export const ROW_HEIGHT = 20
export const FILE_HEADER_HEIGHT = 36
export const HUNK_HEADER_HEIGHT = 28

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

export type FlatRow = FileHeaderRow | HunkHeaderRow | LineRow

export interface HunkAddress {
  fileIndex: number
  hunkIndex: number
}

export function rowHeight(row: FlatRow): number {
  if (row.kind === 'file-header') return FILE_HEADER_HEIGHT
  if (row.kind === 'hunk-header') return HUNK_HEADER_HEIGHT
  return ROW_HEIGHT
}
