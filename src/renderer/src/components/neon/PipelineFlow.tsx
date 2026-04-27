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
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--fleet-space-1)', flexWrap: 'wrap' }}
    >
      {stages.map((stage, i) => (
        <div
          key={stage.label}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--fleet-space-1)' }}
        >
          <div
            style={{
              background: neonVar(stage.accent, 'surface'),
              border: `1px solid ${neonVar(stage.accent, 'border')}`,
              borderRadius: 'var(--fleet-radius-md)',
              padding: `${'var(--fleet-space-1)'} ${'var(--fleet-space-2)'}`,
              color: neonVar(stage.accent, 'color'),
              fontSize: 'var(--fleet-size-xs)',
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
                color: 'var(--fleet-text-dim)',
                fontSize: 'var(--fleet-size-lg)'
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
