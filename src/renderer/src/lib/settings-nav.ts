import { usePanelLayoutStore } from '../stores/panelLayout'
import { useSettingsNavStore, type SettingsSectionId } from '../stores/settingsNav'

/**
 * Opens the Settings view and optionally navigates to a specific section.
 * Used by keyboard shortcuts and other navigation triggers.
 *
 * @param sectionId - Optional section to navigate to. Defaults to current active section.
 */
export function openSettings(sectionId?: SettingsSectionId): void {
  // Navigate to settings view
  usePanelLayoutStore.getState().setView('settings')

  // If a specific section is requested, update the active section
  if (sectionId) {
    useSettingsNavStore.getState().setActiveSection(sectionId)
  }
}
