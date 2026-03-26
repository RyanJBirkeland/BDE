export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.getRepoPaths()
}

export interface AgentConfig {
  binary: string | null
  permissionMode: string | null
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return window.api.getAgentConfig()
}

export async function saveAgentConfig(config: {
  binary: string
  permissionMode: string
}): Promise<void> {
  return window.api.saveAgentConfig(config)
}
