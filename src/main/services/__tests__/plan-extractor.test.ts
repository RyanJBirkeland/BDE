import { describe, it, expect } from 'vitest'
import { extractTasksFromPlan } from '../plan-extractor'

describe('extractTasksFromPlan', () => {
  it('extracts ### Task N: sections with content', () => {
    const md = `# Plan\n\n## Phase 1\n\n### Task 1: Fix the thing\n\nDo A then B.\n\n**Files:**\n- foo.ts\n\n### Task 2: Add feature\n\nDo C.\n`
    const tasks = extractTasksFromPlan(md)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].title).toBe('Fix the thing')
    expect(tasks[0].spec).toContain('Do A then B')
    expect(tasks[0].spec).toContain('**Files:**')
    expect(tasks[0].taskNumber).toBe(1)
    expect(tasks[1].title).toBe('Add feature')
    expect(tasks[1].taskNumber).toBe(2)
  })

  it('returns empty array for plan with no ### Task sections', () => {
    const md = `# Just a doc\n\nSome text.`
    expect(extractTasksFromPlan(md)).toEqual([])
  })

  it('extracts depends_on references from "Depends on: Task N" lines', () => {
    const md = `### Task 3: Downstream\n\n**Depends on:** Task 1, Task 2\n\nContent.`
    const tasks = extractTasksFromPlan(md)
    expect(tasks[0].dependsOnTaskNumbers).toEqual([1, 2])
  })

  it('captures phase context for tasks', () => {
    const md = `## Phase 1: Setup\n\n### Task 1: Init\n\nSetup.\n\n## Phase 2: Implementation\n\n### Task 2: Build\n\nBuild it.`
    const tasks = extractTasksFromPlan(md)
    expect(tasks[0].phase).toBe('Phase 1: Setup')
    expect(tasks[1].phase).toBe('Phase 2: Implementation')
  })

  it('handles tasks with no phase', () => {
    const md = `### Task 1: Standalone\n\nNo phase header above.`
    const tasks = extractTasksFromPlan(md)
    expect(tasks[0].phase).toBeNull()
  })

  it('extracts multiple dependency formats', () => {
    const md1 = `### Task 1: A\n\n**Depends on:** Task 2\n\nContent.`
    const md2 = `### Task 2: B\n\n**Depends on:** None (standalone)\n\nContent.`
    const md3 = `### Task 3: C\n\n**Depends on:** Task 1, Task 2, Task 5\n\nContent.`

    expect(extractTasksFromPlan(md1)[0].dependsOnTaskNumbers).toEqual([2])
    expect(extractTasksFromPlan(md2)[0].dependsOnTaskNumbers).toEqual([])
    expect(extractTasksFromPlan(md3)[0].dependsOnTaskNumbers).toEqual([1, 2, 5])
  })

  it('ignores malformed task headings', () => {
    const md = `### Task: Missing number\n\n### Task A: Not a number\n\n### Task 1: Valid\n\nContent.`
    const tasks = extractTasksFromPlan(md)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Valid')
  })
})
