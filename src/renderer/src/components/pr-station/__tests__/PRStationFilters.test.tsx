import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRStationFilters, type PRFilters } from '../PRStationFilters'

const defaultFilters: PRFilters = { repo: null, sort: 'updated' }
const repos = ['BDE', 'life-os']

describe('PRStationFilters', () => {
  it('renders All button and per-repo buttons', () => {
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'BDE' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'life-os' })).toBeInTheDocument()
  })

  it('marks All button as active when repo filter is null', () => {
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'BDE' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks repo button as active when that repo is selected', () => {
    const filters: PRFilters = { repo: 'BDE', sort: 'updated' }
    render(<PRStationFilters filters={filters} repos={repos} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'BDE' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onChange with null repo when All is clicked', async () => {
    const onChange = vi.fn()
    const filters: PRFilters = { repo: 'BDE', sort: 'updated' }
    render(<PRStationFilters filters={filters} repos={repos} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onChange).toHaveBeenCalledWith({ repo: null, sort: 'updated' })
  })

  it('calls onChange with repo name when repo button is clicked', async () => {
    const onChange = vi.fn()
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'life-os' }))
    expect(onChange).toHaveBeenCalledWith({ repo: 'life-os', sort: 'updated' })
  })

  it('renders sort select with correct options', () => {
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={vi.fn()} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last updated' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Created' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Title' })).toBeInTheDocument()
  })

  it('calls onChange with new sort when sort changes', async () => {
    const onChange = vi.fn()
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByRole('combobox'), 'title')
    expect(onChange).toHaveBeenCalledWith({ repo: null, sort: 'title' })
  })

  it('renders no repo buttons when repos list is empty', () => {
    render(<PRStationFilters filters={defaultFilters} repos={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BDE' })).not.toBeInTheDocument()
  })

  it('has accessible group label', () => {
    render(<PRStationFilters filters={defaultFilters} repos={repos} onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: /filter pull requests/i })).toBeInTheDocument()
  })
})
