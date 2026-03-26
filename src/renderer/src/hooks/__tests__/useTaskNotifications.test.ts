import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyOnce, _resetNotifiedTaskIds } from '../useTaskNotifications'

// Stub Notification API
class MockNotification {
  static permission = 'granted'
  static requestPermission = vi.fn().mockResolvedValue('granted')
  constructor(
    public title: string,
    public options?: NotificationOptions
  ) {}
}

vi.stubGlobal('Notification', MockNotification)

// Add missing window.api stubs needed by the module
vi.stubGlobal('api', {
  ...((globalThis as Record<string, unknown>).api as Record<string, unknown>),
  onExternalSprintChange: vi.fn().mockReturnValue(() => {})
})

describe('notifyOnce', () => {
  beforeEach(() => {
    _resetNotifiedTaskIds()
  })

  it('fires notification on first call for a taskId', () => {
    const result = notifyOnce('task-1', 'Done', 'Task completed')
    expect(result).toBe(true)
  })

  it('returns false and suppresses duplicate for same taskId', () => {
    notifyOnce('task-1', 'Done', 'Task completed')
    const result = notifyOnce('task-1', 'Done again', 'Duplicate')
    expect(result).toBe(false)
  })

  it('allows different taskIds independently', () => {
    expect(notifyOnce('task-1', 'Done', 'First')).toBe(true)
    expect(notifyOnce('task-2', 'Done', 'Second')).toBe(true)
  })

  it('suppresses duplicates even with different titles/bodies', () => {
    notifyOnce('task-1', 'Agent finished', 'Success')
    // Same taskId, different message — should still be suppressed
    const result = notifyOnce('task-1', 'Agent task done', 'PR ready')
    expect(result).toBe(false)
  })

  it('reset clears dedup state', () => {
    notifyOnce('task-1', 'Done', 'Task completed')
    _resetNotifiedTaskIds()
    // After reset, same taskId should fire again
    expect(notifyOnce('task-1', 'Done', 'Task completed')).toBe(true)
  })
})

describe('notifiedTaskIds shared dedup across sources', () => {
  beforeEach(() => {
    _resetNotifiedTaskIds()
  })

  it('Source 1 (DB watcher) firing prevents Source 2 (SSE) duplicate', () => {
    // Source 1 fires first
    expect(notifyOnce('task-1', '✅ Agent task done', 'Task "fix" completed in repo.')).toBe(true)
    // Source 2 fires for same task — suppressed
    expect(notifyOnce('task-1', 'Agent finished', 'Task completed successfully.')).toBe(false)
  })

  it('Source 2 (SSE) firing prevents Source 1 (DB watcher) duplicate', () => {
    // Source 2 fires first
    expect(notifyOnce('task-1', 'Agent finished', 'Task completed successfully.')).toBe(true)
    // Source 1 fires for same task — suppressed
    expect(notifyOnce('task-1', '✅ Agent task done', 'Task "fix" completed in repo.')).toBe(false)
  })

  it('handles rapid-fire from all 3 sources for same task', () => {
    const taskId = 'task-rapid'
    // Simulate all 3 sources firing within ~500ms
    expect(notifyOnce(taskId, 'Source 1', 'DB watcher')).toBe(true)
    expect(notifyOnce(taskId, 'Source 2', 'SSE log:done')).toBe(false)
    // Source 3 (toast) checks notifiedTaskIds.has() directly — same set
  })

  it('deduplicates across multiple tasks correctly', () => {
    expect(notifyOnce('task-A', 'Done', 'A')).toBe(true)
    expect(notifyOnce('task-B', 'Done', 'B')).toBe(true)
    expect(notifyOnce('task-A', 'Done', 'A duplicate')).toBe(false)
    expect(notifyOnce('task-B', 'Done', 'B duplicate')).toBe(false)
    expect(notifyOnce('task-C', 'Done', 'C new')).toBe(true)
  })
})
