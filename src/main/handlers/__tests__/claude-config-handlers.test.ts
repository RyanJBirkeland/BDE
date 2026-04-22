/**
 * Claude config handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser')
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

import { registerClaudeConfigHandlers } from '../claude-config-handlers'
import { safeHandle } from '../../ipc-utils'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const mockEvent = {} as IpcMainInvokeEvent

function captureHandlers(): Record<
  string,
  (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
> {
  const handlers: Record<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {}
  vi.mocked(safeHandle).mockImplementation((channel, handler) => {
    handlers[channel as string] = handler as (
      event: IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown
  })
  registerClaudeConfigHandlers()
  return handlers
}

describe('claude-config-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 2 channels', () => {
    registerClaudeConfigHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(2)
    expect(safeHandle).toHaveBeenCalledWith('claude:getConfig', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('claude:setPermissions', expect.any(Function))
  })

  describe('claude:getConfig', () => {
    it('returns empty object when settings file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const handlers = captureHandlers()

      const result = await handlers['claude:getConfig'](mockEvent)

      expect(result).toEqual({})
    })

    it('returns parsed JSON when settings file exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ permissions: { allow: ['Bash'], deny: [] } })
      )
      const handlers = captureHandlers()

      const result = await handlers['claude:getConfig'](mockEvent)

      expect(result).toEqual({ permissions: { allow: ['Bash'], deny: [] } })
    })

    it('returns empty object when settings file has invalid JSON', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('not valid json{{{')
      const handlers = captureHandlers()

      const result = await handlers['claude:getConfig'](mockEvent)

      expect(result).toEqual({})
    })
  })

  describe('claude:setPermissions', () => {
    it('writes file with correct permissions content', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))
      const handlers = captureHandlers()

      await handlers['claude:setPermissions'](mockEvent, {
        allow: ['Bash', 'Read'],
        deny: ['Write']
      })

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        expect.stringContaining('"allow"')
      )
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed.permissions).toEqual({ allow: ['Bash', 'Read'], deny: ['Write'] })
    })

    it('creates .claude directory if missing', async () => {
      vi.mocked(existsSync).mockImplementation((_p) => {
        // CLAUDE_DIR doesn't exist, SETTINGS_PATH doesn't exist
        return false
      })
      const handlers = captureHandlers()

      await handlers['claude:setPermissions'](mockEvent, { allow: [], deny: [] })

      expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.claude'), {
        recursive: true
      })
    })

    it('preserves non-permission settings when updating', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ enabledPlugins: ['my-plugin'], otherSetting: 42 })
      )
      const handlers = captureHandlers()

      await handlers['claude:setPermissions'](mockEvent, { allow: ['Bash'], deny: [] })

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed.enabledPlugins).toEqual(['my-plugin'])
      expect(parsed.otherSetting).toBe(42)
      expect(parsed.permissions).toEqual({ allow: ['Bash'], deny: [] })
    })

    it('starts with empty settings when file has invalid JSON', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('invalid json')
      const handlers = captureHandlers()

      await handlers['claude:setPermissions'](mockEvent, { allow: ['Bash'], deny: ['Write'] })

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      // Only permissions should be set (no other preserved fields)
      expect(parsed).toEqual({ permissions: { allow: ['Bash'], deny: ['Write'] } })
    })
  })

  describe('claude:setPermissions payload validation', () => {
    it('rejects a non-object payload', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const handlers = captureHandlers()

      await expect(handlers['claude:setPermissions'](mockEvent, null)).rejects.toThrow(
        /invalid.*permissions/i
      )
      expect(writeFileSync).not.toHaveBeenCalled()
    })

    it('rejects when `allow` is missing', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const handlers = captureHandlers()

      await expect(
        handlers['claude:setPermissions'](mockEvent, { deny: ['Write'] })
      ).rejects.toThrow(/invalid.*permissions/i)
    })

    it('rejects when `allow` contains a non-string', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const handlers = captureHandlers()

      await expect(
        handlers['claude:setPermissions'](mockEvent, { allow: ['Bash', 42], deny: [] })
      ).rejects.toThrow(/invalid.*permissions/i)
    })

    it('rejects when a rule does not match a known permission prefix', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const handlers = captureHandlers()

      await expect(
        handlers['claude:setPermissions'](mockEvent, {
          allow: ['deleteAllFiles(*)'],
          deny: []
        })
      ).rejects.toThrow(/invalid.*permission/i)
    })

    it('accepts bare tool names and `Tool(...)` rules', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('{}')
      const handlers = captureHandlers()

      await handlers['claude:setPermissions'](mockEvent, {
        allow: ['Bash', 'Bash(npm test:*)', 'Read(src/**/*.ts)', 'WebFetch'],
        deny: ['Write', 'Bash(rm:*)']
      })

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed.permissions.allow).toEqual([
        'Bash',
        'Bash(npm test:*)',
        'Read(src/**/*.ts)',
        'WebFetch'
      ])
      expect(parsed.permissions.deny).toEqual(['Write', 'Bash(rm:*)'])
    })

    it('rejects rules exceeding a sensible length cap (DoS guard)', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const handlers = captureHandlers()
      const huge = 'Bash(' + 'a'.repeat(2000) + ':*)'

      await expect(
        handlers['claude:setPermissions'](mockEvent, { allow: [huge], deny: [] })
      ).rejects.toThrow(/invalid.*permission/i)
    })
  })
})
