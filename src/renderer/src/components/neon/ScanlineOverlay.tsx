interface ScanlineOverlayProps {
  opacity?: number
}

export function ScanlineOverlay({ opacity }: ScanlineOverlayProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.03) 2px, rgba(255, 255, 255, 0.03) 4px)',
        backgroundSize: '100% 200px',
        opacity: opacity ?? undefined,
        animation: 'neon-scanline var(--neon-scanline-speed) linear infinite',
        zIndex: 0
      }}
      className="neon-scanline-overlay"
    />
  )
}
