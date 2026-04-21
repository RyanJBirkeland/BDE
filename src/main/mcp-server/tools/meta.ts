import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { TASK_STATUSES, VALID_TRANSITIONS } from '../../../shared/task-state-machine'
import type { RepoConfig } from '../../paths'
import { jsonContent } from './response'

export interface MetaToolsDeps {
  getRepos: () => RepoConfig[]
}

/**
 * `meta.taskStatuses` serves the same static shape on every call — the
 * state machine is compiled into the binary, not read from config. Freezing
 * the precomputed payload at module load avoids rebuilding the transitions
 * adjacency map (and spreading every Set to an array) on each request.
 */
const TASK_STATUS_PAYLOAD = Object.freeze({
  statuses: TASK_STATUSES,
  transitions: Object.fromEntries(
    Object.entries(VALID_TRANSITIONS).map(([from, targets]) => [from, [...targets]])
  )
})

/**
 * `meta.dependencyConditions` likewise returns a fixed vocabulary. Freezing
 * the payload here keeps the handler a one-liner and guarantees no caller
 * can mutate the shared response object.
 */
const DEPENDENCY_CONDITIONS_PAYLOAD = Object.freeze({
  task: ['hard', 'soft'],
  epic: ['on_success', 'always', 'manual']
})

export function registerMetaTools(server: McpServer, deps: MetaToolsDeps): void {
  server.tool('meta.repos', 'List repositories configured in BDE Settings.', {}, async () =>
    jsonContent(deps.getRepos())
  )

  server.tool(
    'meta.taskStatuses',
    'List valid task statuses and allowed transitions.',
    {},
    async () => jsonContent(TASK_STATUS_PAYLOAD)
  )

  server.tool(
    'meta.dependencyConditions',
    'List valid dependency condition values for tasks and epics.',
    {},
    async () => jsonContent(DEPENDENCY_CONDITIONS_PAYLOAD)
  )
}
