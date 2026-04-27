import type { ReactNode } from 'react'

type KbdProps = {
  children: ReactNode
}

export function Kbd({ children }: KbdProps): React.JSX.Element {
  return <kbd className="fleet-kbd">{children}</kbd>
}
