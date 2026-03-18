import { join, resolve } from 'path'
import { homedir, tmpdir } from 'os'

// --- BDE data directory ---
export const BDE_DIR = join(homedir(), '.bde')
export const BDE_DB_PATH = join(BDE_DIR, 'bde.db')
export const BDE_AGENTS_INDEX = join(BDE_DIR, 'agents.json')
export const BDE_AGENT_LOGS_DIR = join(BDE_DIR, 'agent-logs')
export const BDE_AGENT_TMP_DIR = join(tmpdir(), 'bde-agents')

// --- OpenClaw paths ---
export const OPENCLAW_DIR = join(homedir(), '.openclaw')
export const OPENCLAW_CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json')
export const OPENCLAW_MEMORY_DIR = resolve(homedir(), '.openclaw', 'workspace', 'memory')

// --- Repository paths (default — overridable via settings) ---
const REPOS_ROOT = join(homedir(), 'Documents', 'Repositories')

export const DEFAULT_REPO_PATHS: Record<string, string> = {
  bde: join(REPOS_ROOT, 'BDE'),
  'life-os': join(REPOS_ROOT, 'life-os'),
  feast: join(REPOS_ROOT, 'feast'),
}

export const SPECS_ROOT = resolve(REPOS_ROOT, 'BDE', 'docs', 'specs')
export const LIFE_OS_ENV_PATH = join(REPOS_ROOT, 'life-os', '.env')
