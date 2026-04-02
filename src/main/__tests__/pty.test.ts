import { describe, it, expect } from 'vitest'
import { isPtyAvailable, validateShell } from '../pty'

describe('pty', () => {
  it('reports availability', () => {
    expect(typeof isPtyAvailable()).toBe('boolean')
  })

  it('validates allowed shells', () => {
    expect(validateShell('/bin/zsh')).toBe(true)
    expect(validateShell('/bin/bash')).toBe(true)
    expect(validateShell('/bin/sh')).toBe(true)
    expect(validateShell('/usr/bin/evil')).toBe(false)
    expect(validateShell('')).toBe(false)
  })
})
