import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  useReducedMotion: () => false
}))

vi.mock('../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

vi.mock('../../components/task-workbench/TaskWorkbench', () => ({
  TaskWorkbench: () => <div data-testid="task-workbench">Workbench Content</div>
}))

import TaskWorkbenchView from '../TaskWorkbenchView'

describe('TaskWorkbenchView', () => {
  it('renders TaskWorkbench component', () => {
    render(<TaskWorkbenchView />)
    expect(screen.getByTestId('task-workbench')).toBeInTheDocument()
  })

  it('renders with full height wrapper', () => {
    const { container } = render(<TaskWorkbenchView />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.height).toBe('100%')
  })
})
