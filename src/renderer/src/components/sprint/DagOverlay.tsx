import { useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { computeDagLayout, getNodeColor, getEdgeColor } from '../../lib/dag-layout'
import type { SprintTask } from '../../../../shared/types'
import type { DagEdge } from '../../lib/dag-layout'

interface DagOverlayProps {
  tasks: SprintTask[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onClose: () => void
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

export function DagOverlay({
  tasks,
  selectedTaskId,
  onSelectTask,
  onClose
}: DagOverlayProps): React.JSX.Element {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Compute layout
  const layout = useMemo(() => computeDagLayout(tasks), [tasks])

  // Node click handler
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onSelectTask(nodeId)
    },
    [onSelectTask]
  )

  // Generate SVG path for edge (cubic bezier curve)
  const getEdgePath = useCallback(
    (edge: DagEdge): string => {
      const fromNode = layout.nodes.find((n) => n.id === edge.from)
      const toNode = layout.nodes.find((n) => n.id === edge.to)

      if (!fromNode || !toNode) return ''

      const x1 = fromNode.x + NODE_WIDTH
      const y1 = fromNode.y + NODE_HEIGHT / 2
      const x2 = toNode.x
      const y2 = toNode.y + NODE_HEIGHT / 2

      // Control points for smooth curve
      const dx = x2 - x1
      const cx1 = x1 + dx * 0.5
      const cx2 = x2 - dx * 0.5

      return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
    },
    [layout.nodes]
  )

  // Truncate long titles
  const truncate = (text: string, maxLen: number): string => {
    return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text
  }

  if (layout.nodes.length === 0) {
    return (
      <div className="dag-overlay">
        <div className="dag-overlay__header">
          <h2 className="dag-overlay__title">Task Dependencies</h2>
          <button className="dag-overlay__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="dag-overlay__empty">No tasks to visualize</div>
      </div>
    )
  }

  return (
    <div className="dag-overlay">
      <div className="dag-overlay__header">
        <h2 className="dag-overlay__title">Task Dependencies</h2>
        <div className="dag-overlay__legend">
          <span className="dag-overlay__legend-item">
            <span className="dag-overlay__legend-line dag-overlay__legend-line--hard" />
            Hard
          </span>
          <span className="dag-overlay__legend-item">
            <span className="dag-overlay__legend-line dag-overlay__legend-line--soft" />
            Soft
          </span>
        </div>
        <button className="dag-overlay__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="dag-overlay__canvas">
        <svg
          className="dag-overlay__svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-label="Task dependency graph"
        >
          {/* Render edges first (so they appear behind nodes) */}
          <g className="dag-overlay__edges">
            {layout.edges.map((edge, i) => (
              <path
                key={`edge-${i}`}
                d={getEdgePath(edge)}
                stroke={getEdgeColor(edge.type)}
                strokeWidth={edge.type === 'hard' ? 2 : 1}
                fill="none"
                opacity={edge.type === 'hard' ? 0.8 : 0.4}
                strokeDasharray={edge.type === 'soft' ? '4 4' : undefined}
              />
            ))}
          </g>

          {/* Render nodes */}
          <g className="dag-overlay__nodes">
            {layout.nodes.map((node) => {
              const isSelected = node.id === selectedTaskId
              const fillColor = getNodeColor(node.task.status)

              return (
                <g
                  key={node.id}
                  className="dag-overlay__node dag-overlay__node--clickable"
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => handleNodeClick(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleNodeClick(node.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.task.title}: ${node.task.status}`}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill="var(--bde-surface)"
                    stroke={fillColor}
                    strokeWidth={isSelected ? 3 : 1.5}
                    opacity={isSelected ? 1 : 0.8}
                  />
                  <text
                    x={NODE_WIDTH / 2}
                    y={NODE_HEIGHT / 2 - 8}
                    textAnchor="middle"
                    fill={fillColor}
                    fontSize={12}
                    fontWeight={600}
                    fontFamily="var(--bde-font-code)"
                  >
                    {truncate(node.task.title, 20)}
                  </text>
                  <text
                    x={NODE_WIDTH / 2}
                    y={NODE_HEIGHT / 2 + 8}
                    textAnchor="middle"
                    fill="var(--bde-text-muted)"
                    fontSize={10}
                    fontFamily="var(--bde-font-code)"
                  >
                    {node.task.status}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
