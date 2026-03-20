import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../ui'

describe('ui store', () => {
  beforeEach(() => {
    useUIStore.setState({ activeView: 'sessions' })
  })

  it('initial state has activeView sessions', () => {
    expect(useUIStore.getState().activeView).toBe('sessions')
  })

  it('setView updates activeView', () => {
    useUIStore.getState().setView('terminal')
    expect(useUIStore.getState().activeView).toBe('terminal')
  })

  it('setView to each valid view works', () => {
    const views = ['sessions', 'terminal', 'sprint', 'pr-station', 'memory', 'cost', 'settings'] as const
    for (const v of views) {
      useUIStore.getState().setView(v)
      expect(useUIStore.getState().activeView).toBe(v)
    }
  })
})
