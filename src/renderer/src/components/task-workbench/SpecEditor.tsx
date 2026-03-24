import { useCallback } from 'react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

const SPEC_TEMPLATES: Record<string, { label: string; spec: string }> = {
  feature: { label: 'Feature', spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n' },
  bugfix: { label: 'Bug Fix', spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n' },
  refactor: { label: 'Refactor', spec: "## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope\n" },
  test: { label: 'Test', spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n' },
}

interface SpecEditorProps {
  onRequestGenerate: () => void
  onRequestResearch: () => void
  generating: boolean
}

export function SpecEditor({ onRequestGenerate, onRequestResearch, generating }: SpecEditorProps) {
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
  }, [spec, setField])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
      <div style={{ display: 'flex', gap: tokens.space[2], flexWrap: 'wrap' }}>
        <button onClick={onRequestGenerate} disabled={generating} style={{
          background: tokens.color.accentDim, border: `1px solid ${tokens.color.accent}`,
          borderRadius: tokens.radius.md, color: tokens.color.accent,
          padding: `${tokens.space[1]} ${tokens.space[3]}`, fontSize: tokens.size.sm,
          cursor: generating ? 'wait' : 'pointer',
        }}>
          {generating ? 'Generating...' : 'Generate Spec'}
        </button>
        {Object.entries(SPEC_TEMPLATES).map(([key, tmpl]) => (
          <button key={key} onClick={() => setField('spec', tmpl.spec)} style={{
            background: 'none', border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md, color: tokens.color.textMuted,
            padding: `${tokens.space[1]} ${tokens.space[3]}`, fontSize: tokens.size.sm, cursor: 'pointer',
          }}>
            {tmpl.label}
          </button>
        ))}
        <button onClick={onRequestResearch} style={{
          background: 'none', border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md, color: tokens.color.textMuted,
          padding: `${tokens.space[1]} ${tokens.space[3]}`, fontSize: tokens.size.sm,
          cursor: 'pointer', marginLeft: 'auto',
        }}>
          Research Codebase
        </button>
      </div>
      <textarea
        value={spec}
        onChange={(e) => setField('spec', e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what the agent should do. The more specific, the better the results."
        style={{
          minHeight: 200, maxHeight: '60vh', resize: 'vertical',
          padding: tokens.space[3], background: tokens.color.surface,
          border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.lg,
          color: tokens.color.text, fontSize: tokens.size.md,
          fontFamily: tokens.font.code, lineHeight: 1.6, outline: 'none',
        }}
      />
    </div>
  )
}
