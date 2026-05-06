export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.git.getRepoPaths()
}

/**
 * True when `path` is at, or inside, one of the user's configured repository
 * roots. Used to gate IPC calls that the main process rejects for unknown
 * paths (e.g. git:status), so we don't spam fleet.log with handler errors
 * when the IDE is opened on a folder that isn't a configured repo.
 */
export async function isConfiguredRepoPath(path: string): Promise<boolean> {
  const roots = Object.values(await getRepoPaths())
  return roots.some((root) => path === root || path.startsWith(root + '/'))
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

export async function diffBetweenRefs(
  payload: Parameters<typeof window.api.git.diffBetweenRefs>[0]
): ReturnType<typeof window.api.git.diffBetweenRefs> {
  return window.api.git.diffBetweenRefs(payload)
}

export async function checkoutBranch(
  cwd: string,
  branchName: string
): ReturnType<typeof window.api.git.checkout> {
  return window.api.git.checkout(cwd, branchName)
}

export async function fetchRemote(cwd: string): ReturnType<typeof window.api.git.fetch> {
  return window.api.git.fetch(cwd)
}

export async function pullBranch(
  cwd: string,
  branch: string
): ReturnType<typeof window.api.git.pull> {
  return window.api.git.pull(cwd, branch)
}
