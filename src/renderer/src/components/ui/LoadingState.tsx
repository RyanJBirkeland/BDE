interface LoadingStateProps {
  message?: string | undefined
  className?: string | undefined
}

export function LoadingState({
  message = 'Loading...',
  className
}: LoadingStateProps): React.JSX.Element {
  const cls = ['bde-loading-state', className].filter(Boolean).join(' ')
  return <div className={cls}>{message}</div>
}
