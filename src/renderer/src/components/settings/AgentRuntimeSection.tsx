/**
 * AgentRuntimeSection — agent binary path and permission mode configuration.
 * Note: Agent configuration has been moved to the task-runner.
 */
export function AgentRuntimeSection(): React.JSX.Element {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Agent Runtime</h2>
      <p className="settings-section__info">
        Agent runtime configuration (binary path and permission mode) is now managed by the
        task-runner service and is no longer configurable from BDE.
      </p>
    </section>
  )
}
