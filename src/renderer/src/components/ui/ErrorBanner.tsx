type ErrorBannerProps = {
  message: string | null
  className?: string | undefined
}

export function ErrorBanner({ message, className }: ErrorBannerProps): React.JSX.Element | null {
  if (!message) return null
  return <div className={`bde-error-banner${className ? ` ${className}` : ''}`}>{message}</div>
}
