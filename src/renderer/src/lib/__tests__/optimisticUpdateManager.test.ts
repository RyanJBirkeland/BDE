import { describe, it, expect } from 'vitest'
import type { SprintTask } from '../../../../shared/types'
import { nowIso } from '../../../../shared/time'
import {
  mergePendingFields,
  expirePendingUpdates,
  trackPendingOperation,
  areSprintTasksEquivalent,
  type PendingUpdates,
  type SprintTaskField
} from '../optimisticUpdateManager'

const TTL_MS = 5000

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'backlog',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_mergeable_state: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: nowIso(),
  created_at: nowIso(),
  ...overrides
})

describe('optimisticUpdateManager', () => {
  describe('mergePendingFields', () => {
    it('returns server task unchanged when no pending entry exists', () => {
      const server = makeTask('t1', { status: 'active' })
      const local = makeTask('t1', { status: 'backlog' })

      const merged = mergePendingFields(server, local, undefined, Date.now(), TTL_MS)

      expect(merged.status).toBe('active')
    })

    it('returns server task unchanged when the pending TTL has expired', () => {
      const server = makeTask('t1', { status: 'active' })
      const local = makeTask('t1', { status: 'backlog' })
      const now = Date.now()
      const pending = {
        ts: now - TTL_MS - 1,
        fields: ['status'] as const satisfies readonly SprintTaskField[]
      }

      const merged = mergePendingFields(server, local, pending, now, TTL_MS)

      expect(merged.status).toBe('active')
    })

    it('overlays pending fields from the local task within the TTL window', () => {
      const server = makeTask('t1', { status: 'active', priority: 5 })
      const local = makeTask('t1', { status: 'backlog', priority: 9 })
      const pending = {
        ts: Date.now(),
        fields: ['status', 'priority'] as const satisfies readonly SprintTaskField[]
      }

      const merged = mergePendingFields(server, local, pending, Date.now(), TTL_MS)

      expect(merged.status).toBe('backlog')
      expect(merged.priority).toBe(9)
    })

    it('leaves non-pending fields untouched', () => {
      const server = makeTask('t1', { status: 'active', priority: 5 })
      const local = makeTask('t1', { status: 'backlog', priority: 9 })
      const pending = {
        ts: Date.now(),
        fields: ['status'] as const satisfies readonly SprintTaskField[]
      }

      const merged = mergePendingFields(server, local, pending, Date.now(), TTL_MS)

      expect(merged.status).toBe('backlog')
      expect(merged.priority).toBe(5)
    })
  })

  describe('expirePendingUpdates', () => {
    it('keeps entries within the TTL window', () => {
      const now = Date.now()
      const updates: PendingUpdates = {
        t1: { ts: now, fields: ['status'] },
        t2: { ts: now - TTL_MS + 500, fields: ['priority'] }
      }

      const result = expirePendingUpdates(updates, TTL_MS)

      expect(Object.keys(result).sort()).toEqual(['t1', 't2'])
    })

    it('drops entries older than the TTL window', () => {
      const updates: PendingUpdates = {
        t1: { ts: Date.now(), fields: ['status'] },
        t2: { ts: Date.now() - TTL_MS - 1, fields: ['priority'] }
      }

      const result = expirePendingUpdates(updates, TTL_MS)

      expect(Object.keys(result)).toEqual(['t1'])
    })
  })

  describe('trackPendingOperation', () => {
    it('adds a new pending entry with the given fields and timestamp', () => {
      const ts = Date.now()

      const updates = trackPendingOperation({}, 't1', ['status'], ts)

      expect(updates.t1).toEqual({ ts, fields: ['status'] })
    })

    it('merges new fields with prior pending fields for the same task', () => {
      const priorTs = Date.now() - 1000
      const nextTs = Date.now()
      const existing: PendingUpdates = { t1: { ts: priorTs, fields: ['status'] } }

      const updates = trackPendingOperation(existing, 't1', ['priority'], nextTs)

      expect(updates.t1.ts).toBe(nextTs)
      expect([...updates.t1.fields].sort()).toEqual(['priority', 'status'])
    })

    it('deduplicates fields when producer re-tracks the same field', () => {
      const existing: PendingUpdates = { t1: { ts: Date.now(), fields: ['status'] } }

      const updates = trackPendingOperation(existing, 't1', ['status'], Date.now())

      expect(updates.t1.fields).toEqual(['status'])
    })
  })

  describe('compile-time field-name safety (regression guard for T-46)', () => {
    it('rejects typoed SprintTask field names at the type layer', () => {
      // A valid field compiles cleanly.
      const valid: readonly SprintTaskField[] = ['status', 'priority']
      expect(valid.length).toBe(2)

      // A typoed field name MUST be a compile error — this is the guarantee
      // T-46 introduces. If the `@ts-expect-error` below starts producing
      // "unused directive" TS errors, the type has regressed to `string[]`
      // and this test will fail the build.
      const typoed: readonly SprintTaskField[] = [
        // @ts-expect-error — 'statuz' is not a keyof SprintTask
        'statuz'
      ]
      expect(typoed.length).toBe(1)
    })

    it('rejects typoed field names when calling trackPendingOperation', () => {
      // @ts-expect-error — 'priorty' is not a keyof SprintTask
      const updates = trackPendingOperation({}, 't1', ['priorty'], Date.now())
      expect(updates.t1).toBeDefined()
    })
  })

  describe('areSprintTasksEquivalent', () => {
    it('returns true for the same reference', () => {
      const task = makeTask('t1')
      expect(areSprintTasksEquivalent(task, task)).toBe(true)
    })

    it('returns true when every field has the same primitive value', () => {
      const a = makeTask('t1', { status: 'active', priority: 3 })
      const b = makeTask('t1', {
        status: 'active',
        priority: 3,
        updated_at: a.updated_at,
        created_at: a.created_at
      })
      expect(areSprintTasksEquivalent(a, b)).toBe(true)
    })

    it('returns false when any primitive field differs', () => {
      const a = makeTask('t1', { status: 'active' })
      const b = makeTask('t1', {
        status: 'queued',
        updated_at: a.updated_at,
        created_at: a.created_at
      })
      expect(areSprintTasksEquivalent(a, b)).toBe(false)
    })

    it('returns true when depends_on arrays have identical contents', () => {
      const deps = [{ id: 't2', type: 'hard' as const }]
      const a = makeTask('t1', { depends_on: deps })
      const b = makeTask('t1', {
        depends_on: [{ id: 't2', type: 'hard' }],
        updated_at: a.updated_at,
        created_at: a.created_at
      })
      expect(areSprintTasksEquivalent(a, b)).toBe(true)
    })

    it('returns false when depends_on arrays have different contents', () => {
      const a = makeTask('t1', { depends_on: [{ id: 't2', type: 'hard' }] })
      const b = makeTask('t1', {
        depends_on: [{ id: 't3', type: 'hard' }],
        updated_at: a.updated_at,
        created_at: a.created_at
      })
      expect(areSprintTasksEquivalent(a, b)).toBe(false)
    })

    it('returns false when depends_on lengths differ', () => {
      const a = makeTask('t1', { depends_on: [{ id: 't2', type: 'hard' }] })
      const b = makeTask('t1', {
        depends_on: [],
        updated_at: a.updated_at,
        created_at: a.created_at
      })
      expect(areSprintTasksEquivalent(a, b)).toBe(false)
    })
  })
})
