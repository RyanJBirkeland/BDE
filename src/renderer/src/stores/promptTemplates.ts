// src/renderer/src/stores/promptTemplates.ts
//
// Zustand store for prompt template CRUD.
// Templates are persisted to SQLite settings table via IPC.
// Built-in defaults are merged with user templates on load.

import { create } from 'zustand'
import type { PromptTemplate } from '../lib/launchpad-types'
import { DEFAULT_TEMPLATES } from '../lib/default-templates'

const SETTINGS_KEY = 'prompt_templates'

interface PromptTemplatesState {
  templates: PromptTemplate[]
  loading: boolean
  loadTemplates: () => Promise<void>
  saveTemplate: (template: PromptTemplate) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  reorderTemplates: (orderedIds: string[]) => Promise<void>
  hideBuiltIn: (id: string) => Promise<void>
}

/**
 * Merges user-saved templates with built-in defaults.
 *
 * - Built-in templates always exist (from DEFAULT_TEMPLATES).
 * - If a user has a saved version of a built-in (same id), user's version wins
 *   (preserves hidden state, order overrides, etc.).
 * - User-created templates (non-builtin ids) are appended.
 * - Result is sorted by `order` field.
 */
function mergeTemplates(userTemplates: PromptTemplate[]): PromptTemplate[] {
  const userMap = new Map(userTemplates.map((t) => [t.id, t]))
  const merged: PromptTemplate[] = []

  // Add all built-ins, applying user overrides if they exist
  for (const builtin of DEFAULT_TEMPLATES) {
    const userVersion = userMap.get(builtin.id)
    if (userVersion) {
      // User has overridden this built-in (e.g., hidden it or reordered)
      merged.push({ ...builtin, ...userVersion, builtIn: true })
      userMap.delete(builtin.id)
    } else {
      merged.push({ ...builtin })
    }
  }

  // Add remaining user-created templates
  for (const userTemplate of userMap.values()) {
    merged.push(userTemplate)
  }

  // Sort by order
  merged.sort((a, b) => a.order - b.order)

  return merged
}

/** Extracts only user-modified data for persistence (not raw built-in defaults). */
function toPersistedTemplates(templates: PromptTemplate[]): PromptTemplate[] {
  return templates.filter((t) => {
    // Always persist user-created templates
    if (!t.builtIn) return true
    // Persist built-ins only if user modified them (hidden, reordered, etc.)
    const defaultVersion = DEFAULT_TEMPLATES.find((d) => d.id === t.id)
    if (!defaultVersion) return true
    return t.hidden || t.order !== defaultVersion.order
  })
}

export const usePromptTemplatesStore = create<PromptTemplatesState>((set, get) => ({
  templates: [],
  loading: false,

  loadTemplates: async () => {
    set({ loading: true })
    try {
      const saved = (await window.api.settings.getJson(SETTINGS_KEY)) as PromptTemplate[] | null
      const merged = mergeTemplates(saved ?? [])
      set({ templates: merged, loading: false })
    } catch {
      // If settings load fails, fall back to defaults
      set({ templates: [...DEFAULT_TEMPLATES], loading: false })
    }
  },

  saveTemplate: async (template) => {
    const { templates } = get()
    const existing = templates.findIndex((t) => t.id === template.id)

    let updated: PromptTemplate[]
    if (existing >= 0) {
      updated = templates.map((t) => (t.id === template.id ? template : t))
    } else {
      updated = [...templates, template]
    }

    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  },

  deleteTemplate: async (id) => {
    const { templates } = get()
    const target = templates.find((t) => t.id === id)

    // Cannot delete built-in templates
    if (!target || target.builtIn) return

    const updated = templates.filter((t) => t.id !== id)
    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  },

  reorderTemplates: async (orderedIds) => {
    const { templates } = get()
    const idToTemplate = new Map(templates.map((t) => [t.id, t]))
    const reordered = orderedIds
      .map((id, index) => {
        const t = idToTemplate.get(id)
        return t ? { ...t, order: index } : undefined
      })
      .filter((t): t is PromptTemplate => t !== undefined)

    set({ templates: reordered })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(reordered))
  },

  hideBuiltIn: async (id) => {
    const { templates } = get()
    const updated = templates.map((t) =>
      t.id === id && t.builtIn ? { ...t, hidden: !t.hidden } : t
    )
    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  }
}))
