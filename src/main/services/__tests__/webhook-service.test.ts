import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWebhookService, getWebhookEventName } from '../webhook-service'
import type { WebhookConfig } from '../webhook-service'
import type { SprintTask } from '../../../shared/types'

vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}))

function makeTask(status = 'done'): SprintTask {
  return {
    id: 'task-1',
    title: 'Fix bug',
    status,
    repo: 'fleet',
    priority: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    spec: null,
    prompt: null,
    notes: null,
    pr_url: null,
    pr_number: null,
    pr_status: null,
    template_name: null,
    playground_enabled: false,
    depends_on: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    tags: null,
    agent_run_id: null,
    worktree_path: null,
    spec_type: 'prompt',
    group_id: null,
    needs_review: false,
    failure_reason: null,
    retry_count: 0,
    max_runtime_ms: null,
    backlog_position: null
  } as unknown as SprintTask
}

function makeWebhook(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
  return {
    id: 'wh-1',
    url: 'https://example.com/webhook',
    enabled: true,
    events: [],
    secret: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// getWebhookEventName
// ---------------------------------------------------------------------------

describe('getWebhookEventName', () => {
  it('returns task.created for created mutation', () => {
    expect(getWebhookEventName('created', makeTask())).toBe('task.created')
  })

  it('returns task.deleted for deleted mutation', () => {
    expect(getWebhookEventName('deleted', makeTask())).toBe('task.deleted')
  })

  it('returns task.completed for done status update', () => {
    expect(getWebhookEventName('updated', makeTask('done'))).toBe('task.completed')
  })

  it('returns task.failed for failed status', () => {
    expect(getWebhookEventName('updated', makeTask('failed'))).toBe('task.failed')
  })

  it('returns task.failed for error status', () => {
    expect(getWebhookEventName('updated', makeTask('error'))).toBe('task.failed')
  })

  it('returns task.started for active status', () => {
    expect(getWebhookEventName('updated', makeTask('active'))).toBe('task.started')
  })

  it('returns task.review for review status', () => {
    expect(getWebhookEventName('updated', makeTask('review'))).toBe('task.review')
  })

  it('returns task.updated for any other update status', () => {
    expect(getWebhookEventName('updated', makeTask('queued'))).toBe('task.updated')
  })
})

// ---------------------------------------------------------------------------
// createWebhookService
// ---------------------------------------------------------------------------

describe('createWebhookService — fireWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires to all enabled webhooks whose event list is empty (fire for all events)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true })
    const getWebhooks = vi.fn().mockReturnValue([
      makeWebhook({ url: 'https://a.example.com/hook' }),
      makeWebhook({ id: 'wh-2', url: 'https://b.example.com/hook' })
    ])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.created', makeTask())
    await Promise.resolve() // let fire-and-forget microtasks run

    // fetchFn is async — give it time
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('skips disabled webhooks', async () => {
    const fetchFn = vi.fn()
    const getWebhooks = vi.fn().mockReturnValue([
      makeWebhook({ enabled: false })
    ])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.created', makeTask())
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('filters by event list — fires when event matches', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true })
    const getWebhooks = vi.fn().mockReturnValue([
      makeWebhook({ events: ['task.created', 'task.completed'] })
    ])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.created', makeTask())
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('filters by event list — does NOT fire when event is not in the list', async () => {
    const fetchFn = vi.fn()
    const getWebhooks = vi.fn().mockReturnValue([
      makeWebhook({ events: ['task.completed'] })
    ])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.started', makeTask())
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('includes HMAC signature header when webhook has a secret', async () => {
    let capturedHeaders: Record<string, string> | undefined
    const fetchFn = vi.fn().mockImplementation((_url, init) => {
      capturedHeaders = init.headers as Record<string, string>
      return Promise.resolve({ ok: true })
    })

    const getWebhooks = vi.fn().mockReturnValue([
      makeWebhook({ secret: 'my-secret-key' })
    ])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.created', makeTask())
    await new Promise((r) => setTimeout(r, 10))

    expect(capturedHeaders?.['X-FLEET-Signature']).toBeDefined()
    expect(capturedHeaders?.['X-FLEET-Signature']).toHaveLength(64) // HMAC-SHA256 hex
  })

  it('does NOT include HMAC signature header when webhook has no secret', async () => {
    let capturedHeaders: Record<string, string> | undefined
    const fetchFn = vi.fn().mockImplementation((_url, init) => {
      capturedHeaders = init.headers as Record<string, string>
      return Promise.resolve({ ok: true })
    })

    const getWebhooks = vi.fn().mockReturnValue([makeWebhook({ secret: null })])

    const service = createWebhookService({
      getWebhooks,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      fetchFn
    })

    service.fireWebhook('task.created', makeTask())
    await new Promise((r) => setTimeout(r, 10))

    expect(capturedHeaders?.['X-FLEET-Signature']).toBeUndefined()
  })
})
