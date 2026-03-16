import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../ui'

describe('ui store', () => {
  beforeEach(() => {
    useUIStore.setState({ activeView: 'sessions', repoFilter: 'all' })
  })

  it('initial state has activeView sessions', () => {
    expect(useUIStore.getState().activeView).toBe('sessions')
  })

  it('initial state has repoFilter all', () => {
    expect(useUIStore.getState().repoFilter).toBe('all')
  })

  it('setView updates activeView', () => {
    useUIStore.getState().setView('terminal')
    expect(useUIStore.getState().activeView).toBe('terminal')
  })

  it('setView to each valid view works', () => {
    const views = ['sessions', 'terminal', 'sprint', 'diff', 'memory', 'cost', 'settings'] as const
    for (const v of views) {
      useUIStore.getState().setView(v)
      expect(useUIStore.getState().activeView).toBe(v)
    }
  })

  it('setRepoFilter updates repoFilter', () => {
    useUIStore.getState().setRepoFilter('life-os')
    expect(useUIStore.getState().repoFilter).toBe('life-os')
  })

  it('setRepoFilter to feast works', () => {
    useUIStore.getState().setRepoFilter('feast')
    expect(useUIStore.getState().repoFilter).toBe('feast')
  })
})
