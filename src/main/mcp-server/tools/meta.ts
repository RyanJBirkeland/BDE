import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
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

/**
 * Meta tools take no arguments. A strict empty object rejects any caller
 * who smuggles extra fields — parity with the task/epic tools, which
 * surface a validation error instead of silently dropping the field.
 */
const NoArgsSchema = z.object({}).strict()

export function registerMetaTools(server: McpServer, deps: MetaToolsDeps): void {
  server.registerTool(
    'meta.repos',
    {
      description: 'List repositories configured in BDE Settings.',
      inputSchema: NoArgsSchema
    },
    async () => jsonContent(deps.getRepos())
  )

  server.registerTool(
    'meta.taskStatuses',
    {
      description: 'List valid task statuses and allowed transitions.',
      inputSchema: NoArgsSchema
    },
    async () => jsonContent(TASK_STATUS_PAYLOAD)
  )

  server.registerTool(
    'meta.dependencyConditions',
    {
      description: 'List valid dependency condition values for tasks and epics.',
      inputSchema: NoArgsSchema
    },
    async () => jsonContent(DEPENDENCY_CONDITIONS_PAYLOAD)
  )
}
