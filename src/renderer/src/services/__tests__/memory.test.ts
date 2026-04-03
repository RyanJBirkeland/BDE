import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listFiles, readFile, writeFile, search } from '../memory'

describe('memory service', () => {
  beforeEach(() => {
    // window.api is mocked globally via vitest setup
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: '/mem/note.md', name: 'note.md', size: 128, modifiedAt: 1710000000000 }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('# Note content')
    vi.mocked(window.api.writeMemoryFile).mockResolvedValue(undefined)
    vi.mocked(window.api.searchMemory).mockResolvedValue([
      { path: '/mem/note.md', matches: [{ line: 1, content: '# Note content' }] }
    ])
  })

  it('listFiles delegates to window.api.listMemoryFiles', async () => {
    const result = await listFiles()
    expect(window.api.listMemoryFiles).toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('note.md')
  })

  it('readFile delegates to window.api.readMemoryFile', async () => {
    const result = await readFile('/mem/note.md')
    expect(window.api.readMemoryFile).toHaveBeenCalledWith('/mem/note.md')
    expect(result).toBe('# Note content')
  })

  it('writeFile delegates to window.api.writeMemoryFile', async () => {
    await writeFile('/mem/note.md', 'new content')
    expect(window.api.writeMemoryFile).toHaveBeenCalledWith('/mem/note.md', 'new content')
  })

  it('search delegates to window.api.searchMemory', async () => {
    const result = await search('note')
    expect(window.api.searchMemory).toHaveBeenCalledWith('note')
    expect(result).toHaveLength(1)
    expect(result[0].matches[0].content).toBe('# Note content')
  })
})
