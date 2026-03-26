import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface PipelineStage {
  label: string
  count: number
  accent: NeonAccent
}

interface PipelineFlowProps {
  stages: PipelineStage[]
}

export function PipelineFlow({ stages }: PipelineFlowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1], flexWrap: 'wrap' }}>
      {stages.map((stage, i) => (
        <div
          key={stage.label}
          style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}
        >
          <div
            style={{
              background: neonVar(stage.accent, 'surface'),
              border: `1px solid ${neonVar(stage.accent, 'border')}`,
              borderRadius: tokens.radius.md,
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              color: neonVar(stage.accent, 'color'),
              fontSize: tokens.size.xs,
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
                color: tokens.neon.textDim,
                fontSize: tokens.size.lg
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
