import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DependencyPicker } from '../DependencyPicker'
import type { TaskDependency, SprintTask } from '../../../../../shared/types'

const mockTasks = [
  { id: '1', title: 'Setup DB', status: 'done', repo: 'bde' },
  { id: '2', title: 'Build API', status: 'queued', repo: 'bde' },
  { id: '3', title: 'Write Tests', status: 'backlog', repo: 'bde' }
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

  it('renders inline hard/soft help text under the label', () => {
    render(
      <DependencyPicker
        dependencies={[]}
        availableTasks={mockTasks}
        onChange={vi.fn()}
        currentTaskId={undefined}
      />
    )
    expect(screen.getByText(/Hard = blocks on upstream failure/i)).toBeInTheDocument()
    expect(screen.getByText(/Soft = unblocks regardless/i)).toBeInTheDocument()
  })

  describe('show-all results', () => {
    const makeTasks = (count: number): SprintTask[] =>
      Array.from(
        { length: count },
        (_, i) => ({ id: `t${i}`, title: `Task ${i}`, status: 'queued', repo: 'bde' }) as SprintTask
      )

    it('shows footer when matches exceed window of 30', async () => {
      render(
        <DependencyPicker
          dependencies={[]}
          availableTasks={makeTasks(31)}
          onChange={vi.fn()}
          currentTaskId={undefined}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
      expect(
        screen.getByRole('button', { name: /Showing 30 of 31 — Show all/i })
      ).toBeInTheDocument()
      // 31st item is hidden until "Show all"
      expect(screen.queryByText('Task 30')).not.toBeInTheDocument()
    })

    it('reveals all matches after clicking "Show all"', async () => {
      render(
        <DependencyPicker
          dependencies={[]}
          availableTasks={makeTasks(31)}
          onChange={vi.fn()}
          currentTaskId={undefined}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
      await userEvent.click(screen.getByRole('button', { name: /Show all/i }))
      expect(screen.getByText('Task 30')).toBeInTheDocument()
      // Footer is gone once expanded
      expect(screen.queryByRole('button', { name: /Show all/i })).not.toBeInTheDocument()
    })

    it('does not show footer when matches fit the window', async () => {
      render(
        <DependencyPicker
          dependencies={[]}
          availableTasks={makeTasks(30)}
          onChange={vi.fn()}
          currentTaskId={undefined}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
      expect(screen.queryByRole('button', { name: /Show all/i })).not.toBeInTheDocument()
      expect(screen.getByText('Task 29')).toBeInTheDocument()
    })

    it('changing search resets the show-all expansion', async () => {
      render(
        <DependencyPicker
          dependencies={[]}
          availableTasks={makeTasks(31)}
          onChange={vi.fn()}
          currentTaskId={undefined}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /add dependency/i }))
      await userEvent.click(screen.getByRole('button', { name: /Show all/i }))
      // Type something that still matches >30 to verify the footer reappears
      await userEvent.type(screen.getByRole('textbox'), 'Task')
      expect(screen.getByRole('button', { name: /Show all/i })).toBeInTheDocument()
      expect(screen.queryByText('Task 30')).not.toBeInTheDocument()
    })
  })
})
