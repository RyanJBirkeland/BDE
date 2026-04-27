/**
 * Prepares an opencode worktree for an agent session.
 *
 * Two responsibilities:
 *   1. Write `.opencode/opencode.json` into the worktree, wiring in the
 *      per-session BDE MCP server so the model gets the same task/epic CRUD
 *      tools as the Claude path (without touching the external HTTP MCP server
 *      at port 18792, which is for non-BDE-native agents).
 *   2. Build the opencode-specific first-turn prompt — branch name and commit
 *      rules prepended to the raw user task. opencode auto-reads CLAUDE.md
 *      from --dir, so BDE conventions and architecture notes don't need
 *      re-injection here.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const OPENCODE_CONFIG_DIR = '.opencode'
const OPENCODE_CONFIG_FILE = 'opencode.json'
const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'

interface OpencodeRemoteMcpServer {
  type: 'remote'
  url: string
  headers: Record<string, string>
}

interface OpencodeWorktreeConfig {
  $schema: string
  mcp?: Record<string, OpencodeRemoteMcpServer>
}

/**
 * Writes `.opencode/opencode.json` into the worktree, wiring in the
 * per-session BDE MCP server at the given URL and token.
 *
 * Safe to call on every spawn — the file is overwritten, not accumulated.
 */
export async function writeOpencodeWorktreeConfig(
  worktreePath: string,
  mcpUrl: string,
  mcpToken: string
): Promise<void> {
  const config: OpencodeWorktreeConfig = {
    $schema: OPENCODE_SCHEMA,
    mcp: {
      bde: {
        type: 'remote',
        url: mcpUrl,
        headers: { Authorization: `Bearer ${mcpToken}` }
      }
    }
  }

  const configDir = join(worktreePath, OPENCODE_CONFIG_DIR)
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(
    join(configDir, OPENCODE_CONFIG_FILE),
    JSON.stringify(config, null, 2) + '\n',
    'utf8'
  )
}

/**
 * Builds the first-turn prompt for opencode sessions.
 *
 * opencode auto-reads CLAUDE.md from the working directory, so BDE
 * conventions don't need to be re-injected. Only branch name and commit
 * rules — the two things CLAUDE.md can't supply at spawn time — are added.
 */
export function buildOpencodeFirstTurnPrompt(task: string, branch: string): string {
  return [
    `You are working on branch \`${branch}\`.`,
    `Commit format: \`{type}({scope}): {description}\`. Run \`npm run typecheck && npm test\` before every commit.`,
    '',
    task
  ].join('\n')
}
