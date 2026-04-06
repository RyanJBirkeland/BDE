/**
 * Shared list of agent steering slash commands. Used by CommandBar and
 * CommandAutocomplete so they stay in sync.
 */
export interface AgentCommand {
  name: string
  description: string
}

export const AGENT_COMMANDS: AgentCommand[] = [
  { name: '/stop', description: 'Kill the running agent' },
  { name: '/retry', description: 'Requeue the sprint task' },
  { name: '/focus', description: 'Steer to focus on a topic' },
  {
    name: '/checkpoint',
    description:
      'Commit current worktree state without stopping. If the agent is mid-write, git may briefly hold an index.lock — wait a moment and retry.'
  },
  { name: '/test', description: 'Ask the agent to run the test suite now' },
  { name: '/scope', description: 'Narrow the agent to specific files: /scope src/foo.ts' },
  { name: '/status', description: 'Ask the agent to report current progress' }
]
