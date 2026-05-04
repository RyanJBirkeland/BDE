import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mapRowToTask, mapRowsToTasks, serializeFieldForStorage } from '../sprint-task-mapper'
import { setSprintQueriesLogger } from '../sprint-query-logger'

type LoggerSpy = {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
}

function installLoggerSpy(): LoggerSpy {
  const spy: LoggerSpy = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
  setSprintQueriesLogger(spy)
  return spy
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    id: 't-1',
    title: 'Example task',
    repo: 'fleet',
    status: 'queued',
    priority: 2,
    prompt: 'do it',
    notes: null,
    spec: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: JSON.stringify([{ id: 't-0', type: 'hard' }]),
    tags: JSON.stringify(['urgent', 'backend']),
    playground_enabled: 1,
    needs_review: 0,
    revision_feedback: JSON.stringify([{ at: '2026-01-01', note: 'redo' }]),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
  return { ...defaults, ...overrides }
}

let logger: LoggerSpy

beforeEach(() => {
  logger = installLoggerSpy()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mapRowToTask — happy path', () => {
  it('maps a fully valid row and round-trips sanitized fields', () => {
    const task = mapRowToTask(row())

    expect(task.id).toBe('t-1')
    expect(task.title).toBe('Example task')
    expect(task.repo).toBe('fleet')
    expect(task.status).toBe('queued')
    expect(task.priority).toBe(2)
    expect(task.depends_on).toEqual([{ id: 't-0', type: 'hard' }])
    expect(task.tags).toEqual(['urgent', 'backend'])
    expect(task.playground_enabled).toBe(true)
    expect(task.needs_review).toBe(false)
    expect(task.revision_feedback).toEqual([{ at: '2026-01-01', note: 'redo' }])
  })

  it('hydrates promoted_to_review_at as a plain string (TEXT column)', () => {
    const task = mapRowToTask(row({ promoted_to_review_at: '2026-04-22T12:34:56.789Z' }))
    expect(task.promoted_to_review_at).toBe('2026-04-22T12:34:56.789Z')
  })

  it('passes through null promoted_to_review_at', () => {
    const task = mapRowToTask(row({ promoted_to_review_at: null }))
    expect(task.promoted_to_review_at).toBeNull()
  })

  it('coerces numeric-string priority to a finite number', () => {
    const task = mapRowToTask(row({ priority: '5' }))
    expect(task.priority).toBe(5)
  })

  it('accepts empty string title (schema allows it)', () => {
    const task = mapRowToTask(row({ title: '' }))
    expect(task.title).toBe('')
  })
})

describe('mapRowToTask — validation failures', () => {
  it('throws when status is not a known TaskStatus', () => {
    expect(() => mapRowToTask(row({ status: 'foobar' }))).toThrow(/status must be one of/)
  })

  it('throws when id is not a string', () => {
    expect(() => mapRowToTask(row({ id: 42 }))).toThrow(/id must be a non-empty string/)
  })

  it('throws when id is an empty string', () => {
    expect(() => mapRowToTask(row({ id: '' }))).toThrow(/id must be a non-empty string/)
  })

  it('throws when priority coerces to NaN', () => {
    expect(() => mapRowToTask(row({ priority: 'not-a-number' }))).toThrow(
      /priority must be a finite number/
    )
  })

  it('throws when priority is Infinity', () => {
    expect(() => mapRowToTask(row({ priority: Infinity }))).toThrow(
      /priority must be a finite number/
    )
  })

  it('throws when repo is missing', () => {
    expect(() => mapRowToTask(row({ repo: null }))).toThrow(/repo must be a non-empty string/)
  })

  it('throws when repo is an empty string', () => {
    expect(() => mapRowToTask(row({ repo: '   ' }))).toThrow(/repo must be a non-empty string/)
  })

  it('throws when title is null', () => {
    expect(() => mapRowToTask(row({ title: null }))).toThrow(/title must be a string/)
  })
})

describe('mapRowsToTasks', () => {
  it('filters out corrupted rows and logs each drop', () => {
    const rows = [
      row({ id: 'good-1' }),
      row({ id: 'bad', status: 'nonsense' }),
      row({ id: 'good-2' })
    ]

    const tasks = mapRowsToTasks(rows)

    expect(tasks.map((t) => t.id)).toEqual(['good-1', 'good-2'])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatch(/Dropping corrupted row/)
  })

  it('returns an empty array when every row is invalid', () => {
    const tasks = mapRowsToTasks([row({ id: '' }), row({ status: 'bogus' })])
    expect(tasks).toEqual([])
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })
})

describe('mapRowToTask — optional field coercion', () => {
  it('maps null optional string field to null', () => {
    const task = mapRowToTask(row({ pr_url: null }))
    expect(task.pr_url).toBeNull()
  })

  it('does not propagate extra DB columns not present on SprintTask', () => {
    const task = mapRowToTask(row({ __extra_column: 'should-be-gone' }))
    expect(Object.prototype.hasOwnProperty.call(task, '__extra_column')).toBe(false)
  })

  it('coerces an unrecognised pr_status to null', () => {
    const task = mapRowToTask(row({ pr_status: 'legacy_open' }))
    expect(task.pr_status).toBeNull()
  })

  it('preserves a valid pr_status', () => {
    const task = mapRowToTask(row({ pr_status: 'open' }))
    expect(task.pr_status).toBe('open')
  })

  it('coerces an unrecognised failure_reason to null', () => {
    const task = mapRowToTask(row({ failure_reason: 'disk_full' }))
    expect(task.failure_reason).toBeNull()
  })

  it('preserves git-precondition-failed as a valid failure_reason', () => {
    const task = mapRowToTask(row({ failure_reason: 'git-precondition-failed' }))
    expect(task.failure_reason).toBe('git-precondition-failed')
  })

  it('preserves every FailureReason member through the mapper without coercion to null', () => {
    const allReasons = [
      'auth', 'timeout', 'test_failure', 'compilation', 'spawn',
      'no_commits', 'no-commits-exhausted', 'tip-mismatch',
      'incomplete_files', 'environmental', 'unknown',
      'git-precondition-failed'
    ]
    for (const reason of allReasons) {
      const task = mapRowToTask(row({ failure_reason: reason }))
      expect(task.failure_reason, `expected ${reason} to survive mapper`).toBe(reason)
    }
  })

  it('filters out depends_on entries with an unrecognised type', () => {
    const mixed = JSON.stringify([
      { id: 'a', type: 'hard' },
      { id: 'b', type: 'unknown_type' },
      { id: 'c', type: 'soft' }
    ])
    const task = mapRowToTask(row({ depends_on: mixed }))
    expect(task.depends_on).toEqual([
      { id: 'a', type: 'hard' },
      { id: 'c', type: 'soft' }
    ])
  })
})

describe('serializeFieldForStorage (regression)', () => {
  it('still serializes tags to JSON string', () => {
    expect(serializeFieldForStorage('tags', ['a', 'b'])).toBe('["a","b"]')
  })

  it('still coerces boolean-like needs_review to 1/0', () => {
    expect(serializeFieldForStorage('needs_review', true)).toBe(1)
    expect(serializeFieldForStorage('needs_review', false)).toBe(0)
  })
})
