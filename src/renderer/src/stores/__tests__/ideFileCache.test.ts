import { describe, it, expect, beforeEach } from 'vitest'
import { useIDEFileCache } from '../ideFileCache'

beforeEach(() => {
  useIDEFileCache.setState({ fileContents: {}, fileLoadingStates: {} })
})

describe('useIDEFileCache', () => {
  it('starts empty', () => {
    const state = useIDEFileCache.getState()
    expect(state.fileContents).toEqual({})
    expect(state.fileLoadingStates).toEqual({})
  })

  it('setFileContent stores content for the given path', () => {
    useIDEFileCache.getState().setFileContent('/src/foo.ts', 'const x = 1')
    expect(useIDEFileCache.getState().fileContents['/src/foo.ts']).toBe('const x = 1')
  })

  it('setFileContent preserves other paths', () => {
    useIDEFileCache.getState().setFileContent('/a.ts', 'a')
    useIDEFileCache.getState().setFileContent('/b.ts', 'b')
    const { fileContents } = useIDEFileCache.getState()
    expect(fileContents['/a.ts']).toBe('a')
    expect(fileContents['/b.ts']).toBe('b')
  })

  it('setFileLoading sets loading state for the given path', () => {
    useIDEFileCache.getState().setFileLoading('/src/bar.ts', true)
    expect(useIDEFileCache.getState().fileLoadingStates['/src/bar.ts']).toBe(true)
  })

  it('setFileLoading preserves other paths loading states', () => {
    useIDEFileCache.getState().setFileLoading('/a.ts', true)
    useIDEFileCache.getState().setFileLoading('/b.ts', false)
    const { fileLoadingStates } = useIDEFileCache.getState()
    expect(fileLoadingStates['/a.ts']).toBe(true)
    expect(fileLoadingStates['/b.ts']).toBe(false)
  })

  it('clearFileContent removes the entry and its loading state', () => {
    useIDEFileCache.getState().setFileContent('/src/foo.ts', 'content')
    useIDEFileCache.getState().setFileLoading('/src/foo.ts', false)
    useIDEFileCache.getState().clearFileContent('/src/foo.ts')
    const state = useIDEFileCache.getState()
    expect(state.fileContents['/src/foo.ts']).toBeUndefined()
    expect(state.fileLoadingStates['/src/foo.ts']).toBeUndefined()
  })

  it('clearFileContent does not affect other paths', () => {
    useIDEFileCache.getState().setFileContent('/a.ts', 'a')
    useIDEFileCache.getState().setFileContent('/b.ts', 'b')
    useIDEFileCache.getState().clearFileContent('/a.ts')
    expect(useIDEFileCache.getState().fileContents['/b.ts']).toBe('b')
  })

  it('clearAll empties both maps', () => {
    useIDEFileCache.getState().setFileContent('/a.ts', 'a')
    useIDEFileCache.getState().setFileLoading('/a.ts', true)
    useIDEFileCache.getState().clearAll()
    const state = useIDEFileCache.getState()
    expect(state.fileContents).toEqual({})
    expect(state.fileLoadingStates).toEqual({})
  })
})
