import { type ReactNode } from 'react'
import { tokens } from '../../design-system/tokens'
import { type NeonAccent, neonVar } from './types'

export interface CircuitNode {
  id: string
  label: string
  count: number
  accent: NeonAccent
  icon?: ReactNode
  active?: boolean
}

interface CircuitPipelineProps {
  nodes: CircuitNode[]
  orientation?: 'horizontal' | 'vertical'
  animated?: boolean
  compact?: boolean
  className?: string
}

/**
 * CircuitPipeline — visualizes pipeline stages with circuit board aesthetic
 * Features animated "current flow" effect and neon-styled nodes
 */
export function CircuitPipeline({
  nodes,
  orientation = 'horizontal',
  animated = true,
  compact = false,
  className = ''
}: CircuitPipelineProps) {
  const isHorizontal = orientation === 'horizontal'
  const nodeSize = compact ? 64 : 80
  const connectorThickness = compact ? 2 : 3

  return (
    <div
      className={`circuit-pipeline ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        alignItems: 'center',
        gap: isHorizontal ? tokens.space[6] : tokens.space[4],
        padding: compact ? tokens.space[3] : tokens.space[4],
        position: 'relative'
      }}
      data-orientation={orientation}
    >
      {nodes.map((node, i) => (
        <div
          key={node.id}
          style={{
            display: 'flex',
            flexDirection: isHorizontal ? 'row' : 'column',
            alignItems: 'center',
            gap: isHorizontal ? tokens.space[6] : tokens.space[4],
            position: 'relative'
          }}
        >
          {/* Circuit Node */}
          <div
            data-role="circuit-node"
            data-active={node.active || undefined}
            style={
              {
                position: 'relative',
                width: `${nodeSize}px`,
                height: `${nodeSize}px`,
                borderRadius: tokens.radius.xl,
                background: `linear-gradient(135deg, ${neonVar(node.accent, 'surface')}, ${tokens.neon.surfaceDeep})`,
                border: `2px solid ${neonVar(node.accent, 'border')}`,
                boxShadow: node.active
                  ? `${neonVar(node.accent, 'glow')}, inset 0 1px 0 ${tokens.neon.surfaceSubtle}`
                  : `inset 0 1px 0 ${tokens.neon.surfaceDim}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: tokens.space[1],
                transition: 'all 200ms ease',
                animation:
                  node.active && animated ? 'circuit-pulse 2s ease-in-out infinite' : undefined,
                '--pulse-shadow-min': `0 0 8px ${neonVar(node.accent, 'border')}`,
                '--pulse-shadow-max': `0 0 20px ${neonVar(node.accent, 'border')}`
              } as React.CSSProperties
            }
          >
            {/* Corner accent dots */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '6px',
                left: '6px',
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: neonVar(node.accent, 'color'),
                boxShadow: neonVar(node.accent, 'glow')
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: neonVar(node.accent, 'color'),
                boxShadow: neonVar(node.accent, 'glow')
              }}
            />

            {/* Icon */}
            {node.icon && (
              <div
                style={{
                  color: neonVar(node.accent, 'color'),
                  fontSize: compact ? tokens.size.lg : tokens.size.xxl,
                  lineHeight: 1
                }}
              >
                {node.icon}
              </div>
            )}

            {/* Count */}
            <div
              style={{
                color: neonVar(node.accent, 'color'),
                fontSize: compact ? tokens.size.xl : tokens.size.xxl,
                fontWeight: 700,
                lineHeight: 1,
                textShadow: neonVar(node.accent, 'glow')
              }}
            >
              {node.count}
            </div>

            {/* Label */}
            <div
              style={{
                color: neonVar(node.accent, 'color'),
                fontSize: tokens.size.xs,
                fontWeight: 600,
                letterSpacing: '0.5px',
                textTransform: 'uppercase' as const,
                opacity: 0.8
              }}
            >
              {node.label}
            </div>
          </div>

          {/* Circuit Trace Connector */}
          {i < nodes.length - 1 && (
            <div
              data-role="circuit-trace"
              style={{
                position: 'relative',
                width: isHorizontal ? '32px' : `${connectorThickness}px`,
                height: isHorizontal ? `${connectorThickness}px` : '32px',
                background: `linear-gradient(${
                  isHorizontal ? 'to right' : 'to bottom'
                }, ${neonVar(node.accent, 'border')}, ${neonVar(nodes[i + 1].accent, 'border')})`,
                borderRadius: '2px',
                overflow: 'hidden'
              }}
            >
              {/* Animated current flow */}
              {animated && (
                <div
                  aria-hidden="true"
                  data-role="current-pulse"
                  style={{
                    position: 'absolute',
                    width: isHorizontal ? '8px' : '100%',
                    height: isHorizontal ? '100%' : '8px',
                    background: `linear-gradient(${
                      isHorizontal ? 'to right' : 'to bottom'
                    }, transparent, ${neonVar(node.accent, 'color')}, transparent)`,
                    boxShadow: neonVar(node.accent, 'glow'),
                    animation: `circuit-flow-${orientation} 2s ease-in-out infinite`,
                    opacity: 0.6
                  }}
                />
              )}

              {/* Connection node dots at ends */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  [isHorizontal ? 'left' : 'top']: '-2px',
                  [isHorizontal ? 'top' : 'left']: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: neonVar(node.accent, 'color'),
                  boxShadow: neonVar(node.accent, 'glow')
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  [isHorizontal ? 'right' : 'bottom']: '-2px',
                  [isHorizontal ? 'top' : 'left']: '50%',
                  transform: 'translate(50%, -50%)',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: neonVar(nodes[i + 1].accent, 'color'),
                  boxShadow: neonVar(nodes[i + 1].accent, 'glow')
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
