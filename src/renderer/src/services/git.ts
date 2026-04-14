export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.git.getRepoPaths()
}

export async function getGitStatus(cwd: string): ReturnType<typeof window.api.git.status> {
  return window.api.git.status(cwd)
}

export async function getGitDiff(cwd: string, path: string): Promise<string> {
  return window.api.git.diff(cwd, path)
}

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  return window.api.git.stage(cwd, paths)
}

export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  return window.api.git.unstage(cwd, paths)
}

export async function commit(cwd: string, message: string): Promise<void> {
  return window.api.git.commit(cwd, message)
}

export async function push(cwd: string): Promise<string> {
  return window.api.git.push(cwd)
}

export async function getBranches(cwd: string): ReturnType<typeof window.api.git.branches> {
  return window.api.git.branches(cwd)
}
