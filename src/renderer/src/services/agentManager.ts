/**
 * Agent Manager service — thin wrappers around the agent-manager IPC surface.
 *
 * Renderer code (views, hooks, components) must call these wrappers instead of
 * touching `window.api.agentManager.*` directly. Keeping the IPC surface behind
 * a service module lets us swap transport, add telemetry, or stub in tests
 * without editing every call site.
 */

export async function killPipelineAgent(
  taskId: string
): ReturnType<typeof window.api.agentManager.kill> {
  return window.api.agentManager.kill(taskId)
}

export async function triggerDrain(): Promise<void> {
  return window.api.agentManager.triggerDrain()
}
