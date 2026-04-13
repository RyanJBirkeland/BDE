import { type NeonAccent, neonVar } from './types'

export interface PipelineStage {
  label: string
  count: number
  accent: NeonAccent
}

interface PipelineFlowProps {
  stages: PipelineStage[]
}

export function PipelineFlow({ stages }: PipelineFlowProps): React.JSX.Element {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-1)', flexWrap: 'wrap' }}
    >
      {stages.map((stage, i) => (
        <div
          key={stage.label}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--bde-space-1)' }}
        >
          <div
            style={{
              background: neonVar(stage.accent, 'surface'),
              border: `1px solid ${neonVar(stage.accent, 'border')}`,
              borderRadius: 'var(--bde-radius-md)',
              padding: `${'var(--bde-space-1)'} ${'var(--bde-space-2)'}`,
              color: neonVar(stage.accent, 'color'),
              fontSize: 'var(--bde-size-xs)',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}
          >
            {stage.label}: {stage.count}
          </div>
          {i < stages.length - 1 && (
            <span
              data-role="pipeline-arrow"
              style={{
                color: 'var(--bde-text-dim)',
                fontSize: 'var(--bde-size-lg)'
              }}
            >
              →
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
