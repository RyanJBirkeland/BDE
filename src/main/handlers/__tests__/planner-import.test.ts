import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { parsePlanMarkdown, importPlanFile } from '../planner-import'
import { getDb } from '../../db'

// Mock Electron BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

describe('planner-import', () => {
  let db: Database.Database

  beforeEach(() => {
    db = getDb()
    // Clean up test data
    // Delete tasks, then nullify group_id references, then delete groups
    db.prepare('DELETE FROM sprint_tasks WHERE title LIKE ?').run('Test:%')
    db.prepare(
      'UPDATE sprint_tasks SET group_id = NULL WHERE group_id IN (SELECT id FROM task_groups WHERE name LIKE ?)'
    ).run('Test:%')
    db.prepare('DELETE FROM task_groups WHERE name LIKE ?').run('Test:%')
  })

  afterEach(() => {
    // Clean up test data
    // Delete tasks, then nullify group_id references, then delete groups
    db.prepare('DELETE FROM sprint_tasks WHERE title LIKE ?').run('Test:%')
    db.prepare(
      'UPDATE sprint_tasks SET group_id = NULL WHERE group_id IN (SELECT id FROM task_groups WHERE name LIKE ?)'
    ).run('Test:%')
    db.prepare('DELETE FROM task_groups WHERE name LIKE ?').run('Test:%')
  })

  describe('parsePlanMarkdown', () => {
    it('should extract epic name from H1', () => {
      const markdown = `# Test: Full Test Remediation

Some intro text.

## Tasks

### Task 1: First task

Do something.

### Task 2: Second task

Do something else.
`
      const result = parsePlanMarkdown(markdown)
      expect(result.epicName).toBe('Test: Full Test Remediation')
    })

    it('should extract tasks from H3 under Tasks section', () => {
      const markdown = `# Test: My Plan

## Tasks

### Task 1: First task

Content here.

### Task 2: Second task

More content.

## Other Section

### Task 3: Not a task

Should be ignored.
`
      const result = parsePlanMarkdown(markdown)
      expect(result.tasks).toHaveLength(2)
      expect(result.tasks[0].title).toBe('Task 1: First task')
      expect(result.tasks[1].title).toBe('Task 2: Second task')
    })

    it('should include task body content as spec', () => {
      const markdown = `# Test: Plan

## Tasks

### Task 1: Do something

**Files:**

- src/foo.ts
- src/bar.ts

Do the thing.
`
      const result = parsePlanMarkdown(markdown)
      expect(result.tasks[0].spec).toContain('**Files:**')
      expect(result.tasks[0].spec).toContain('src/foo.ts')
    })

    it('should handle plan with no tasks section', () => {
      const markdown = `# Test: Just a doc

Some content.
`
      const result = parsePlanMarkdown(markdown)
      expect(result.epicName).toBe('Test: Just a doc')
      expect(result.tasks).toHaveLength(0)
    })

    it('should handle empty markdown', () => {
      const result = parsePlanMarkdown('')
      expect(result.epicName).toBe('Untitled Plan')
      expect(result.tasks).toHaveLength(0)
    })
  })

  describe('importPlanFile', () => {
    it('should create epic and tasks in database', () => {
      const markdown = `# Test: Import Integration

## Tasks

### Task 1: First

Do first thing.

### Task 2: Second

Do second thing.
`
      const result = importPlanFile(markdown, { repo: 'bde', db })

      expect(result.epic).toBeDefined()
      expect(result.epic.name).toBe('Test: Import Integration')
      expect(result.tasks).toHaveLength(2)
      expect(result.tasks[0].title).toBe('Task 1: First')
      expect(result.tasks[0].group_id).toBe(result.epic.id)
      expect(result.tasks[0].repo).toBe('bde')
      expect(result.tasks[1].title).toBe('Task 2: Second')
      expect(result.tasks[1].group_id).toBe(result.epic.id)

      // Verify in database
      const epicRow = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(result.epic.id)
      expect(epicRow).toBeDefined()

      const taskRows = db
        .prepare('SELECT * FROM sprint_tasks WHERE group_id = ?')
        .all(result.epic.id) as unknown[]
      expect(taskRows).toHaveLength(2)
    })

    it('should set epic status to draft by default', () => {
      const markdown = `# Test: Status Check

## Tasks

### Task 1: Do thing

Content.
`
      const result = importPlanFile(markdown, { repo: 'bde', db })
      expect(result.epic.status).toBe('draft')
    })

    it('should set task status to backlog by default', () => {
      const markdown = `# Test: Task Status

## Tasks

### Task 1: Thing

Do it.
`
      const result = importPlanFile(markdown, { repo: 'bde', db })
      expect(result.tasks[0].status).toBe('backlog')
    })

    it('should handle plan with no tasks', () => {
      const markdown = `# Test: Empty Plan

Just some notes.
`
      const result = importPlanFile(markdown, { repo: 'bde', db })
      expect(result.epic.name).toBe('Test: Empty Plan')
      expect(result.tasks).toHaveLength(0)
    })
  })
})
