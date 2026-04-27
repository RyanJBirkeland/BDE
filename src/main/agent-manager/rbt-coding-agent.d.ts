declare module 'rbt-coding-agent/adapters/fleet' {
  export interface FleetSpawnOptions {
    readonly prompt: string
    readonly cwd: string
    readonly model: string
  }

  export interface FleetAgentHandle {
    readonly messages: AsyncIterable<unknown>
    close(): Promise<void>
  }

  export function spawnFleetAgent(options: FleetSpawnOptions): Promise<FleetAgentHandle>
}
