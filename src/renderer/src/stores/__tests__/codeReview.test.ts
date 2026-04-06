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

  // --- Batch selection ---

  it('toggleBatchId adds an id', () => {
    useCodeReviewStore.getState().toggleBatchId('task-1')
    expect(useCodeReviewStore.getState().selectedBatchIds.has('task-1')).toBe(true)
  })

  it('toggleBatchId removes an already-selected id', () => {
    useCodeReviewStore.getState().toggleBatchId('task-1')
    useCodeReviewStore.getState().toggleBatchId('task-1')
    expect(useCodeReviewStore.getState().selectedBatchIds.has('task-1')).toBe(false)
  })

  it('toggleBatchId handles multiple ids', () => {
    useCodeReviewStore.getState().toggleBatchId('task-1')
    useCodeReviewStore.getState().toggleBatchId('task-2')
    const batch = useCodeReviewStore.getState().selectedBatchIds
    expect(batch.size).toBe(2)
    expect(batch.has('task-1')).toBe(true)
    expect(batch.has('task-2')).toBe(true)
  })

  it('selectAllBatch sets all provided ids', () => {
    useCodeReviewStore.getState().selectAllBatch(['a', 'b', 'c'])
    const batch = useCodeReviewStore.getState().selectedBatchIds
    expect(batch.size).toBe(3)
    expect(batch.has('a')).toBe(true)
    expect(batch.has('b')).toBe(true)
    expect(batch.has('c')).toBe(true)
  })

  it('clearBatch empties the selection', () => {
    useCodeReviewStore.getState().selectAllBatch(['a', 'b'])
    useCodeReviewStore.getState().clearBatch()
    expect(useCodeReviewStore.getState().selectedBatchIds.size).toBe(0)
  })

  // --- Review summary ---

  it('setReviewSummary stores the summary', () => {
    useCodeReviewStore.getState().setReviewSummary('Looks good!')
    expect(useCodeReviewStore.getState().reviewSummary).toBe('Looks good!')
  })

  it('setReviewSummary can clear summary with null', () => {
    useCodeReviewStore.getState().setReviewSummary('text')
    useCodeReviewStore.getState().setReviewSummary(null)
    expect(useCodeReviewStore.getState().reviewSummary).toBeNull()
  })

  it('setSummaryLoading updates loading flag', () => {
    useCodeReviewStore.getState().setSummaryLoading(true)
    expect(useCodeReviewStore.getState().summaryLoading).toBe(true)
    useCodeReviewStore.getState().setSummaryLoading(false)
    expect(useCodeReviewStore.getState().summaryLoading).toBe(false)
  })

  it('selectTask clears reviewSummary and summaryLoading', () => {
    useCodeReviewStore.getState().setReviewSummary('text')
    useCodeReviewStore.getState().setSummaryLoading(true)
    useCodeReviewStore.getState().selectTask('task-new')
    expect(useCodeReviewStore.getState().reviewSummary).toBeNull()
    expect(useCodeReviewStore.getState().summaryLoading).toBe(false)
  })
})
