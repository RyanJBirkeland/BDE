import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { NeonAccent } from './types'
import { neonVar } from './types'
import { formatCount, STAGE_CONFIG, type SankeyStageKey } from './sankey-utils'
import '../../assets/sankey-pipeline.css'

interface SankeyPipelineProps {
  stages: {
    queued: number
    active: number
    review: number
    done: number
    blocked: number
    failed: number
  }
  onStageClick?: ((stage: SankeyStageKey) => void) | undefined
  animated?: boolean | undefined
  className?: string | undefined
}

/** Node layout positions within the SVG viewBox (540x160). */
const NODE_POS: Record<SankeyStageKey, { x: number; y: number; w: number; h: number }> = {
  queued: { x: 8, y: 25, w: 82, h: 65 },
  active: { x: 160, y: 22, w: 80, h: 55 },
  review: { x: 310, y: 22, w: 85, h: 55 },
  done: { x: 455, y: 18, w: 75, h: 50 },
  blocked: { x: 160, y: 105, w: 80, h: 40 },
  failed: { x: 355, y: 100, w: 75, h: 40 }
}

/** Stage render order (main path then branches). */
const STAGE_ORDER: SankeyStageKey[] = ['queued', 'active', 'review', 'done', 'blocked', 'failed']

/** Main flow connections: from → to (happy path). */
const MAIN_FLOWS: [SankeyStageKey, SankeyStageKey][] = [
  ['queued', 'active'],
  ['active', 'review'],
  ['review', 'done']
]

/** Branch flow connections (problem paths). */
const BRANCH_FLOWS: [SankeyStageKey, SankeyStageKey][] = [
  ['active', 'blocked'],
  ['active', 'failed'],
  ['review', 'failed']
]

function flowPath(from: SankeyStageKey, to: SankeyStageKey): string {
  const a = NODE_POS[from]
  const b = NODE_POS[to]
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = b.y + b.h / 2
  const cpx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`
}

/**
 * SankeyPipeline — SVG-based Sankey pipeline visualization.
 * Renders stage nodes connected by flow paths with click interaction
 * and keyboard accessibility.
 */
/** Composite path through happy-path node centers: queued → active → review → done. */
function buildHappyPathD(): string {
  const nodes: SankeyStageKey[] = ['queued', 'active', 'review', 'done']
  const centers = nodes.map((k) => {
    const p = NODE_POS[k]
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 }
  })
  const start = centers[0]
  if (!start) return ''
  let d = `M ${start.x} ${start.y}`
  for (let i = 0; i < centers.length - 1; i++) {
    const c1 = centers[i]
    const c2 = centers[i + 1]
    if (!c1 || !c2) continue
    const cpx = (c1.x + c2.x) / 2
    d += ` C ${cpx} ${c1.y}, ${cpx} ${c2.y}, ${c2.x} ${c2.y}`
  }
  return d
}

const HAPPY_PATH_D = buildHappyPathD()

export function SankeyPipeline({
  stages,
  onStageClick,
  animated,
  className = ''
}: SankeyPipelineProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const showParticles = animated !== false && !reduced

  // --- Transition detection ---
  const prevStagesRef = useRef(stages)
  const timeoutRefs = useRef<number[]>([])
  const [transitions, setTransitions] = useState<
    Array<{
      id: string
      to: SankeyStageKey
      accent: NeonAccent
      startTime: number
    }>
  >([])

  // Clean up all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((id) => clearTimeout(id))
    }
  }, [])

  useEffect(() => {
    const prev = prevStagesRef.current
    prevStagesRef.current = stages

    if (reduced || animated === false) return

    const newTransitions: typeof transitions = []

    // Find stages where count increased — these are transition destinations
    for (const key of STAGE_ORDER) {
      if (stages[key] > prev[key]) {
        newTransitions.push({
          id: `${key}-${Date.now()}`,
          to: key as SankeyStageKey,
          accent: STAGE_CONFIG[key as SankeyStageKey].accent,
          startTime: Date.now()
        })
      }
    }

    if (newTransitions.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: transition detection requires synchronous state update to trigger animation ripples before the next paint
      setTransitions((t) => [...t, ...newTransitions])
      // Clean up after animation duration (800ms)
      const timeoutId = window.setTimeout(() => {
        setTransitions((t) => t.filter((tr) => !newTransitions.some((n) => n.id === tr.id)))
        timeoutRefs.current = timeoutRefs.current.filter((id) => id !== timeoutId)
      }, 800)
      timeoutRefs.current.push(timeoutId)
    }
  }, [stages, reduced, animated])

  // Set of stage keys with active transitions (for count flash)
  const flashingStages = useMemo(() => new Set(transitions.map((t) => t.to)), [transitions])

  function handleClick(key: SankeyStageKey): void {
    onStageClick?.(key)
  }

  function handleKeyDown(e: React.KeyboardEvent, key: SankeyStageKey): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onStageClick?.(key)
    }
  }

  return (
    <svg
      className={className}
      viewBox="0 0 540 160"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Task pipeline flow"
    >
      <defs>
        <filter id="sankey-glow">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Layer 1 — Flow paths (behind nodes) */}
      {MAIN_FLOWS.map(([from, to]) => {
        const config = STAGE_CONFIG[from]
        return (
          <path
            key={`main-${from}-${to}`}
            data-role="sankey-flow-main"
            d={flowPath(from, to)}
            fill="none"
            stroke={neonVar(config.accent, 'border')}
            strokeWidth={16}
            strokeLinecap="round"
            strokeOpacity={0.18}
          />
        )
      })}

      {BRANCH_FLOWS.map(([from, to]) => (
        <path
          key={`branch-${from}-${to}`}
          data-role="sankey-flow-branch"
          d={flowPath(from, to)}
          fill="none"
          stroke={neonVar('red', 'border')}
          strokeWidth={4}
          strokeLinecap="round"
          strokeOpacity={0.1}
        />
      ))}

      {/* Layer 2 — Nodes */}
      {STAGE_ORDER.map((key) => {
        const config = STAGE_CONFIG[key]
        const pos = NODE_POS[key]
        const count = stages[key]
        const rx = 6

        return (
          <g
            key={key}
            data-role="sankey-node"
            data-stage={key}
            className="sankey-node"
            role="button"
            tabIndex={0}
            aria-label={`${count} ${key} tasks — click to view`}
            onClick={() => handleClick(key)}
            onKeyDown={(e) => handleKeyDown(e, key)}
          >
            {/* Background rect */}
            <rect
              className="sankey-node__bg"
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={pos.h}
              rx={rx}
              fill={neonVar(config.accent, 'surface')}
              stroke={neonVar(config.accent, 'border')}
              strokeWidth={1.5}
              filter="url(#sankey-glow)"
            />

            {/* Focus ring */}
            <rect
              className="sankey-node__focus-ring"
              x={pos.x - 2}
              y={pos.y - 2}
              width={pos.w + 4}
              height={pos.h + 4}
              rx={rx + 2}
              fill="none"
              stroke={neonVar(config.accent, 'color')}
              strokeWidth={2}
            />

            {/* Pulse ring for active node */}
            {key === 'active' && (
              <rect
                className="sankey-pulse-ring"
                x={pos.x - 4}
                y={pos.y - 4}
                width={pos.w + 8}
                height={pos.h + 8}
                rx={rx + 4}
                fill="none"
                stroke={neonVar(config.accent, 'color')}
                strokeWidth={1.5}
              />
            )}

            {/* Count text */}
            <text
              className={flashingStages.has(key) ? 'sankey-count-flash' : undefined}
              x={pos.x + pos.w / 2}
              y={pos.y + (config.problem ? pos.h / 2 - 1 : pos.h / 2 - 4)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={neonVar(config.accent, 'color')}
              fontSize={config.problem ? 14 : 18}
              fontWeight={700}
              style={{}}
            >
              {formatCount(count)}
            </text>

            {/* Label text */}
            <text
              x={pos.x + pos.w / 2}
              y={pos.y + (config.problem ? pos.h / 2 + 12 : pos.h / 2 + 14)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={neonVar(config.accent, 'color')}
              fontSize={9}
              fontWeight={600}
              letterSpacing="0.5"
              opacity={0.8}
            >
              {config.label}
            </text>
          </g>
        )
      })}

      {/* Layer 3 — Ambient particles along happy path */}
      {showParticles && (
        <>
          <circle
            className="sankey-particle"
            r={3.5}
            fill="currentColor"
            filter="url(#sankey-glow)"
            opacity={0}
          >
            <animateMotion dur="7s" repeatCount="indefinite" begin="0s" path={HAPPY_PATH_D} />
            <animate
              attributeName="fill"
              values="#ffa500;#0ff;#b482ff;#0080ff;#0080ff"
              dur="7s"
              repeatCount="indefinite"
              begin="0s"
            />
            <animate
              attributeName="opacity"
              values="0;0.85;0.85;0.85;0"
              dur="7s"
              repeatCount="indefinite"
              begin="0s"
            />
          </circle>
          <circle
            className="sankey-particle"
            r={2.5}
            fill="currentColor"
            filter="url(#sankey-glow)"
            opacity={0}
          >
            <animateMotion dur="6s" repeatCount="indefinite" begin="2.5s" path={HAPPY_PATH_D} />
            <animate
              attributeName="fill"
              values="#ffa500;#0ff;#b482ff;#0080ff;#0080ff"
              dur="6s"
              repeatCount="indefinite"
              begin="2.5s"
            />
            <animate
              attributeName="opacity"
              values="0;0.7;0.7;0.7;0"
              dur="6s"
              repeatCount="indefinite"
              begin="2.5s"
            />
          </circle>
          <circle
            className="sankey-particle"
            r={2}
            fill="currentColor"
            filter="url(#sankey-glow)"
            opacity={0}
          >
            <animateMotion dur="8s" repeatCount="indefinite" begin="5s" path={HAPPY_PATH_D} />
            <animate
              attributeName="fill"
              values="#ffa500;#0ff;#b482ff;#0080ff;#0080ff"
              dur="8s"
              repeatCount="indefinite"
              begin="5s"
            />
            <animate
              attributeName="opacity"
              values="0;0.6;0.6;0.6;0"
              dur="8s"
              repeatCount="indefinite"
              begin="5s"
            />
          </circle>
        </>
      )}

      {/* Layer 4 — Transition ripple effects */}
      {transitions.map((t) => {
        const pos = NODE_POS[t.to]
        return (
          <rect
            key={t.id}
            className="sankey-ripple"
            x={pos.x - 4}
            y={pos.y - 4}
            width={pos.w + 8}
            height={pos.h + 8}
            rx={10}
            fill="none"
            stroke={neonVar(t.accent, 'color')}
            strokeWidth={2}
          />
        )
      })}
    </svg>
  )
}
