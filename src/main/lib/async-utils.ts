import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Promisified execFile — prefer this over execSync for shell safety. */
export const execFileAsync = promisify(execFile)
