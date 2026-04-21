import { z } from 'zod'
import { TASK_STATUSES } from '../../shared/task-state-machine'

// --- Task schemas -----------------------------------------------------------

export const TaskStatusSchema = z.enum(TASK_STATUSES)

export const TaskDependencySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['hard', 'soft'])
})

/**
 * Write allow-list — fields an external agent may set on create/update.
 * Must stay structurally aligned with `CreateTaskInput` so MCP callers
 * aren't surprised when a field is accepted by the schema but silently
 * dropped downstream (or vice versa).
 * System-managed fields (claimed_by, pr_*, completed_at, agent_run_id,
 * failure_reason, etc.) are intentionally absent.
 */
export const TaskWriteFieldsSchema = z.object({
  title: z.string().min(1).max(500),
  repo: z.string().min(1).max(200),
  status: TaskStatusSchema.optional(),
  prompt: z.string().max(200_000).optional(),
  spec: z.string().max(200_000).optional(),
  spec_type: z.enum(['feature', 'bug-fix', 'refactor', 'test-coverage', 'freeform', 'prompt']).optional(),
  notes: z.string().max(10_000).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  depends_on: z.array(TaskDependencySchema).max(32).optional(),
  playground_enabled: z.boolean().optional(),
  max_runtime_ms: z.number().int().min(60_000).max(86_400_000).optional(),
  template_name: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(100).optional(),
  cross_repo_contract: z.string().max(10_000).optional(),
  group_id: z.string().min(1).nullable().optional(),
  /**
   * Escape hatch for batch/admin flows with hand-validated specs. When true,
   * bypasses the spec-structure readiness check (min length, required
   * headings) while still enforcing title, repo, and repo configuration.
   * The service logs a warning when this flag is set.
   */
  skipReadinessCheck: z.boolean().optional()
})

export const TaskCreateSchema = TaskWriteFieldsSchema
export const TaskUpdateSchema = z.object({
  id: z.string().min(1),
  patch: TaskWriteFieldsSchema.partial()
})

export const TaskListSchema = z.object({
  status: TaskStatusSchema.optional(),
  repo: z.string().min(1).optional(),
  epicId: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

export const TaskIdSchema = z.object({ id: z.string().min(1) })

export const TaskCancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional()
})

export const TaskHistorySchema = z.object({
  id: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
})

// --- Epic schemas -----------------------------------------------------------

export const EpicDependencySchema = z.object({
  id: z.string().min(1),
  condition: z.enum(['on_success', 'always', 'manual'])
})

export const EpicWriteFieldsSchema = z.object({
  name: z.string().min(1).max(200),
  icon: z.string().max(4).optional(),
  accent_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  goal: z.string().max(2000).nullable().optional()
})

export const EpicListSchema = z.object({
  status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional(),
  search: z.string().min(1).optional()
})

export const EpicIdSchema = z.object({
  id: z.string().min(1),
  includeTasks: z.boolean().optional()
})

export const EpicUpdateSchema = z.object({
  id: z.string().min(1),
  patch: EpicWriteFieldsSchema.partial().extend({
    status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional()
  })
})

export const EpicAddTaskSchema = z.object({
  epicId: z.string().min(1),
  taskId: z.string().min(1)
})

export const EpicRemoveTaskSchema = z.object({
  taskId: z.string().min(1)
})

export const EpicSetDependenciesSchema = z.object({
  id: z.string().min(1),
  dependencies: z.array(EpicDependencySchema).max(32)
})
