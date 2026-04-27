export interface FleetPlugin {
  name: string
  version?: string
  onTaskCreated?: (task: { id: string; title: string; repo: string }) => void | Promise<void>
  onTaskCompleted?: (task: { id: string; title: string; status: string }) => void | Promise<void>
  onAgentSpawned?: (info: { taskId: string; branch: string }) => void | Promise<void>
}
