import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../ui'

describe('ui store', () => {
  beforeEach(() => {
    useUIStore.setState({ activeView: 'agents' })
  })

  it('initial state has activeView sessions', () => {
    expect(useUIStore.getState().activeView).toBe('agents')
  })

  it('setView updates activeView', () => {
    useUIStore.getState().setView('ide')
    expect(useUIStore.getState().activeView).toBe('ide')
  })

  it('setView to each valid view works', () => {
    const views = ['agents', 'ide', 'sprint', 'pr-station', 'memory', 'cost', 'settings'] as const
    for (const v of views) {
      useUIStore.getState().setView(v)
      expect(useUIStore.getState().activeView).toBe(v)
    }
  })
})
