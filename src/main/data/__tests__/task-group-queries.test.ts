import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { createGroup, getGroup, updateGroup, listGroups } from '../task-group-queries'
import type { EpicDependency } from '../../../shared/types'
import { up as v047Up } from '../../migrations/v047-add-depends-on-to-task-groups'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  db.close()
})

describe('createGroup with depends_on', () => {
  it('round-trips depends_on correctly', () => {
    const deps: EpicDependency[] = [
      { id: 'epic-123', condition: 'on_success' },
      { id: 'epic-456', condition: 'always' }
    ]
    const created = createGroup({ name: 'Test Epic', depends_on: deps }, db)
    expect(created).not.toBeNull()
    expect(created?.depends_on).toEqual(deps)

    const fetched = getGroup(created!.id, db)
    expect(fetched?.depends_on).toEqual(deps)
  })

  it('defaults to null when depends_on is not provided', () => {
    const created = createGroup({ name: 'No Deps Epic' }, db)
    expect(created).not.toBeNull()
    expect(created?.depends_on).toBeNull()
  })

  it('normalizes empty array to null', () => {
    const created = createGroup({ name: 'Empty Deps Epic', depends_on: [] }, db)
    expect(created).not.toBeNull()
    expect(created?.depends_on).toBeNull()

    const fetched = getGroup(created!.id, db)
    expect(fetched?.depends_on).toBeNull()
  })

  it('handles null explicitly', () => {
    const created = createGroup({ name: 'Null Deps Epic', depends_on: null }, db)
    expect(created).not.toBeNull()
    expect(created?.depends_on).toBeNull()
  })
})

describe('updateGroup with depends_on', () => {
  it('updates depends_on successfully', () => {
    const created = createGroup({ name: 'Test Epic' }, db)
    expect(created?.depends_on).toBeNull()

    const deps: EpicDependency[] = [{ id: 'epic-789', condition: 'manual' }]
    const updated = updateGroup(created!.id, { depends_on: deps }, db)
    expect(updated?.depends_on).toEqual(deps)

    const fetched = getGroup(created!.id, db)
    expect(fetched?.depends_on).toEqual(deps)
  })

  it('clears depends_on when set to empty array', () => {
    const deps: EpicDependency[] = [{ id: 'epic-999', condition: 'on_success' }]
    const created = createGroup({ name: 'Test Epic', depends_on: deps }, db)
    expect(created?.depends_on).toEqual(deps)

    const updated = updateGroup(created!.id, { depends_on: [] }, db)
    expect(updated?.depends_on).toBeNull()
  })

  it('clears depends_on when set to null', () => {
    const deps: EpicDependency[] = [{ id: 'epic-999', condition: 'on_success' }]
    const created = createGroup({ name: 'Test Epic', depends_on: deps }, db)
    expect(created?.depends_on).toEqual(deps)

    const updated = updateGroup(created!.id, { depends_on: null }, db)
    expect(updated?.depends_on).toBeNull()
  })
})

describe('listGroups with depends_on', () => {
  it('returns all groups with correct depends_on values', () => {
    const deps1: EpicDependency[] = [{ id: 'epic-111', condition: 'on_success' }]
    const deps2: EpicDependency[] = [{ id: 'epic-222', condition: 'always' }]

    createGroup({ name: 'Epic 1', depends_on: deps1 }, db)
    createGroup({ name: 'Epic 2', depends_on: deps2 }, db)
    createGroup({ name: 'Epic 3' }, db)

    const groups = listGroups(db)
    expect(groups).toHaveLength(3)

    const epic1 = groups.find((g) => g.name === 'Epic 1')
    const epic2 = groups.find((g) => g.name === 'Epic 2')
    const epic3 = groups.find((g) => g.name === 'Epic 3')

    expect(epic1?.depends_on).toEqual(deps1)
    expect(epic2?.depends_on).toEqual(deps2)
    expect(epic3?.depends_on).toBeNull()
  })
})

describe('sanitizeGroup malformed JSON fallback', () => {
  it('returns null for malformed depends_on JSON', () => {
    const created = createGroup({ name: 'Test Epic' }, db)
    expect(created).not.toBeNull()

    // Direct SQL injection of malformed JSON
    db.prepare('UPDATE task_groups SET depends_on = ? WHERE id = ?').run(
      'garbage{not:json',
      created!.id
    )

    const fetched = getGroup(created!.id, db)
    expect(fetched?.depends_on).toBeNull()
  })

  it('returns null for non-array JSON', () => {
    const created = createGroup({ name: 'Test Epic' }, db)
    expect(created).not.toBeNull()

    // Direct SQL injection of non-array JSON
    db.prepare('UPDATE task_groups SET depends_on = ? WHERE id = ?').run(
      '{"id":"epic-123"}',
      created!.id
    )

    const fetched = getGroup(created!.id, db)
    expect(fetched?.depends_on).toBeNull()
  })
})

describe('migration v047 idempotence', () => {
  it('can be run multiple times without error', () => {
    // Migration already ran in beforeEach via runMigrations
    // Run it again to verify idempotence
    expect(() => v047Up(db)).not.toThrow()

    // Verify column exists exactly once
    const cols = (db.pragma('table_info(task_groups)') as { name: string }[]).map((c) => c.name)
    const dependsOnCount = cols.filter((c) => c === 'depends_on').length
    expect(dependsOnCount).toBe(1)

    // Run it a third time for good measure
    expect(() => v047Up(db)).not.toThrow()
  })
})
