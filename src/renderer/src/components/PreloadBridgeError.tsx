export function PreloadBridgeError(): React.JSX.Element {
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#0A0A0A',
        color: '#E5E5E5',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif'
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>BDE could not initialize</h1>
        <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
          The preload bridge failed to attach, so the app has no way to talk to the main process.
          This usually means macOS quarantined the download or the app bundle is damaged.
        </p>
        <p style={{ marginBottom: 8, fontWeight: 600 }}>Try one of the following:</p>
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Quit BDE, then relaunch it by right-clicking the app and choosing Open.</li>
          <li>
            In Terminal, run{' '}
            <code
              style={{
                background: '#1F1F1F',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'ui-monospace, "JetBrains Mono", monospace'
              }}
            >
              xattr -dr com.apple.quarantine /Applications/BDE.app
            </code>{' '}
            and launch again.
          </li>
          <li>If the problem persists, reinstall BDE from the latest release.</li>
        </ol>
        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
          Diagnostic: window.api is undefined. Preload script did not execute.
        </p>
      </div>
    </div>
  )
}
