import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer } from '../ToastContainer'
import { useToastStore } from '../../../stores/toasts'

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('returns null when no toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container.innerHTML).toBe('')
  })

  it('renders toasts from store', () => {
    useToastStore.setState({
      toasts: [
        { id: '1', message: 'Success!', type: 'success' },
        { id: '2', message: 'Error!', type: 'error' }
      ]
    })
    render(<ToastContainer />)
    expect(screen.getByText('Success!')).toBeInTheDocument()
    expect(screen.getByText('Error!')).toBeInTheDocument()
  })

  it('renders success toast with message text', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Done', type: 'success' }]
    })
    render(<ToastContainer />)
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders error toast with message text', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Fail', type: 'error' }]
    })
    render(<ToastContainer />)
    expect(screen.getByText('Fail')).toBeInTheDocument()
  })

  it('renders info toast with message text', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Info', type: 'info' }]
    })
    render(<ToastContainer />)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('dismisses toast on click and removes it from DOM', async () => {
    const user = userEvent.setup()
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Click me', type: 'success' }]
    })
    render(<ToastContainer />)

    expect(screen.getByText('Click me')).toBeInTheDocument()
    await user.click(screen.getByText('Click me'))
    expect(screen.queryByText('Click me')).not.toBeInTheDocument()
  })

  it('renders undo button for undoable toasts', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Session killed', type: 'info', onUndo: () => {} }]
    })
    render(<ToastContainer />)
    expect(screen.getByText('Undo')).toBeInTheDocument()
  })

  it('renders action button when action and onAction are set', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Agent done', type: 'info', action: 'View', onAction: () => {} }]
    })
    render(<ToastContainer />)
    expect(screen.getByText('View')).toBeInTheDocument()
  })
})
