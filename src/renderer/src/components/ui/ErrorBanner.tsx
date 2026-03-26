type ErrorBannerProps = {
  message: string | null
  className?: string
}

export function ErrorBanner({ message, className }: ErrorBannerProps) {
  if (!message) return null
  return <div className={`bde-error-banner${className ? ` ${className}` : ''}`}>{message}</div>
}
