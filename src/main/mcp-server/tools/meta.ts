import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  TASK_STATUSES,
  VALID_TRANSITIONS
} from '../../../shared/task-state-machine'
import type { RepoConfig } from '../../paths'
import { jsonContent } from './response'

export interface MetaToolsDeps {
  getRepos: () => RepoConfig[]
}

export function registerMetaTools(server: McpServer, deps: MetaToolsDeps): void {
  server.tool(
    'meta.repos',
    'List repositories configured in BDE Settings.',
    {},
    async () => jsonContent(deps.getRepos())
  )

  server.tool(
    'meta.taskStatuses',
    'List valid task statuses and allowed transitions.',
    {},
    async () => {
      const transitions: Record<string, string[]> = {}
      for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
        transitions[from] = [...targets]
      }
      return jsonContent({ statuses: TASK_STATUSES, transitions })
    }
  )

  server.tool(
    'meta.dependencyConditions',
    'List valid dependency condition values for tasks and epics.',
    {},
    async () =>
      jsonContent({
        task: ['hard', 'soft'],
        epic: ['on_success', 'always', 'manual']
      })
  )
}
