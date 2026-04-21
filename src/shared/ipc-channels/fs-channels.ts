/**
 * File system and memory file IPC channels.
 */

/** File system dialogs and reading */
export interface FsChannels {
  'fs:openFileDialog': {
    args: [opts?: { filters?: { name: string; extensions: string[] }[] }]
    result: string[] | null
  }
  'fs:readFileAsBase64': {
    args: [path: string]
    result: { data: string; mimeType: string; name: string }
  }
  'fs:readFileAsText': {
    args: [path: string]
    result: { content: string; name: string }
  }
  'fs:openDirectoryDialog': {
    args: []
    result: string | null
  }
  'fs:readDir': {
    args: [dirPath: string]
    result: { name: string; type: 'file' | 'directory'; size: number }[]
  }
  'fs:readFile': { args: [filePath: string]; result: string }
  'fs:writeFile': { args: [filePath: string, content: string]; result: void }
  'fs:watchDir': {
    args: [dirPath: string]
    result: { success: boolean; error?: string | undefined }
  }
  'fs:unwatchDir': { args: []; result: void }
  'fs:createFile': { args: [filePath: string]; result: void }
  'fs:createDir': { args: [dirPath: string]; result: void }
  'fs:rename': { args: [oldPath: string, newPath: string]; result: void }
  'fs:delete': { args: [targetPath: string]; result: void }
  'fs:stat': {
    args: [targetPath: string]
    result: { size: number; mtime: number; isDirectory: boolean }
  }
  'fs:listFiles': {
    args: [rootPath: string]
    result: string[]
  }
}

/** Memory file operations */
export interface MemoryChannels {
  'memory:listFiles': {
    args: []
    result: { path: string; name: string; size: number; modifiedAt: number; active: boolean }[]
  }
  'memory:readFile': {
    args: [path: string]
    result: string
  }
  'memory:writeFile': {
    args: [path: string, content: string]
    result: void
  }
  'memory:search': {
    args: [query: string]
    result: {
      results: Array<{
        path: string
        matches: Array<{ line: number; content: string }>
      }>
      timedOut: boolean
    }
  }
  'memory:getActiveFiles': {
    args: []
    result: Record<string, boolean>
  }
  'memory:setFileActive': {
    args: [path: string, active: boolean]
    result: Record<string, boolean>
  }
}
