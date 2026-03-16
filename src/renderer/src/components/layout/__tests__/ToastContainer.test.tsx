import { describe, it, expect, vi, beforeEach } from 'vitest'
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
        { id: '2', message: 'Error!', type: 'error' },
      ],
    })
    render(<ToastContainer />)
    expect(screen.getByText('Success!')).toBeInTheDocument()
    expect(screen.getByText('Error!')).toBeInTheDocument()
  })

  it('success toast has correct styling class', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Done', type: 'success' }],
    })
    render(<ToastContainer />)
    const toastEl = screen.getByText('Done')
    expect(toastEl).toHaveClass('toast--success')
  })

  it('error toast has correct styling class', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Fail', type: 'error' }],
    })
    render(<ToastContainer />)
    expect(screen.getByText('Fail')).toHaveClass('toast--error')
  })

  it('info toast has correct styling class', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Info', type: 'info' }],
    })
    render(<ToastContainer />)
    expect(screen.getByText('Info')).toHaveClass('toast--info')
  })

  it('dismisses toast on click', async () => {
    const user = userEvent.setup()
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Click me', type: 'success' }],
    })
    render(<ToastContainer />)

    await user.click(screen.getByText('Click me'))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
