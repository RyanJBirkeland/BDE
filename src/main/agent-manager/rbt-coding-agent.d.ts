declare module 'rbt-coding-agent/adapters/bde' {
  export interface BdeSpawnOptions {
    readonly prompt: string
    readonly cwd: string
    readonly model: string
  }

  export interface BdeAgentHandle {
    readonly messages: AsyncIterable<unknown>
    close(): Promise<void>
  }

  export function spawnBdeAgent(options: BdeSpawnOptions): Promise<BdeAgentHandle>
}
