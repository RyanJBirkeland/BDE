import { useCallback } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import type { SpecType } from '../../../../shared/spec-validation'
import { useConfirm } from '../ui/ConfirmModal'
import { ConfirmModal } from '../ui/ConfirmModal'

const SPEC_TEMPLATES: Record<string, { label: string; spec: string; specType: SpecType }> = {
  feature: {
    label: 'Feature',
    specType: 'feature',
    spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n'
  },
  bugfix: {
    label: 'Bug Fix',
    specType: 'bugfix',
    spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n'
  },
  refactor: {
    label: 'Refactor',
    specType: 'refactor',
    spec: "## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope\n"
  },
  test: {
    label: 'Test',
    specType: 'test',
    spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n'
  }
}

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
        {Object.entries(SPEC_TEMPLATES).map(([key, tmpl]) => (
          <button
            key={key}
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
