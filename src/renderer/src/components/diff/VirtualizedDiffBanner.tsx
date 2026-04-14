import React from 'react'

interface VirtualizedDiffBannerProps {
  onForceFullDiff: () => void
}

export function VirtualizedDiffBanner({
  onForceFullDiff
}: VirtualizedDiffBannerProps): React.JSX.Element {
  return (
    <div className="diff-virtualized-banner">
      <span className="diff-virtualized-banner__text">
        Large diff — commenting disabled in virtualized mode.
      </span>
      <button
        className="diff-virtualized-banner__button bde-btn bde-btn--sm"
        onClick={onForceFullDiff}
      >
        Load full diff to enable comments
      </button>
    </div>
  )
}
