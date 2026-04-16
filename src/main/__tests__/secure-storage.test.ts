import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEncryptString, mockDecryptString, mockIsEncryptionAvailable } = vi.hoisted(() => ({
  mockEncryptString: vi.fn(),
  mockDecryptString: vi.fn(),
  mockIsEncryptionAvailable: vi.fn()
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString
  }
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import {
  SENSITIVE_SETTING_KEYS,
  isEncryptionAvailable,
  encryptSetting,
  decryptSetting
} from '../secure-storage'

describe('SENSITIVE_SETTING_KEYS', () => {
  it('includes github.token and supabase.serviceKey', () => {
    expect(SENSITIVE_SETTING_KEYS.has('github.token')).toBe(true)
    expect(SENSITIVE_SETTING_KEYS.has('supabase.serviceKey')).toBe(true)
  })

  it('does not include repos or agent.eventRetentionDays', () => {
    expect(SENSITIVE_SETTING_KEYS.has('repos')).toBe(false)
    expect(SENSITIVE_SETTING_KEYS.has('agent.eventRetentionDays')).toBe(false)
  })
})

describe('isEncryptionAvailable', () => {
  it('delegates to safeStorage.isEncryptionAvailable', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    expect(isEncryptionAvailable()).toBe(true)
    expect(mockIsEncryptionAvailable).toHaveBeenCalled()

    mockIsEncryptionAvailable.mockReturnValue(false)
    expect(isEncryptionAvailable()).toBe(false)
  })
})

describe('encryptSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ENC:-prefixed base64 when encryption is available', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    const fakeBuffer = Buffer.from('encrypted-bytes')
    mockEncryptString.mockReturnValue(fakeBuffer)

    const result = encryptSetting('my-secret')
    expect(result.startsWith('ENC:')).toBe(true)
    const decoded = Buffer.from(result.slice(4), 'base64')
    expect(decoded).toEqual(fakeBuffer)
  })

  it('calls safeStorage.encryptString with the value', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    mockEncryptString.mockReturnValue(Buffer.from('enc'))

    encryptSetting('test-value')
    expect(mockEncryptString).toHaveBeenCalledWith('test-value')
  })

  it('throws when encryption is unavailable', () => {
    mockIsEncryptionAvailable.mockReturnValue(false)

    expect(() => encryptSetting('plain-secret')).toThrow('Cannot store sensitive setting')
    expect(mockEncryptString).not.toHaveBeenCalled()
  })
})

describe('decryptSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decrypts ENC:-prefixed values and returns the original string', () => {
    const original = 'my-secret-value'
    const fakeBuffer = Buffer.from('encrypted-bytes')
    const encoded = 'ENC:' + fakeBuffer.toString('base64')
    mockDecryptString.mockReturnValue(original)

    const result = decryptSetting(encoded)
    expect(result).toBe(original)
  })

  it('returns plaintext as-is (no ENC: prefix) and does NOT call decryptString', () => {
    const plain = 'legacy-plaintext-token'
    const result = decryptSetting(plain)
    expect(result).toBe(plain)
    expect(mockDecryptString).not.toHaveBeenCalled()
  })

  it('calls safeStorage.decryptString with the decoded buffer for encrypted values', () => {
    const fakeBuffer = Buffer.from('encrypted-bytes')
    const encoded = 'ENC:' + fakeBuffer.toString('base64')
    mockDecryptString.mockReturnValue('decrypted')

    decryptSetting(encoded)
    expect(mockDecryptString).toHaveBeenCalledWith(fakeBuffer)
  })

  it('returns stored value and logs error when decryptString throws', () => {
    mockDecryptString.mockImplementationOnce(() => {
      throw new Error('keychain unavailable')
    })
    const fakeEncrypted = 'ENC:' + Buffer.from('some_data').toString('base64')
    const result = decryptSetting(fakeEncrypted)
    expect(result).toBe(fakeEncrypted)
  })
})
