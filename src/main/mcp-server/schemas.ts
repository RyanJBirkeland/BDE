import { z } from 'zod'
import { TASK_STATUSES } from '../../shared/task-state-machine'

// --- Task schemas -----------------------------------------------------------

export const TaskStatusSchema = z.enum(TASK_STATUSES)

export const TaskDependencySchema = z.object({
  id: z.string().min(1).describe('Upstream task id this task depends on'),
  type: z
    .enum(['hard', 'soft'])
    .describe('hard = block on upstream failure; soft = unblock regardless')
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
  title: z.string().min(1).max(500).describe('Task title (1-500 chars)'),
  repo: z
    .string()
    .min(1)
    .max(200)
    .describe('Repository slug (lowercase, configured in Settings; 1-200 chars)'),
  status: TaskStatusSchema.optional(),
  prompt: z.string().max(200_000).optional().describe('Freeform prompt text (max 200000 chars)'),
  spec: z
    .string()
    .max(200_000)
    .optional()
    .describe('Structured markdown spec with ## headings (max 200000 chars)'),
  spec_type: z
    .enum(['feature', 'bug-fix', 'refactor', 'test-coverage', 'freeform', 'prompt'])
    .optional(),
  notes: z.string().max(10_000).optional().describe('Operator notes (max 10000 chars)'),
  priority: z.number().int().min(0).max(10).optional().describe('Priority 0-10 (higher = sooner)'),
  tags: z
    .array(z.string().min(1).max(64))
    .max(32)
    .optional()
    .describe('Up to 32 tags, each 1-64 chars'),
  depends_on: z
    .array(TaskDependencySchema)
    .max(32)
    .optional()
    .describe('Up to 32 dependencies on other tasks'),
  playground_enabled: z.boolean().optional(),
  max_runtime_ms: z
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .optional()
    .describe('Per-task watchdog timeout in ms (60000 to 86400000 = 1min to 24h)'),
  template_name: z.string().min(1).max(200).optional().describe('Task template name (1-200 chars)'),
  cross_repo_contract: z
    .string()
    .max(10_000)
    .optional()
    .describe('Cross-repo contract spec (max 10000 chars)'),
  group_id: z.string().min(1).nullable().optional().describe('Epic/group id this task belongs to'),
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
  id: z.string().min(1).describe('Task id to update'),
  patch: TaskWriteFieldsSchema.partial()
})

export const TaskListSchema = z.object({
  status: TaskStatusSchema.optional(),
  repo: z.string().min(1).optional().describe('Filter by repository slug'),
  epicId: z.string().min(1).optional().describe('Filter by epic/group id'),
  tag: z.string().min(1).optional().describe('Filter by tag'),
  search: z.string().min(1).optional().describe('Full-text search across title/spec/prompt'),
  limit: z.number().int().min(1).max(500).optional().describe('Page size (1-500)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset (>=0)')
})

export const TaskIdSchema = z.object({ id: z.string().min(1).describe('Task id') })

export const TaskCancelSchema = z.object({
  id: z.string().min(1).describe('Task id to cancel'),
  reason: z.string().max(500).optional().describe('Cancellation reason (max 500 chars)')
})

/**
 * Default page size when `limit` is omitted. Kept in sync with the
 * `limit + offset ≤ TASK_HISTORY_MAX_WINDOW` cap applied in
 * `tools/tasks.ts`; beyond that window the DB cost is dominated by the
 * skipped rows and dwarfs the returned page.
 */
export const TASK_HISTORY_DEFAULT_LIMIT = 100
export const TASK_HISTORY_MAX_WINDOW = 500

export const TaskHistorySchema = z.object({
  id: z.string().min(1).describe('Task id'),
  limit: z.number().int().min(1).max(500).optional().describe('Page size (1-500)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      `Pagination offset (>=0); (limit ?? ${TASK_HISTORY_DEFAULT_LIMIT}) + offset must be <= ${TASK_HISTORY_MAX_WINDOW}`
    )
})

// --- Epic schemas -----------------------------------------------------------

export const EpicDependencySchema = z.object({
  id: z.string().min(1).describe('Upstream epic id this epic depends on'),
  condition: z
    .enum(['on_success', 'always', 'manual'])
    .describe(
      'on_success = unblock when upstream tasks succeed; always = any outcome; manual = requires explicit completion'
    )
})

export const EpicWriteFieldsSchema = z.object({
  name: z.string().min(1).max(200).describe('Epic name (1-200 chars)'),
  icon: z
    .string()
    .max(4)
    .optional()
    .describe('Single emoji glyph identifying the epic (max 4 chars)'),
  accent_color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe('Accent color as 6-digit hex (e.g. #ff00aa)'),
  goal: z.string().max(2000).nullable().optional().describe('Epic goal (max 2000 chars)')
})

export const EpicListSchema = z.object({
  status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional(),
  search: z.string().min(1).optional().describe('Full-text search across epic name/goal')
})

export const EpicIdSchema = z.object({
  id: z.string().min(1).describe('Epic id'),
  includeTasks: z.boolean().optional().describe('Include the epic tasks in the response')
})

export const EpicUpdateSchema = z.object({
  id: z.string().min(1).describe('Epic id to update'),
  patch: EpicWriteFieldsSchema.partial().extend({
    status: z.enum(['draft', 'ready', 'in-pipeline', 'completed']).optional()
  })
})

export const EpicAddTaskSchema = z.object({
  epicId: z.string().min(1).describe('Epic id the task should join'),
  taskId: z.string().min(1).describe('Task id to add to the epic')
})

export const EpicRemoveTaskSchema = z.object({
  taskId: z.string().min(1).describe('Task id to detach from its current epic')
})

export const EpicSetDependenciesSchema = z.object({
  id: z.string().min(1).describe('Epic id whose dependencies are being set'),
  dependencies: z
    .array(EpicDependencySchema)
    .max(32)
    .describe('Up to 32 upstream epic dependencies')
})
