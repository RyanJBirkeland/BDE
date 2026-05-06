import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSetting, setSetting, getJsonSetting, setJsonSetting } from '../settings-storage'

describe('settings-storage service', () => {
  beforeEach(() => {
    vi.mocked(window.api.settings.get).mockResolvedValue(null)
    vi.mocked(window.api.settings.set).mockResolvedValue(undefined)
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
    vi.mocked(window.api.settings.setJson).mockResolvedValue(undefined)
  })

  it('getSetting delegates to window.api.settings.get', async () => {
    vi.mocked(window.api.settings.get).mockResolvedValue('value')
    const result = await getSetting('keybindings')
    expect(window.api.settings.get).toHaveBeenCalledWith('keybindings')
    expect(result).toBe('value')
  })

  it('setSetting delegates to window.api.settings.set', async () => {
    await setSetting('keybindings', '{"k":"v"}')
    expect(window.api.settings.set).toHaveBeenCalledWith('keybindings', '{"k":"v"}')
  })

  it('getJsonSetting returns parsed value when guard accepts it', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue({ foo: 'bar' })
    const isFooBag = (raw: unknown): raw is { foo: string } =>
      typeof raw === 'object' && raw !== null && typeof (raw as { foo: unknown }).foo === 'string'
    const result = await getJsonSetting('panel.layout', isFooBag)
    expect(window.api.settings.getJson).toHaveBeenCalledWith('panel.layout')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('getJsonSetting returns null and warns when guard rejects payload', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue({ unexpected: 1 })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const isStringBag = (raw: unknown): raw is { foo: string } =>
      typeof raw === 'object' && raw !== null && typeof (raw as { foo: unknown }).foo === 'string'
    const result = await getJsonSetting('panel.layout', isStringBag)
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('getJsonSetting returns null when key is unset', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
    const result = await getJsonSetting('panel.layout', (_v): _v is unknown => true)
    expect(result).toBeNull()
  })

  it('setJsonSetting delegates to window.api.settings.setJson', async () => {
    await setJsonSetting('panel.layout', { split: true })
    expect(window.api.settings.setJson).toHaveBeenCalledWith('panel.layout', { split: true })
  })
})
