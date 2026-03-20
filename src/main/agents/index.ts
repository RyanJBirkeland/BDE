export type { AgentProvider, AgentHandle, AgentEvent, AgentSpawnOptions, AgentEventType } from './types'
import type { AgentProvider } from './types'
import { getAgentProvider } from '../config'
import { CliProvider } from './cli-provider'
import { SdkProvider } from './sdk-provider'

export function createAgentProvider(): AgentProvider {
  return getAgentProvider() === 'cli' ? new CliProvider() : new SdkProvider()
}
