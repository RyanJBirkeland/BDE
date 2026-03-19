export interface GatewayUrlInfo {
  url: string
  hasToken: boolean
}

export async function loadConfig(): Promise<GatewayUrlInfo> {
  return window.api.getGatewayUrl()
}

export async function saveConfig(url: string, token?: string): Promise<void> {
  return window.api.saveGatewayConfig(url, token)
}

export async function testConnection(
  url: string,
  token?: string
): Promise<{ ok: boolean; latencyMs: number }> {
  return window.api.testGatewayConnection(url, token)
}

export async function getRepoPaths(): Promise<Record<string, string>> {
  return window.api.getRepoPaths()
}

export interface AgentConfig {
  binary: string
  permissionMode: string
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return window.api.getAgentConfig()
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  return window.api.saveAgentConfig(config)
}
