/**
 * Template handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn()
}))

import { registerTemplateHandlers } from '../template-handlers'
import { safeHandle } from '../../ipc-utils'
import { getSettingJson, setSettingJson } from '../../settings'

const mockEvent = {} as IpcMainInvokeEvent

/** Capture the handler registered for a given channel. */
function captureHandler(channel: string): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined
  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })
  registerTemplateHandlers()
  if (!captured) throw new Error(`Handler for "${channel}" not registered`)
  return captured
}

describe('Template handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSettingJson).mockReturnValue(null)
  })

  it('registers all 4 template handlers', () => {
    registerTemplateHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(4)
    expect(safeHandle).toHaveBeenCalledWith('templates:list', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('templates:save', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('templates:delete', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('templates:reset', expect.any(Function))
  })

  describe('templates:list', () => {
    it('returns built-in templates with isBuiltIn=true when no overrides or custom', () => {
      vi.mocked(getSettingJson).mockReturnValue(null)
      const handler = captureHandler('templates:list')
      const result = handler(mockEvent)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const t of result) {
        expect(t.isBuiltIn).toBe(true)
        expect(t).toHaveProperty('name')
        expect(t).toHaveProperty('promptPrefix')
      }
    })

    it('applies overrides to built-in templates', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.overrides') return { bugfix: 'Custom bugfix prefix' }
        return null
      })
      const handler = captureHandler('templates:list')
      const result = handler(mockEvent)
      const bugfix = result.find((t: any) => t.name === 'bugfix')
      expect(bugfix).toBeDefined()
      expect(bugfix.promptPrefix).toBe('Custom bugfix prefix')
      expect(bugfix.isBuiltIn).toBe(true)
    })

    it('appends custom templates with isBuiltIn=false', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom')
          return [{ name: 'mytemplate', promptPrefix: 'Do something custom' }]
        return null
      })
      const handler = captureHandler('templates:list')
      const result = handler(mockEvent)
      const custom = result.find((t: any) => t.name === 'mytemplate')
      expect(custom).toBeDefined()
      expect(custom.isBuiltIn).toBe(false)
      expect(custom.promptPrefix).toBe('Do something custom')
    })

    it('returns built-in templates followed by custom templates in order', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom')
          return [
            { name: 'alpha', promptPrefix: 'Alpha' },
            { name: 'beta', promptPrefix: 'Beta' }
          ]
        return null
      })
      const handler = captureHandler('templates:list')
      const result = handler(mockEvent)
      const customIdx = result.findIndex((t: any) => t.name === 'alpha')
      // All built-ins should come before custom entries
      const builtInIdxes = result
        .map((t: any, i: number) => (t.isBuiltIn ? i : -1))
        .filter((i: number) => i >= 0)
      expect(Math.max(...builtInIdxes)).toBeLessThan(customIdx)
    })
  })

  describe('templates:save (built-in override)', () => {
    it('saves overrides for built-in template', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.overrides') return {}
        return null
      })
      const handler = captureHandler('templates:save')
      handler(mockEvent, { name: 'bugfix', promptPrefix: 'New prefix', isBuiltIn: true })

      expect(setSettingJson).toHaveBeenCalledWith('templates.overrides', {
        bugfix: 'New prefix'
      })
    })

    it('merges new override with existing overrides', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.overrides') return { feature: 'Existing override' }
        return null
      })
      const handler = captureHandler('templates:save')
      handler(mockEvent, { name: 'bugfix', promptPrefix: 'New bugfix', isBuiltIn: true })

      expect(setSettingJson).toHaveBeenCalledWith('templates.overrides', {
        feature: 'Existing override',
        bugfix: 'New bugfix'
      })
    })
  })

  describe('templates:save (custom template)', () => {
    it('adds new custom template to list', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom') return []
        return null
      })
      const handler = captureHandler('templates:save')
      handler(mockEvent, { name: 'newtemplate', promptPrefix: 'Do new things', isBuiltIn: false })

      expect(setSettingJson).toHaveBeenCalledWith('templates.custom', [
        { name: 'newtemplate', promptPrefix: 'Do new things' }
      ])
    })

    it('updates existing custom template in place', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom') return [{ name: 'existing', promptPrefix: 'Old prefix' }]
        return null
      })
      const handler = captureHandler('templates:save')
      handler(mockEvent, { name: 'existing', promptPrefix: 'Updated prefix', isBuiltIn: false })

      expect(setSettingJson).toHaveBeenCalledWith('templates.custom', [
        { name: 'existing', promptPrefix: 'Updated prefix' }
      ])
    })

    it('also syncs legacy task.templates setting after save', () => {
      vi.mocked(getSettingJson).mockReturnValue(null)
      const handler = captureHandler('templates:save')
      handler(mockEvent, { name: 'mytemplate', promptPrefix: 'Prefix', isBuiltIn: false })

      const legacyCall = vi
        .mocked(setSettingJson)
        .mock.calls.find(([key]) => key === 'task.templates')
      expect(legacyCall).toBeDefined()
    })
  })

  describe('templates:delete', () => {
    it('removes named custom template from list', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom')
          return [
            { name: 'keep', promptPrefix: 'Keep this' },
            { name: 'remove', promptPrefix: 'Remove this' }
          ]
        return null
      })
      const handler = captureHandler('templates:delete')
      handler(mockEvent, 'remove')

      expect(setSettingJson).toHaveBeenCalledWith('templates.custom', [
        { name: 'keep', promptPrefix: 'Keep this' }
      ])
    })

    it('is a no-op when template name not found', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.custom') return [{ name: 'keep', promptPrefix: 'Keep this' }]
        return null
      })
      const handler = captureHandler('templates:delete')
      handler(mockEvent, 'nonexistent')

      expect(setSettingJson).toHaveBeenCalledWith('templates.custom', [
        { name: 'keep', promptPrefix: 'Keep this' }
      ])
    })

    it('also syncs legacy task.templates setting after delete', () => {
      vi.mocked(getSettingJson).mockReturnValue(null)
      const handler = captureHandler('templates:delete')
      handler(mockEvent, 'anything')

      const legacyCall = vi
        .mocked(setSettingJson)
        .mock.calls.find(([key]) => key === 'task.templates')
      expect(legacyCall).toBeDefined()
    })
  })

  describe('templates:reset', () => {
    it('removes the override for a built-in template', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.overrides')
          return { bugfix: 'Custom prefix', feature: 'Other override' }
        return null
      })
      const handler = captureHandler('templates:reset')
      handler(mockEvent, 'bugfix')

      expect(setSettingJson).toHaveBeenCalledWith('templates.overrides', {
        feature: 'Other override'
      })
    })

    it('is a no-op when override does not exist', () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'templates.overrides') return { feature: 'Other override' }
        return null
      })
      const handler = captureHandler('templates:reset')
      handler(mockEvent, 'bugfix')

      expect(setSettingJson).toHaveBeenCalledWith('templates.overrides', {
        feature: 'Other override'
      })
    })

    it('also syncs legacy task.templates setting after reset', () => {
      vi.mocked(getSettingJson).mockReturnValue(null)
      const handler = captureHandler('templates:reset')
      handler(mockEvent, 'bugfix')

      const legacyCall = vi
        .mocked(setSettingJson)
        .mock.calls.find(([key]) => key === 'task.templates')
      expect(legacyCall).toBeDefined()
    })
  })
})
