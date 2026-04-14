export interface MemorySearchMatch {
  line: number
  content: string
}

export interface MemorySearchResult {
  path: string
  matches: MemorySearchMatch[]
}

export async function listFiles(): Promise<
  { path: string; name: string; size: number; modifiedAt: number; active: boolean }[]
> {
  return window.api.memory.listFiles()
}

export async function readFile(path: string): Promise<string> {
  return window.api.memory.readFile(path)
}

export async function writeFile(path: string, content: string): Promise<void> {
  return window.api.memory.writeFile(path, content)
}

export async function search(
  query: string
): Promise<{ results: MemorySearchResult[]; timedOut: boolean }> {
  return window.api.memory.search(query)
}

export async function getActiveFiles(): Promise<Record<string, boolean>> {
  return window.api.memory.getActiveFiles()
}

export async function setFileActive(
  path: string,
  active: boolean
): Promise<Record<string, boolean>> {
  return window.api.memory.setFileActive(path, active)
}
