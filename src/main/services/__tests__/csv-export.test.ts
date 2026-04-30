import { describe, it, expect } from 'vitest'
import { formatTasksAsCsv } from '../csv-export'

describe('formatTasksAsCsv', () => {
  it('produces a header row as the first line', () => {
    const csv = formatTasksAsCsv([])
    const firstLine = csv.split('\n')[0]!
    expect(firstLine).toContain('id,title,repo,status')
  })

  it('returns only the header when the task list is empty', () => {
    const csv = formatTasksAsCsv([])
    expect(csv.split('\n')).toHaveLength(1)
  })

  it('produces one data row per task', () => {
    const tasks = [
      { id: 'a', title: 'Task A', repo: 'fleet', status: 'done' },
      { id: 'b', title: 'Task B', repo: 'fleet', status: 'queued' }
    ]
    const lines = formatTasksAsCsv(tasks).split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
  })

  it('escapes values that contain commas by wrapping in quotes', () => {
    const csv = formatTasksAsCsv([{ id: 'x', title: 'Fix, this bug', repo: 'r', status: 's' }])
    expect(csv).toContain('"Fix, this bug"')
  })

  it('escapes values that contain double-quotes by doubling them', () => {
    const csv = formatTasksAsCsv([{ id: 'x', title: 'The "real" fix', repo: 'r', status: 's' }])
    expect(csv).toContain('"The ""real"" fix"')
  })

  it('escapes values that contain newlines', () => {
    const csv = formatTasksAsCsv([{ id: 'x', title: 'Line1\nLine2', repo: 'r', status: 's' }])
    expect(csv).toContain('"Line1\nLine2"')
  })

  it('renders null and undefined values as empty string', () => {
    const csv = formatTasksAsCsv([{ id: 'x', title: null, repo: undefined, status: 's' }])
    const dataRow = csv.split('\n')[1]!
    // id comes first, then title (null → empty), then repo (undefined → empty)
    expect(dataRow.startsWith('x,,')).toBe(true)
  })

  it('serializes arrays (depends_on, tags) as JSON', () => {
    const csv = formatTasksAsCsv([
      { id: 'x', title: 'T', repo: 'r', status: 's', depends_on: [{ id: 'dep1', type: 'hard' }] }
    ])
    expect(csv).toContain('dep1')
  })
})
