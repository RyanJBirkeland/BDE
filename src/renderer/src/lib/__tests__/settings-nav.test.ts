import { describe, it, expect, vi } from 'vitest'

vi.mock('../../stores/panelLayout', () => ({
  usePanelLayoutStore: {
    getState: vi.fn().mockReturnValue({ setView: vi.fn() })
  }
}))

vi.mock('../../stores/settingsNav', () => ({
  useSettingsNavStore: {
    getState: vi.fn().mockReturnValue({ setActiveSection: vi.fn() })
  }
}))

import { openSettings } from '../settings-nav'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useSettingsNavStore } from '../../stores/settingsNav'

describe('openSettings', () => {
  it('navigates to settings view', () => {
    openSettings()
    expect(usePanelLayoutStore.getState().setView).toHaveBeenCalledWith('settings')
  })

  it('sets active section when sectionId provided', () => {
    openSettings('connections')
    expect(usePanelLayoutStore.getState().setView).toHaveBeenCalledWith('settings')
    expect(useSettingsNavStore.getState().setActiveSection).toHaveBeenCalledWith('connections')
  })

  it('does not set active section when sectionId omitted', () => {
    vi.mocked(useSettingsNavStore.getState().setActiveSection).mockClear()
    openSettings()
    expect(useSettingsNavStore.getState().setActiveSection).not.toHaveBeenCalled()
  })
})
