import type { ReactNode } from 'react'

type KbdProps = {
  children: ReactNode
}

export function Kbd({ children }: KbdProps) {
  return <kbd className="bde-kbd">{children}</kbd>
}
