import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsNavStore } from '../settingsNav'

beforeEach(() => {
  useSettingsNavStore.setState({ activeSection: 'connections' })
})

describe('useSettingsNavStore', () => {
  it('defaults to the "connections" section', () => {
    expect(useSettingsNavStore.getState().activeSection).toBe('connections')
  })

  it('setActiveSection updates the active section', () => {
    useSettingsNavStore.getState().setActiveSection('repositories')
    expect(useSettingsNavStore.getState().activeSection).toBe('repositories')
  })

  it('can navigate to each valid section', () => {
    const sections = [
      'connections',
      'repositories',
      'agents',
      'models',
      'templates',
      'memory',
      'appearance',
      'about'
    ] as const

    for (const section of sections) {
      useSettingsNavStore.getState().setActiveSection(section)
      expect(useSettingsNavStore.getState().activeSection).toBe(section)
    }
  })
})
