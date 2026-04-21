import React from 'react'
import './PlainDiffContent.css'
import type { DiffFile } from '../../lib/diff-parser'
import type { PrComment } from '../../../../shared/types'
import type { PendingComment } from '../../stores/pendingReview'
import type { LineRange } from './DiffViewer'
import { DiffCommentWidget } from './DiffCommentWidget'
import { DiffCommentComposer } from './DiffCommentComposer'

interface HunkAddress {
  fileIndex: number
  hunkIndex: number
}

interface PlainDiffContentProps {
  files: DiffFile[]
  activeFileIndex: number
  activeHunk: HunkAddress | null
  fileRefs: React.RefObject<Map<string, HTMLDivElement>>
  hunkRefs: React.RefObject<Map<string, HTMLDivElement>>
  commentsByPosition: Map<string, PrComment[]>
  pendingByPosition: Map<string, PendingComment[]>
  selectedRange: LineRange | null
  selectionStart: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null
  isSelecting: boolean
  composerRange: LineRange | null
  setSelectionStart: (v: { file: string; line: number; side: 'LEFT' | 'RIGHT' } | null) => void
  setIsSelecting: (v: boolean) => void
  setComposerRange: (v: LineRange | null) => void
  onSelectRange?: ((range: LineRange | null) => void) | undefined
  onAddComment?: ((range: LineRange, body: string) => void) | undefined
  onRemovePendingComment?: ((commentId: string) => void) | undefined
  isLineSelected: (
    filePath: string,
    lineNo: number | undefined,
    selectedRange: LineRange | null
  ) => boolean
}

export function PlainDiffContent({
  files,
  activeFileIndex,
  activeHunk,
  fileRefs,
  hunkRefs,
  commentsByPosition,
  pendingByPosition,
  selectedRange,
  selectionStart,
  isSelecting,
  composerRange,
  setSelectionStart,
  setIsSelecting,
  setComposerRange,
  onSelectRange,
  onAddComment,
  onRemovePendingComment,
  isLineSelected
}: PlainDiffContentProps): React.JSX.Element {
  return (
    <>
      {files.map((file, fi) => (
        <div
          key={file.path}
          className={`diff-file ${activeFileIndex === fi ? 'diff-file--active' : ''}`}
          ref={(el): void => {
            if (el) fileRefs.current?.set(file.path, el)
          }}
        >
          <div className="diff-file__header">
            <span className="diff-file__path">{file.path}</span>
            <span className="diff-file__stats">
              {file.additions > 0 && (
                <span className="diff-file__stats-add">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="diff-file__stats-del">-{file.deletions}</span>
              )}
            </span>
          </div>
          {file.hunks.map((hunk, hi) => (
            <div
              key={hi}
              className={`diff-hunk ${activeHunk?.fileIndex === fi && activeHunk?.hunkIndex === hi ? 'diff-hunk--focused' : ''}`}
              ref={(el): void => {
                if (el) hunkRefs.current?.set(`${fi}-${hi}`, el)
              }}
            >
              <div className="diff-hunk__header">{hunk.header}</div>
              {hunk.lines.map((line, li) => {
                const lineNum = line.lineNo.new ?? line.lineNo.old
                const commentKey = lineNum ? `${file.path}:${lineNum}` : null
                const lineComments = commentKey ? commentsByPosition.get(commentKey) : undefined
                const selected = isLineSelected(file.path, line.lineNo.new, selectedRange)

                return (
                  <React.Fragment key={li}>
                    {selectedRange &&
                      selectedRange.file === file.path &&
                      line.lineNo.new === selectedRange.startLine &&
                      onAddComment && (
                        <div style={{ position: 'relative' }}>
                          <button
                            className="diff-selection-trigger"
                            onClick={(e) => {
                              e.stopPropagation()
                              setComposerRange(selectedRange)
                            }}
                            title="Add comment"
                          >
                            +
                          </button>
                        </div>
                      )}
                    <div
                      className={`diff-line diff-line--${line.type}${selected ? ' diff-line--selected' : ''}`}
                    >
                      <span
                        className={`diff-line__gutter diff-line__gutter--old${onSelectRange ? ' diff-line__gutter--selectable' : ''}`}
                        onMouseDown={() => {
                          if (!onSelectRange || line.lineNo.old == null) return
                          setSelectionStart({
                            file: file.path,
                            line: line.lineNo.old,
                            side: 'LEFT'
                          })
                          setIsSelecting(true)
                          onSelectRange({
                            file: file.path,
                            startLine: line.lineNo.old,
                            endLine: line.lineNo.old,
                            side: 'LEFT'
                          })
                        }}
                        onMouseEnter={() => {
                          if (
                            !isSelecting ||
                            !selectionStart ||
                            selectionStart.file !== file.path ||
                            selectionStart.side !== 'LEFT' ||
                            !onSelectRange
                          )
                            return
                          if (line.lineNo.old == null) return
                          onSelectRange({
                            file: file.path,
                            startLine: Math.min(selectionStart.line, line.lineNo.old),
                            endLine: Math.max(selectionStart.line, line.lineNo.old),
                            side: 'LEFT'
                          })
                        }}
                      >
                        {line.lineNo.old ?? ''}
                      </span>
                      <span
                        className={`diff-line__gutter diff-line__gutter--new${onSelectRange ? ' diff-line__gutter--selectable' : ''}`}
                        onMouseDown={() => {
                          if (!onSelectRange || line.lineNo.new == null) return
                          setSelectionStart({
                            file: file.path,
                            line: line.lineNo.new,
                            side: 'RIGHT'
                          })
                          setIsSelecting(true)
                          onSelectRange({
                            file: file.path,
                            startLine: line.lineNo.new,
                            endLine: line.lineNo.new,
                            side: 'RIGHT'
                          })
                        }}
                        onMouseEnter={() => {
                          if (
                            !isSelecting ||
                            !selectionStart ||
                            selectionStart.file !== file.path ||
                            selectionStart.side !== 'RIGHT' ||
                            !onSelectRange
                          )
                            return
                          if (line.lineNo.new == null) return
                          onSelectRange({
                            file: file.path,
                            startLine: Math.min(selectionStart.line, line.lineNo.new),
                            endLine: Math.max(selectionStart.line, line.lineNo.new),
                            side: 'RIGHT'
                          })
                        }}
                      >
                        {line.lineNo.new ?? ''}
                      </span>
                      <span className="diff-line__marker">
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </span>
                      <span className="diff-line__text">{line.content}</span>
                    </div>
                    {lineComments && lineComments.length > 0 && (
                      <DiffCommentWidget comments={lineComments} />
                    )}
                    {composerRange &&
                      composerRange.file === file.path &&
                      line.lineNo.new === composerRange.endLine && (
                        <DiffCommentComposer
                          onSubmit={(body) => {
                            onAddComment?.(composerRange, body)
                            setComposerRange(null)
                            onSelectRange?.(null)
                          }}
                          onCancel={() => {
                            setComposerRange(null)
                            onSelectRange?.(null)
                          }}
                        />
                      )}
                    {(() => {
                      const pendingKey = lineNum ? `${file.path}:${lineNum}` : null
                      const pending = pendingKey ? pendingByPosition.get(pendingKey) : undefined
                      if (!pending || pending.length === 0) return null
                      return pending.map((pc) => (
                        <div
                          key={pc.id}
                          className="diff-comment-widget diff-comment-widget--pending"
                        >
                          <div className="diff-comment-widget__toggle">
                            <span>Pending comment</span>
                            <span className="diff-comment-widget__pending-badge">Pending</span>
                          </div>
                          <div className="diff-comment-widget__thread">
                            <div className="diff-comment-widget__comment">
                              <div className="diff-comment-widget__body">{pc.body}</div>
                              {onRemovePendingComment && (
                                <button
                                  className="diff-pending-comment__remove"
                                  onClick={() => onRemovePendingComment(pc.id)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    })()}
                  </React.Fragment>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
