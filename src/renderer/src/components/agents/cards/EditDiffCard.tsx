import { parseDiff, type DiffFile } from '../../../lib/diff-parser'
import { buildSyntheticDiff } from '../../../lib/spec-diff'
import './EditDiffCard.css'

interface EditDiffCardProps {
  input: unknown
}

function renderDiffLines(files: DiffFile[]): React.JSX.Element {
  return (
    <div className="edit-diff-card">
      {files.map((file, fileIdx) => (
        <div key={fileIdx}>
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={hunkIdx}>
              {hunk.lines.map((line, lineIdx) => {
                const rowClass =
                  line.type === 'add'
                    ? 'edit-diff-card__row--add'
                    : line.type === 'del'
                      ? 'edit-diff-card__row--del'
                      : 'edit-diff-card__row--ctx'

                return (
                  <div key={lineIdx} className={`edit-diff-card__row ${rowClass}`}>
                    <span className="edit-diff-card__line-no">
                      {line.type === 'del' || line.type === 'ctx' ? line.lineNo.old : ''}
                    </span>
                    <span className="edit-diff-card__line-no">
                      {line.type === 'add' || line.type === 'ctx' ? line.lineNo.new : ''}
                    </span>
                    <span className="edit-diff-card__content">{line.content}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function renderCodeBlock(content: string): React.JSX.Element {
  const lines = content.split('\n')
  return (
    <div className="edit-diff-card">
      {lines.map((line, idx) => (
        <div key={idx} className="edit-diff-card__row edit-diff-card__row--ctx">
          <span className="edit-diff-card__line-no">{idx + 1}</span>
          <span className="edit-diff-card__content">{line}</span>
        </div>
      ))}
    </div>
  )
}

export function EditDiffCard({ input }: EditDiffCardProps): React.JSX.Element | null {
  if (!input || typeof input !== 'object') return null

  const inputObj = input as Record<string, unknown>

  // Edit tool: old_string + new_string
  if ('old_string' in inputObj && 'new_string' in inputObj) {
    const oldStr = String(inputObj.old_string ?? '')
    const newStr = String(inputObj.new_string ?? '')
    const filePath = String(inputObj.file_path ?? 'file')

    const diffRaw = buildSyntheticDiff(filePath, oldStr, newStr)
    const files = parseDiff(diffRaw)

    return renderDiffLines(files)
  }

  // Write tool: content
  if ('content' in inputObj) {
    const content = String(inputObj.content ?? '')
    return renderCodeBlock(content)
  }

  return null
}
