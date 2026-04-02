import { describe, it, expect, beforeEach } from 'vitest'
import { usePanelLayoutStore } from '../panelLayout'

describe('ui store', () => {
  beforeEach(() => {
    usePanelLayoutStore.setState({ activeView: 'agents' })
  })

  it('initial state has activeView sessions', () => {
    expect(usePanelLayoutStore.getState().activeView).toBe('agents')
  })

  it('setView updates activeView', () => {
    usePanelLayoutStore.getState().setView('ide')
    expect(usePanelLayoutStore.getState().activeView).toBe('ide')
  })

  it('setView to each valid view works', () => {
    const views = ['agents', 'ide', 'sprint', 'code-review', 'settings'] as const
    for (const v of views) {
      usePanelLayoutStore.getState().setView(v)
      expect(usePanelLayoutStore.getState().activeView).toBe(v)
    }
  })
})
