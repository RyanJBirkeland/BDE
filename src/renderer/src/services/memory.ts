export interface MemorySearchMatch {
  line: number
  content: string
}

export interface MemorySearchResult {
  path: string
  matches: MemorySearchMatch[]
}

export async function listFiles(): Promise<
  { path: string; name: string; size: number; modifiedAt: number }[]
> {
  return window.api.listMemoryFiles()
}

export async function readFile(path: string): Promise<string> {
  return window.api.readMemoryFile(path)
}

export async function writeFile(path: string, content: string): Promise<void> {
  return window.api.writeMemoryFile(path, content)
}

export async function search(query: string): Promise<MemorySearchResult[]> {
  return window.api.searchMemory(query)
}
