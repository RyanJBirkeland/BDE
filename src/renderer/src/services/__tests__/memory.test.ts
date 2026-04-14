import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listFiles, readFile, writeFile, search, getActiveFiles, setFileActive } from '../memory'

describe('memory service', () => {
  beforeEach(() => {
    // window.api is mocked globally via vitest setup
    vi.mocked(window.api.memory.listFiles).mockResolvedValue([
      { path: '/mem/note.md', name: 'note.md', size: 128, modifiedAt: 1710000000000, active: true }
    ])
    vi.mocked(window.api.memory.readFile).mockResolvedValue('# Note content')
    vi.mocked(window.api.memory.writeFile).mockResolvedValue(undefined)
    vi.mocked(window.api.memory.search).mockResolvedValue({
      results: [{ path: '/mem/note.md', matches: [{ line: 1, content: '# Note content' }] }],
      timedOut: false
    })
    vi.mocked(window.api.memory.getActiveFiles).mockResolvedValue({ '/mem/note.md': true })
    vi.mocked(window.api.memory.setFileActive).mockResolvedValue({ '/mem/note.md': false })
  })

  it('listFiles delegates to window.api.memory.listFiles', async () => {
    const result = await listFiles()
    expect(window.api.memory.listFiles).toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('note.md')
  })

  it('readFile delegates to window.api.memory.readFile', async () => {
    const result = await readFile('/mem/note.md')
    expect(window.api.memory.readFile).toHaveBeenCalledWith('/mem/note.md')
    expect(result).toBe('# Note content')
  })

  it('writeFile delegates to window.api.memory.writeFile', async () => {
    await writeFile('/mem/note.md', 'new content')
    expect(window.api.memory.writeFile).toHaveBeenCalledWith('/mem/note.md', 'new content')
  })

  it('search delegates to window.api.memory.search', async () => {
    const result = await search('note')
    expect(window.api.memory.search).toHaveBeenCalledWith('note')
    expect(result.results).toHaveLength(1)
    expect(result.results[0].matches[0].content).toBe('# Note content')
    expect(result.timedOut).toBe(false)
  })

  it('getActiveFiles delegates to window.api.memory.getActiveFiles', async () => {
    const result = await getActiveFiles()
    expect(window.api.memory.getActiveFiles).toHaveBeenCalled()
    expect(result).toEqual({ '/mem/note.md': true })
  })

  it('setFileActive delegates to window.api.memory.setFileActive', async () => {
    const result = await setFileActive('/mem/note.md', false)
    expect(window.api.memory.setFileActive).toHaveBeenCalledWith('/mem/note.md', false)
    expect(result).toEqual({ '/mem/note.md': false })
  })
})
