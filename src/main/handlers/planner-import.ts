/**
 * Plan import handler — parses markdown plan files into epic + tasks.
 */
import type Database from 'better-sqlite3'
import { readFile } from 'fs/promises'
import type { TaskGroup, SprintTask } from '../../shared/types'
import type { DialogService } from '../dialog-service'
import { createGroup } from '../data/task-group-queries'
import { createTask } from '../services/sprint-service'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { getConfiguredRepos } from '../paths'

const logger = createLogger('planner-import')

export interface ParsedTask {
  title: string
  spec: string
}

export interface ParsedPlan {
  epicName: string
  tasks: ParsedTask[]
}

export interface ImportOptions {
  repo: string
  db?: Database.Database
}

export interface ImportResult {
  epic: TaskGroup
  tasks: SprintTask[]
}

/**
 * Parse markdown plan file into epic name and task list.
 *
 * Expected structure:
 * - H1 (#) = epic name
 * - H2 (##) "Tasks" section
 * - H3 (###) under Tasks = individual tasks
 */
export function parsePlanMarkdown(markdown: string): ParsedPlan {
  const lines = markdown.split('\n')
  let epicName = 'Untitled Plan'
  const tasks: ParsedTask[] = []

  let inTasksSection = false
  let currentTask: ParsedTask | null = null

  for (const line of lines) {
    // Extract H1 as epic name
    const h1Match = line.match(/^# (.+)$/)
    if (h1Match?.[1]) {
      epicName = h1Match[1].trim()
      continue
    }

    // Detect Tasks section
    const h2Match = line.match(/^## (.+)$/)
    if (h2Match?.[1]) {
      const sectionName = h2Match[1].trim()
      inTasksSection = sectionName === 'Tasks'
      // If we left the Tasks section, stop collecting tasks
      if (!inTasksSection && currentTask) {
        tasks.push(currentTask)
        currentTask = null
      }
      continue
    }

    // Extract H3 as task titles (only if in Tasks section)
    const h3Match = line.match(/^### (.+)$/)
    if (h3Match?.[1] && inTasksSection) {
      // Save previous task if exists
      if (currentTask) {
        tasks.push(currentTask)
      }
      // Start new task
      currentTask = {
        title: h3Match[1].trim(),
        spec: ''
      }
      continue
    }

    // Accumulate spec content for current task
    if (currentTask) {
      if (currentTask.spec) {
        currentTask.spec += '\n' + line
      } else {
        currentTask.spec = line
      }
    }
  }

  // Don't forget the last task
  if (currentTask) {
    tasks.push(currentTask)
  }

  // Trim task specs
  tasks.forEach((t) => {
    t.spec = t.spec.trim()
  })

  return { epicName, tasks }
}

/**
 * Import a plan file into the database.
 * Creates a task group (epic) and associated tasks.
 */
export async function importPlanFile(markdown: string, options: ImportOptions): Promise<ImportResult> {
  const { repo, db } = options
  const parsed = parsePlanMarkdown(markdown)

  // Create epic
  const epic = createGroup(
    {
      name: parsed.epicName,
      icon: 'P',
      accent_color: '#00ffcc'
    },
    db
  )

  if (!epic) {
    throw new Error('Failed to create task group')
  }

  logger.info(`Created epic: ${epic.name} (${epic.id})`)

  // Create tasks
  const tasks: SprintTask[] = []
  for (const parsedTask of parsed.tasks) {
    const task = await createTask({
      title: parsedTask.title,
      repo,
      status: 'backlog',
      priority: 1,
      group_id: epic.id,
      ...(parsedTask.spec ? { spec: parsedTask.spec } : {})
    })

    if (!task) {
      logger.warn(`Failed to create task: ${parsedTask.title}`)
      continue
    }

    tasks.push(task)
    logger.info(`Created task: ${task.title} (${task.id})`)
  }

  return { epic, tasks }
}

export interface PlannerImportDeps {
  dialog: DialogService
}

/**
 * Register planner import IPC handlers.
 */
export function registerPlannerImportHandlers(deps: PlannerImportDeps): void {
  safeHandle('planner:import', async (_e, repo: string) => {
    // Validate repo against configured repos to prevent arbitrary repo imports
    const configuredRepos = getConfiguredRepos()
    const isConfigured = configuredRepos.some((r) => r.name.toLowerCase() === repo.toLowerCase())
    if (!isConfigured) {
      const names = configuredRepos.map((r) => r.name).join(', ')
      throw new Error(`Repo "${repo}" is not configured. Configured repos: ${names || 'none'}`)
    }

    // Show file picker
    const result = await deps.dialog.showOpenDialog({
      title: 'Import Plan Document',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error('No file selected')
    }

    const filePath = result.filePaths[0]
    if (!filePath) {
      throw new Error('No file selected')
    }
    logger.info(`Importing plan from: ${filePath}`)

    // Read file
    const markdown = await readFile(filePath, 'utf-8')

    // Import
    const importResult = await importPlanFile(markdown, { repo })

    return {
      epicId: importResult.epic.id,
      epicName: importResult.epic.name,
      taskCount: importResult.tasks.length
    }
  })
}
