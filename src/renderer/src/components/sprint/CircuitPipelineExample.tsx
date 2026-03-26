/**
 * CircuitPipelineExample — Example integration of CircuitPipeline in Sprint Center
 *
 * This file demonstrates how to use the CircuitPipeline neon component
 * to visualize the sprint task pipeline with a circuit board aesthetic.
 *
 * Usage:
 * 1. Import this component in SprintCenter.tsx
 * 2. Add it to the header or toolbar area
 * 3. Pass in the partition data from partitionSprintTasks
 */

import { useMemo } from 'react'
import { CircuitPipeline, type CircuitNode } from '../neon/CircuitPipeline'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import type { SprintTask } from './SprintCenter'

interface CircuitPipelineExampleProps {
  tasks: SprintTask[]
  compact?: boolean
  className?: string
}

export function CircuitPipelineExample({
  tasks,
  compact = false,
  className
}: CircuitPipelineExampleProps) {
  const nodes: CircuitNode[] = useMemo(() => {
    // Use the partition function to properly count tasks
    const partition = partitionSprintTasks(tasks)

    const queuedCount = partition.todo.length
    const activeCount = partition.inProgress.length
    const reviewCount = partition.awaitingReview.length
    const doneCount = partition.done.length

    return [
      {
        id: 'queued',
        label: 'Queued',
        count: queuedCount,
        accent: 'orange' as const,
        icon: '⏳',
        active: false
      },
      {
        id: 'active',
        label: 'Active',
        count: activeCount,
        accent: 'cyan' as const,
        icon: '⚡',
        active: activeCount > 0 // Active if there are any running tasks
      },
      {
        id: 'review',
        label: 'Review',
        count: reviewCount,
        accent: 'blue' as const,
        icon: '👁️',
        active: false
      },
      {
        id: 'done',
        label: 'Done',
        count: doneCount,
        accent: 'purple' as const,
        icon: '✓',
        active: false
      }
    ]
  }, [tasks])

  return (
    <CircuitPipeline
      nodes={nodes}
      orientation="horizontal"
      animated={true}
      compact={compact}
      className={className}
    />
  )
}

/**
 * Example integration in SprintCenter.tsx:
 *
 * import { CircuitPipelineExample } from './CircuitPipelineExample';
 *
 * // Add to the header section:
 * <div className="sprint-center__header">
 *   <div className="sprint-center__title-row">
 *     <span className="sprint-center__title text-gradient-aurora">SPRINT CENTER</span>
 *     <CircuitPipelineExample tasks={tasks} compact={true} />
 *   </div>
 *   ...
 * </div>
 *
 * Or as a standalone visualization panel:
 * <GlassPanel accent="purple" className="sprint-pipeline-viz">
 *   <CircuitPipelineExample tasks={filteredTasks} />
 * </GlassPanel>
 */
