import { type NeonAccent, neonVar } from './types';

export interface PipelineStage {
  label: string;
  count: number;
  accent: NeonAccent;
}

interface PipelineFlowProps {
  stages: PipelineStage[];
}

export function PipelineFlow({ stages }: PipelineFlowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {stages.map((stage, i) => (
        <div key={stage.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            background: neonVar(stage.accent, 'surface'),
            border: `1px solid ${neonVar(stage.accent, 'border')}`,
            borderRadius: '6px',
            padding: '4px 10px',
            color: neonVar(stage.accent, 'color'),
            fontSize: '11px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {stage.label}: {stage.count}
          </div>
          {i < stages.length - 1 && (
            <span data-role="pipeline-arrow" style={{
              color: 'rgba(255, 255, 255, 0.2)',
              fontSize: '14px',
            }}>→</span>
          )}
        </div>
      ))}
    </div>
  );
}
