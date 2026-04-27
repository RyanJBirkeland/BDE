import { useCallback, useMemo } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import type { SpecType } from '../../../../shared/spec-validation'
import { DEFAULT_TASK_TEMPLATES } from '../../../../shared/constants'
import { useConfirm } from '../ui/ConfirmModal'
import { ConfirmModal } from '../ui/ConfirmModal'
import { analyzeSpec } from './spec-quality'
import './SpecEditor.css'

const SPEC_TEMPLATES: Array<{ label: string; spec: string; specType: SpecType }> = [
  { label: 'Feature', specType: 'feature', spec: DEFAULT_TASK_TEMPLATES[1].promptPrefix },
  { label: 'Bug Fix', specType: 'bugfix', spec: DEFAULT_TASK_TEMPLATES[0].promptPrefix },
  { label: 'Refactor', specType: 'refactor', spec: DEFAULT_TASK_TEMPLATES[2].promptPrefix },
  { label: 'Test', specType: 'test', spec: DEFAULT_TASK_TEMPLATES[3].promptPrefix }
]

interface SpecEditorProps {
  onRequestGenerate: () => void
  onRequestResearch: () => void
  generating: boolean
}

export function SpecEditor({
  onRequestGenerate,
  onRequestResearch,
  generating
}: SpecEditorProps): React.JSX.Element {
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)
  const setSpecType = useTaskWorkbenchStore((s) => s.setSpecType)
  const { confirm, confirmProps } = useConfirm()

  const handleTemplateClick = useCallback(
    async (templateSpec: string, templateType: SpecType) => {
      // If spec is empty, apply immediately without confirmation
      if (!spec.trim()) {
        setField('spec', templateSpec)
        setSpecType(templateType)
        return
      }

      // Otherwise, confirm overwrite
      const confirmed = await confirm({
        title: 'Overwrite spec?',
        message: 'This will replace your current spec content. Continue?',
        confirmLabel: 'Overwrite'
      })

      if (confirmed) {
        setField('spec', templateSpec)
        setSpecType(templateType)
      }
    },
    [spec, setField, setSpecType, confirm]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const target = e.currentTarget
        const start = target.selectionStart
        const end = target.selectionEnd
        const newValue = spec.substring(0, start) + '  ' + spec.substring(end)
        setField('spec', newValue)
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2
        })
      }
    },
    [spec, setField]
  )

  return (
    <div className="wb-spec">
      <div className="wb-spec__toolbar">
        <button
          onClick={onRequestGenerate}
          disabled={generating}
          className="wb-spec__btn wb-spec__btn--primary"
          aria-label="Generate spec automatically"
        >
          {generating ? 'Generating...' : 'Generate Spec'}
        </button>
        {SPEC_TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.label}
            onClick={() => handleTemplateClick(tmpl.spec, tmpl.specType)}
            className="wb-spec__btn"
            aria-label={`Insert ${tmpl.label} template`}
          >
            {tmpl.label}
          </button>
        ))}
        <button
          onClick={onRequestResearch}
          className="wb-spec__btn wb-spec__btn--research"
          aria-label="Ask AI to research codebase"
        >
          Research Codebase
        </button>
        <SpecQualityHints spec={spec} />
      </div>
      <textarea
        id="wb-form-spec"
        value={spec}
        onChange={(e) => setField('spec', e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what the agent should do. The more specific, the better the results."
        className="wb-spec__textarea"
      />
      <ConfirmModal {...confirmProps} />
    </div>
  )
}

const SPEC_QUEUE_MIN_CHARS = 50

function SpecQualityHints({ spec }: { spec: string }): React.JSX.Element {
  const indicators = useMemo(() => analyzeSpec(spec), [spec])
  const trimmedLength = useMemo(() => spec.trim().length, [spec])
  const belowQueueMinimum = trimmedLength < SPEC_QUEUE_MIN_CHARS
  const dotStyle = (on: boolean): React.CSSProperties => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: on ? 'var(--fleet-accent)' : 'var(--fleet-text-muted)',
    marginRight: 4
  })
  return (
    <div
      className="wb-spec__quality"
      aria-label="Spec quality hints"
      role="group"
      data-testid="spec-quality"
      style={{
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: '0.75rem',
        color: 'var(--fleet-text-muted)'
      }}
    >
      {belowQueueMinimum ? (
        <span
          className="wb-spec__quality-char-warning"
          title="Specs must be at least 50 characters to queue."
          data-testid="spec-quality-char-warning"
          style={{ color: 'var(--fleet-warning)', fontWeight: 600 }}
        >
          {trimmedLength}/{SPEC_QUEUE_MIN_CHARS} chars to queue
        </span>
      ) : (
        <span
          className="wb-spec__quality-word-count"
          title="Total words in the spec. Longer isn't always better — aim for clarity."
          data-testid="spec-quality-words"
        >
          {indicators.wordCount} words
        </span>
      )}
      <span
        title={
          indicators.hasFilePaths
            ? 'Spec mentions specific file paths — agents waste fewer tokens exploring.'
            : 'No file paths detected. Add paths like `src/foo/bar.ts` to focus the agent.'
        }
        data-testid="spec-quality-files"
        aria-label={indicators.hasFilePaths ? 'File paths: present' : 'File paths: missing'}
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        <span style={dotStyle(indicators.hasFilePaths)} />
        files
      </span>
      <span
        title={
          indicators.hasTestSection
            ? 'Spec mentions testing — the agent is more likely to verify its work.'
            : "No testing guidance detected. Add a '## How to Test' section."
        }
        data-testid="spec-quality-tests"
        aria-label={indicators.hasTestSection ? 'Test section: present' : 'Test section: missing'}
        style={{ display: 'inline-flex', alignItems: 'center' }}
      >
        <span style={dotStyle(indicators.hasTestSection)} />
        tests
      </span>
    </div>
  )
}
