import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptTemplate } from '../../lib/launchpad-types'

// Mock window.api.settings before importing store
const mockGetJson = vi.fn()
const mockSetJson = vi.fn()

Object.defineProperty(window, 'api', {
  value: {
    ...(window as unknown as { api: Record<string, unknown> }).api,
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      getJson: mockGetJson,
      setJson: mockSetJson,
      delete: vi.fn()
    }
  },
  writable: true,
  configurable: true
})

// Import AFTER mocks are set up
import { usePromptTemplatesStore } from '../promptTemplates'
import { DEFAULT_TEMPLATES } from '../../lib/default-templates'

describe('promptTemplatesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    usePromptTemplatesStore.setState({
      templates: [],
      loading: false
    })
  })

  describe('loadTemplates', () => {
    it('loads defaults when no user templates exist', async () => {
      mockGetJson.mockResolvedValue(null)

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates, loading } = usePromptTemplatesStore.getState()
      expect(loading).toBe(false)
      expect(templates).toHaveLength(DEFAULT_TEMPLATES.length)
      expect(templates[0].id).toBe('builtin-clean-code')
      expect(mockGetJson).toHaveBeenCalledWith('prompt_templates')
    })

    it('merges user templates with built-ins', async () => {
      const userTemplate: PromptTemplate = {
        id: 'user-1',
        name: 'My Custom',
        icon: '🚀',
        accent: 'purple',
        description: 'Custom task',
        questions: [],
        promptTemplate: 'Do the thing.',
        order: 10
      }
      mockGetJson.mockResolvedValue([userTemplate])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      // Should have all built-ins + the user template
      expect(templates.length).toBe(DEFAULT_TEMPLATES.length + 1)
      expect(templates.find((t) => t.id === 'user-1')).toBeDefined()
    })

    it('preserves user hidden state on built-in templates', async () => {
      const hiddenBuiltIn = { ...DEFAULT_TEMPLATES[0], hidden: true }
      mockGetJson.mockResolvedValue([hiddenBuiltIn])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      const cleanCode = templates.find((t) => t.id === 'builtin-clean-code')
      expect(cleanCode?.hidden).toBe(true)
    })

    it('sorts by order field', async () => {
      const userFirst: PromptTemplate = {
        id: 'user-first',
        name: 'First',
        icon: '1',
        accent: 'cyan',
        description: '',
        questions: [],
        promptTemplate: '',
        order: -1 // before all built-ins
      }
      mockGetJson.mockResolvedValue([userFirst])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates[0].id).toBe('user-first')
    })
  })

  describe('saveTemplate', () => {
    it('adds a new template and persists to settings', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      const newTemplate: PromptTemplate = {
        id: 'user-new',
        name: 'New One',
        icon: '🆕',
        accent: 'orange',
        description: 'Brand new',
        questions: [],
        promptTemplate: 'Do something new.',
        order: 99
      }

      await usePromptTemplatesStore.getState().saveTemplate(newTemplate)

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'user-new')).toBeDefined()
      expect(mockSetJson).toHaveBeenCalledWith(
        'prompt_templates',
        expect.arrayContaining([expect.objectContaining({ id: 'user-new' })])
      )
    })

    it('updates an existing template by id', async () => {
      const existing: PromptTemplate = {
        id: 'user-1',
        name: 'Old Name',
        icon: '🔧',
        accent: 'cyan',
        description: 'Old',
        questions: [],
        promptTemplate: 'Old prompt.',
        order: 10
      }
      mockGetJson.mockResolvedValue([existing])
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().saveTemplate({
        ...existing,
        name: 'New Name'
      })

      const { templates } = usePromptTemplatesStore.getState()
      const updated = templates.find((t) => t.id === 'user-1')
      expect(updated?.name).toBe('New Name')
    })
  })

  describe('deleteTemplate', () => {
    it('removes a user template', async () => {
      const userTemplate: PromptTemplate = {
        id: 'user-del',
        name: 'Delete Me',
        icon: '🗑️',
        accent: 'red',
        description: '',
        questions: [],
        promptTemplate: '',
        order: 10
      }
      mockGetJson.mockResolvedValue([userTemplate])
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().deleteTemplate('user-del')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'user-del')).toBeUndefined()
    })

    it('does not delete built-in templates', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().deleteTemplate('builtin-clean-code')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'builtin-clean-code')).toBeDefined()
    })
  })

  describe('hideBuiltIn', () => {
    it('toggles hidden state on a built-in template', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().hideBuiltIn('builtin-clean-code')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'builtin-clean-code')?.hidden).toBe(true)

      // Toggle back
      await usePromptTemplatesStore.getState().hideBuiltIn('builtin-clean-code')
      const after = usePromptTemplatesStore.getState().templates
      expect(after.find((t) => t.id === 'builtin-clean-code')?.hidden).toBeFalsy()
    })
  })

  describe('reorderTemplates', () => {
    it('reorders templates by id array and persists', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      const ids = usePromptTemplatesStore
        .getState()
        .templates.map((t) => t.id)
        .reverse()
      await usePromptTemplatesStore.getState().reorderTemplates(ids)

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.map((t) => t.id)).toEqual(ids)
      expect(templates[0].order).toBe(0)
      expect(templates[1].order).toBe(1)
    })
  })
})
