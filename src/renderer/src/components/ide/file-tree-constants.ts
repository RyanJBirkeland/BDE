export const HIDDEN_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache'])

export interface DirEntry {
  name: string
  type: 'file' | 'directory'
  size: number
}
