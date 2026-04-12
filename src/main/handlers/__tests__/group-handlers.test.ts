/**
 * Group handler unit tests — epic dependency IPC round-trip
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { EpicDependency } from '../../../shared/types'
import {
  createGroup,
  getGroup,
  addGroupDependency,
  removeGroupDependency,
  updateGroupDependencyCondition
} from '../../data/task-group-queries'
import { detectEpicCycle } from '../../services/epic-dependency-service'

// In-memory SQLite DB for testing
let db: Database.Database

beforeEach(() => {
  // Create fresh in-memory DB for each test
  db = new Database(':memory:')

  // Create task_groups table
  const createTableSql = `
    CREATE TABLE task_groups (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'G',
      accent_color TEXT DEFAULT '#00ffcc',
      goal TEXT,
      status TEXT DEFAULT 'draft',
      depends_on TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `
  db.exec(createTableSql)
})

describe('Group epic dependency handlers', () => {
  it('should add a dependency', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!

    const dep: EpicDependency = { id: groupA.id, condition: 'on_success' }
    const updated = addGroupDependency(groupB.id, dep, db)

    expect(updated).toBeDefined()
    expect(updated!.depends_on).toHaveLength(1)
    expect(updated!.depends_on![0]).toEqual(dep)
  })

  it('should prevent duplicate dependencies', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!

    const dep: EpicDependency = { id: groupA.id, condition: 'on_success' }
    addGroupDependency(groupB.id, dep, db)

    expect(() => addGroupDependency(groupB.id, dep, db)).toThrow('Dependency already exists')
  })

  it('should remove a dependency', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!

    const dep: EpicDependency = { id: groupA.id, condition: 'on_success' }
    addGroupDependency(groupB.id, dep, db)

    const updated = removeGroupDependency(groupB.id, groupA.id, db)

    expect(updated).toBeDefined()
    expect(updated!.depends_on).toBeNull()
  })

  it('should update dependency condition', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!

    const dep: EpicDependency = { id: groupA.id, condition: 'on_success' }
    addGroupDependency(groupB.id, dep, db)

    const updated = updateGroupDependencyCondition(groupB.id, groupA.id, 'always', db)

    expect(updated).toBeDefined()
    expect(updated!.depends_on).toHaveLength(1)
    expect(updated!.depends_on![0].condition).toBe('always')
  })

  it('should detect direct cycle (self-reference)', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!

    const dep: EpicDependency = { id: groupA.id, condition: 'on_success' }
    const cycle = detectEpicCycle(groupA.id, [dep], (id) => {
      const g = getGroup(id, db)
      return g?.depends_on ?? null
    })

    expect(cycle).toEqual([groupA.id, groupA.id])
  })

  it('should detect indirect cycle (A -> B -> A)', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!

    // B depends on A
    addGroupDependency(groupB.id, { id: groupA.id, condition: 'on_success' }, db)

    // Try to make A depend on B (would create cycle)
    const cycle = detectEpicCycle(groupA.id, [{ id: groupB.id, condition: 'on_success' }], (id) => {
      const g = getGroup(id, db)
      return g?.depends_on ?? null
    })

    expect(cycle).toBeTruthy()
    expect(cycle).toContain(groupA.id)
    expect(cycle).toContain(groupB.id)
  })

  it('should detect longer cycle (A -> B -> C -> A)', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!
    const groupC = createGroup({ name: 'Group C' }, db)!

    // B depends on A
    addGroupDependency(groupB.id, { id: groupA.id, condition: 'on_success' }, db)
    // C depends on B
    addGroupDependency(groupC.id, { id: groupB.id, condition: 'on_success' }, db)

    // Try to make A depend on C (would create cycle A -> C -> B -> A)
    const cycle = detectEpicCycle(groupA.id, [{ id: groupC.id, condition: 'on_success' }], (id) => {
      const g = getGroup(id, db)
      return g?.depends_on ?? null
    })

    expect(cycle).toBeTruthy()
    expect(cycle).toContain(groupA.id)
  })

  it('should allow non-cyclic dependencies', () => {
    const groupA = createGroup({ name: 'Group A' }, db)!
    const groupB = createGroup({ name: 'Group B' }, db)!
    const groupC = createGroup({ name: 'Group C' }, db)!

    // B depends on A
    addGroupDependency(groupB.id, { id: groupA.id, condition: 'on_success' }, db)

    // C depends on A (not a cycle)
    const cycle = detectEpicCycle(groupC.id, [{ id: groupA.id, condition: 'on_success' }], (id) => {
      const g = getGroup(id, db)
      return g?.depends_on ?? null
    })

    expect(cycle).toBeNull()
  })
})
