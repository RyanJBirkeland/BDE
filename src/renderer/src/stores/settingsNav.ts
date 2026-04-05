import { create } from 'zustand'

/**
 * Settings navigation store — tracks active settings section for deep linking.
 * Used by openSettings() helper and SettingsView component.
 */

export type SettingsSectionId =
  | 'connections'
  | 'permissions'
  | 'repositories'
  | 'templates'
  | 'agentManager'
  | 'webhooks'
  | 'cost'
  | 'memory'
  | 'appearance'
  | 'keybindings'
  | 'about'

interface SettingsNavStore {
  activeSection: SettingsSectionId
  setActiveSection: (sectionId: SettingsSectionId) => void
}

export const useSettingsNavStore = create<SettingsNavStore>((set) => ({
  activeSection: 'connections',
  setActiveSection: (sectionId) => set({ activeSection: sectionId })
}))
