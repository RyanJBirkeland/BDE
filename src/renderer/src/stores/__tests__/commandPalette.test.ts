import { describe, it, expect, beforeEach } from 'vitest'
import { useCommandPaletteStore } from '../commandPalette'

const initialState = { isOpen: false }

beforeEach(() => {
  useCommandPaletteStore.setState(initialState)
})

describe('initial state', () => {
  it('starts closed', () => {
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })
})

describe('open', () => {
  it('sets isOpen to true', () => {
    useCommandPaletteStore.getState().open()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)
  })

  it('is idempotent — calling open twice stays open', () => {
    useCommandPaletteStore.getState().open()
    useCommandPaletteStore.getState().open()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)
  })
})

describe('close', () => {
  it('sets isOpen to false', () => {
    useCommandPaletteStore.setState({ isOpen: true })
    useCommandPaletteStore.getState().close()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('is idempotent — calling close when already closed stays closed', () => {
    useCommandPaletteStore.getState().close()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })
})

describe('toggle', () => {
  it('opens when closed', () => {
    useCommandPaletteStore.setState({ isOpen: false })
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)
  })

  it('closes when open', () => {
    useCommandPaletteStore.setState({ isOpen: true })
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('double toggle returns to original state', () => {
    useCommandPaletteStore.setState({ isOpen: false })
    useCommandPaletteStore.getState().toggle()
    useCommandPaletteStore.getState().toggle()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })
})

describe('open/close sequence', () => {
  it('open then close results in closed', () => {
    useCommandPaletteStore.getState().open()
    useCommandPaletteStore.getState().close()
    expect(useCommandPaletteStore.getState().isOpen).toBe(false)
  })

  it('close then open results in open', () => {
    useCommandPaletteStore.getState().close()
    useCommandPaletteStore.getState().open()
    expect(useCommandPaletteStore.getState().isOpen).toBe(true)
  })
})
