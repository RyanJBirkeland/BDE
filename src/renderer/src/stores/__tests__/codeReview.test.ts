import { describe, it, expect, beforeEach } from 'vitest'
import { useCodeReviewStore } from '../codeReview'

describe('codeReviewStore', () => {
  beforeEach(() => {
    useCodeReviewStore.getState().reset()
  })

  it('selects a task and clears previous data', () => {
    useCodeReviewStore
      .getState()
      .setDiffFiles([{ path: 'old.ts', status: 'M', additions: 1, deletions: 0, patch: '' }])
    useCodeReviewStore.getState().selectTask('task-123')
    const state = useCodeReviewStore.getState()
    expect(state.selectedTaskId).toBe('task-123')
    expect(state.diffFiles).toEqual([])
    expect(state.commits).toEqual([])
    expect(state.error).toBeNull()
  })

  it('switches active tab', () => {
    useCodeReviewStore.getState().setActiveTab('commits')
    expect(useCodeReviewStore.getState().activeTab).toBe('commits')
  })

  it('tracks loading states independently', () => {
    useCodeReviewStore.getState().setLoading('diff', true)
    useCodeReviewStore.getState().setLoading('commits', false)
    expect(useCodeReviewStore.getState().loading.diff).toBe(true)
    expect(useCodeReviewStore.getState().loading.commits).toBe(false)
  })

  it('stores diff files', () => {
    const files = [
      { path: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2, patch: '...' }
    ]
    useCodeReviewStore.getState().setDiffFiles(files)
    expect(useCodeReviewStore.getState().diffFiles).toEqual(files)
  })

  it('stores commits', () => {
    const commits = [{ hash: 'abc', message: 'test', author: 'bot', date: '2026-04-01' }]
    useCodeReviewStore.getState().setCommits(commits)
    expect(useCodeReviewStore.getState().commits).toEqual(commits)
  })

  it('resets all state to initial', () => {
    useCodeReviewStore.getState().selectTask('task-123')
    useCodeReviewStore.getState().setActiveTab('conversation')
    useCodeReviewStore.getState().setError('something broke')
    useCodeReviewStore.getState().reset()
    const state = useCodeReviewStore.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.activeTab).toBe('changes')
    expect(state.error).toBeNull()
  })

  it('deselects task with null', () => {
    useCodeReviewStore.getState().selectTask('task-123')
    useCodeReviewStore.getState().selectTask(null)
    expect(useCodeReviewStore.getState().selectedTaskId).toBeNull()
  })
})
