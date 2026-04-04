import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DependencyPicker } from '../DependencyPicker'
import type { TaskDependency, SprintTask } from '../../../../../shared/types'

const mockTasks = [
  { id: '1', title: 'Setup DB', status: 'done', repo: 'bde' },
  { id: '2', title: 'Build API', status: 'queued', repo: 'bde' },
  { id: '3', title: 'Write Tests', status: 'backlog', repo: 'bde' },
] as SprintTask[]

describe('DependencyPicker', () => {
  it('renders selected dependencies', () => {
    const deps: TaskDependency[] = [{ id: '1', type: 'hard' }]
    render(
      <DependencyPicker
        dependencies={deps}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(screen.getByText(/Setup DB/)).toBeInTheDocument()
  })

  it('renders hard/soft type badge on selected dep', () => {
    const deps: TaskDependency[] = [{ id: '1', type: 'hard' }]
    render(
      <DependencyPicker
        dependencies={deps}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(screen.getByRole('button', { name: /hard/i })).toBeInTheDocument()
  })

  it('shows add dependency button when no deps selected', () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(screen.getByRole('button', { name: /add dependency/i })).toBeInTheDocument()
  })

  it('filters out current task from available list', async () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId="1"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    expect(screen.queryByText('Setup DB')).not.toBeInTheDocument()
    expect(screen.getByText('Build API')).toBeInTheDocument()
  })

  it('filters out already-selected tasks from available list', async () => {
    const deps: TaskDependency[] = [{ id: '2', type: 'hard' }]
    render(
      <DependencyPicker
        dependencies={deps}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    // 'Build API' appears only in the pill (selected dep), not in the dropdown results
    const results = screen.getByRole('listbox', { name: /task results/i })
    expect(results).not.toHaveTextContent('Build API')
    expect(results).toHaveTextContent('Setup DB')
  })

  it('calls onChange when dependency added', async () => {
    const onChange = vi.fn()
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={onChange}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await userEvent.click(screen.getByText('Setup DB'))
    expect(onChange).toHaveBeenCalledWith([{ id: '1', type: 'hard' }])
  })

  it('calls onChange when dependency removed', async () => {
    const onChange = vi.fn()
    render(
      <DependencyPicker
        dependencies={[{ id: '1', type: 'hard' }]}
        availableTasks={mockTasks}
        onChange={onChange}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('toggles type between hard and soft', async () => {
    const onChange = vi.fn()
    render(
      <DependencyPicker
        dependencies={[{ id: '1', type: 'hard' }]}
        availableTasks={mockTasks}
        onChange={onChange}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /hard/i }))
    expect(onChange).toHaveBeenCalledWith([{ id: '1', type: 'soft' }])
  })

  it('filters tasks by search input', async () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await userEvent.type(screen.getByRole('textbox'), 'build')
    expect(screen.getByText('Build API')).toBeInTheDocument()
    expect(screen.queryByText('Setup DB')).not.toBeInTheDocument()
    expect(screen.queryByText('Write Tests')).not.toBeInTheDocument()
  })

  it('shows no matching tasks message when search yields nothing', async () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    await userEvent.type(screen.getByRole('textbox'), 'zzznomatch')
    expect(screen.getByText(/no matching tasks/i)).toBeInTheDocument()
  })

  it('closes dropdown when Escape is pressed', async () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders task status in dropdown results', async () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()
  })
})
