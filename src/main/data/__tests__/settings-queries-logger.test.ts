import { describe, it, expect, vi } from 'vitest'
import { setSettingsQueriesLogger } from '../settings-queries'

describe('settings-queries logger injection', () => {
  it('exports setSettingsQueriesLogger', () => {
    expect(typeof setSettingsQueriesLogger).toBe('function')
  })
})
