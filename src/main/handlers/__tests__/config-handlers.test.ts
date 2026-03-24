/**
 * Config handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn(),
  deleteSetting: vi.fn(),
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
}))

import { registerConfigHandlers } from '../config-handlers'
import { safeHandle } from '../../ipc-utils'
import { getSetting, setSetting, getSettingJson, setSettingJson, deleteSetting } from '../../settings'

describe('Config handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 settings channels', () => {
    registerConfigHandlers()

    expect(safeHandle).toHaveBeenCalledTimes(5)
    expect(safeHandle).toHaveBeenCalledWith('settings:get', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:set', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:getJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:setJson', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('settings:delete', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerConfigHandlers()
      return handlers
    }

    const mockEvent = {} as IpcMainInvokeEvent

    it('settings:get calls getSetting with key', () => {
      vi.mocked(getSetting).mockReturnValue('myValue')
      const handlers = captureHandlers()

      const result = handlers['settings:get'](mockEvent, 'myKey')

      expect(getSetting).toHaveBeenCalledWith('myKey')
      expect(result).toBe('myValue')
    })

    it('settings:set calls setSetting with key and value', () => {
      const handlers = captureHandlers()

      handlers['settings:set'](mockEvent, 'myKey', 'myValue')

      expect(setSetting).toHaveBeenCalledWith('myKey', 'myValue')
    })

    it('settings:getJson calls getSettingJson with key', () => {
      vi.mocked(getSettingJson).mockReturnValue({ foo: 'bar' })
      const handlers = captureHandlers()

      const result = handlers['settings:getJson'](mockEvent, 'myKey')

      expect(getSettingJson).toHaveBeenCalledWith('myKey')
      expect(result).toEqual({ foo: 'bar' })
    })

    it('settings:setJson calls setSettingJson with key and value', () => {
      const handlers = captureHandlers()

      handlers['settings:setJson'](mockEvent, 'myKey', { foo: 'bar' })

      expect(setSettingJson).toHaveBeenCalledWith('myKey', { foo: 'bar' })
    })

    it('settings:delete calls deleteSetting with key', () => {
      const handlers = captureHandlers()

      handlers['settings:delete'](mockEvent, 'myKey')

      expect(deleteSetting).toHaveBeenCalledWith('myKey')
    })
  })
})
