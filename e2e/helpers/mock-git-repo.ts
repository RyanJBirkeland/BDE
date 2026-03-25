import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Create a temp git repo with known file states for testing.
 * Returns the repo path and a cleanup function.
 *
 * The repo will have:
 * - One committed file (README.md)
 * - One unstaged file (unstaged.txt)
 * - One staged file (staged.txt)
 */
export function createMockGitRepo(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'bde-e2e-'))

  execFileSync('git', ['init'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })

  // Initial commit
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir })

  // Unstaged change
  writeFileSync(join(dir, 'unstaged.txt'), 'unstaged content')

  // Staged change
  writeFileSync(join(dir, 'staged.txt'), 'staged content')
  execFileSync('git', ['add', 'staged.txt'], { cwd: dir })

  return {
    path: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}
