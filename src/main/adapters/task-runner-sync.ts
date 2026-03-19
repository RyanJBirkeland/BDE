/**
 * Task runner sync adapter — optional fire-and-forget sync to the
 * bde-task-runner service when it is configured. Sync failures are
 * non-fatal and silently ignored.
 */
import { getTaskRunnerConfig } from '../config'

export function syncToTaskRunner(method: string, path: string, body?: unknown): void {
  const cfg = getTaskRunnerConfig()
  if (!cfg) return

  fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => {
    // Fire-and-forget — sync failures are non-fatal
  })
}
