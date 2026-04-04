export interface ExtractedTask {
  taskNumber: number
  title: string
  spec: string
  phase: string | null
  dependsOnTaskNumbers: number[]
}

const TASK_HEADING_RE = /^###\s+Task\s+(\d+):\s*(.+)$/
const DEPENDS_RE = /\*\*Depends on:\*\*\s*(.+)/i
const PHASE_RE = /^##\s+(Phase\s+\d+[^#]*)/

export function extractTasksFromPlan(markdown: string): ExtractedTask[] {
  const lines = markdown.split('\n')
  const tasks: ExtractedTask[] = []
  let currentPhase: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const phaseMatch = lines[i].match(PHASE_RE)
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim()
      continue
    }

    const taskMatch = lines[i].match(TASK_HEADING_RE)
    if (!taskMatch) continue

    const taskNumber = parseInt(taskMatch[1], 10)
    const title = taskMatch[2].trim()

    // Collect body until next ### heading or end of file
    const bodyLines: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j].match(/^###\s/)) {
      bodyLines.push(lines[j])
      j++
    }
    const spec = bodyLines.join('\n').trim()

    // Extract dependency references
    const dependsOnTaskNumbers: number[] = []
    const dependsMatch = spec.match(DEPENDS_RE)
    if (dependsMatch) {
      const dependsText = dependsMatch[1]
      // Match "Task N" patterns in the depends line
      const taskRefs = dependsText.matchAll(/Task\s+(\d+)/g)
      for (const ref of taskRefs) {
        dependsOnTaskNumbers.push(parseInt(ref[1], 10))
      }
    }

    tasks.push({
      taskNumber,
      title,
      spec,
      phase: currentPhase,
      dependsOnTaskNumbers
    })
  }

  return tasks
}
