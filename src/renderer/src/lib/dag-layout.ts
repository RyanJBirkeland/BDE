import type { SprintTask } from '../../../shared/types'

export interface DagNode {
  id: string
  task: SprintTask
  x: number
  y: number
  layer: number
}

export interface DagEdge {
  from: string
  to: string
  type: 'hard' | 'soft'
}

export interface DagLayout {
  nodes: DagNode[]
  edges: DagEdge[]
  width: number
  height: number
}

const NODE_HEIGHT = 60
const LAYER_SPACING = 200
const NODE_SPACING = 80
const PADDING = 40

/**
 * Compute DAG layout for sprint tasks based on dependencies.
 * Uses topological sort to assign layers, then spreads nodes horizontally.
 */
export function computeDagLayout(tasks: SprintTask[]): DagLayout {
  if (tasks.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 }
  }

  // Build dependency graph
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const edges: DagEdge[] = []
  const inDegree = new Map<string, number>()
  const outEdges = new Map<string, DagEdge[]>()

  // Initialize all tasks with in-degree 0
  for (const task of tasks) {
    inDegree.set(task.id, 0)
    outEdges.set(task.id, [])
  }

  // Build edge list and compute in-degrees
  for (const task of tasks) {
    if (task.depends_on) {
      for (const dep of task.depends_on) {
        // Only create edge if the dependency exists in the current task set
        if (taskMap.has(dep.id)) {
          const edge: DagEdge = { from: dep.id, to: task.id, type: dep.type }
          edges.push(edge)
          outEdges.get(dep.id)?.push(edge)
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
        }
      }
    }
  }

  // Topological sort with layer assignment (Kahn's algorithm)
  const layers: string[][] = []
  const layerMap = new Map<string, number>()
  const queue: string[] = []

  // Start with nodes that have no dependencies (in-degree 0)
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
      layerMap.set(id, 0)
    }
  }

  while (queue.length > 0) {
    const currentLayerSize = queue.length
    const currentLayer: string[] = []

    for (let i = 0; i < currentLayerSize; i++) {
      const nodeId = queue.shift()!
      currentLayer.push(nodeId)

      // Process outgoing edges
      const nodeOutEdges = outEdges.get(nodeId) ?? []
      for (const edge of nodeOutEdges) {
        const targetId = edge.to
        const newDegree = (inDegree.get(targetId) ?? 0) - 1
        inDegree.set(targetId, newDegree)

        if (newDegree === 0) {
          const sourceLayer = layerMap.get(nodeId) ?? 0
          layerMap.set(targetId, sourceLayer + 1)
          queue.push(targetId)
        }
      }
    }

    if (currentLayer.length > 0) {
      layers.push(currentLayer)
    }
  }

  // Handle cycles and unprocessed nodes (should not happen with valid DAG, but be defensive)
  const processedIds = new Set(layerMap.keys())
  const unprocessed = tasks.filter((t) => !processedIds.has(t.id))
  if (unprocessed.length > 0) {
    // Add remaining nodes to a final layer
    const finalLayer = unprocessed.map((t) => t.id)
    layers.push(finalLayer)
    const finalLayerIndex = layers.length - 1
    for (const id of finalLayer) {
      layerMap.set(id, finalLayerIndex)
    }
  }

  // Position nodes
  const nodes: DagNode[] = []
  let maxNodesInLayer = 0

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]
    if (!layer) continue
    maxNodesInLayer = Math.max(maxNodesInLayer, layer.length)

    for (let nodeIndex = 0; nodeIndex < layer.length; nodeIndex++) {
      const taskId = layer[nodeIndex]
      if (taskId === undefined) continue
      const task = taskMap.get(taskId)
      if (!task) continue

      const x = PADDING + layerIndex * LAYER_SPACING
      const y = PADDING + nodeIndex * (NODE_HEIGHT + NODE_SPACING)

      nodes.push({
        id: taskId,
        task,
        x,
        y,
        layer: layerIndex
      })
    }
  }

  // Compute dimensions
  const width = PADDING * 2 + layers.length * LAYER_SPACING
  const height = PADDING * 2 + maxNodesInLayer * (NODE_HEIGHT + NODE_SPACING)

  return { nodes, edges, width, height }
}

/**
 * Get status color for a task node.
 */
export function getNodeColor(status: SprintTask['status']): string {
  switch (status) {
    case 'backlog':
      return 'var(--bde-text-muted)'
    case 'queued':
      return 'var(--bde-accent)'
    case 'blocked':
      return 'var(--bde-warning)'
    case 'active':
      return 'var(--bde-status-active)'
    case 'review':
      return 'var(--bde-status-review)'
    case 'done':
      return 'var(--bde-status-done)'
    case 'cancelled':
    case 'failed':
    case 'error':
      return 'var(--bde-danger)'
    default:
      return 'var(--bde-text-muted)'
  }
}

/**
 * Get edge color based on dependency type.
 */
export function getEdgeColor(type: 'hard' | 'soft'): string {
  return type === 'hard' ? 'var(--bde-status-active)' : 'var(--bde-text-muted)'
}
