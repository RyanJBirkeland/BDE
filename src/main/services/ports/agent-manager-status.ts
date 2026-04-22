/**
 * Narrow read-only port that services depend on instead of the concrete
 * `AgentManager` interface from `src/main/agent-manager`. The dependency
 * direction the audit cares about: services live below the agent manager in
 * the layering, so they cannot import its full surface — they get a
 * service-owned interface that the composition root can satisfy with the real
 * agent manager (or a test stub).
 */

import type { AgentManagerStatus } from '../../agent-manager'
import type { MetricsSnapshot } from '../../agent-manager/metrics'

export interface AgentManagerStatusReader {
  getStatus(): AgentManagerStatus
  getMetrics(): MetricsSnapshot
}
