import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HeaderTab } from '../HeaderTab';

describe('HeaderTab', () => {
  const defaultProps = {
    label: 'Test Tab',
    isActive: false,
    onClick: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders the tab label', () => {
    render(<HeaderTab {...defaultProps} />);
    expect(screen.getByText('Test Tab')).toBeInTheDocument();
  });

  it('applies active class when isActive is true', () => {
    const { container } = render(<HeaderTab {...defaultProps} isActive={true} />);
    const tab = container.querySelector('.header-tab--active');
    expect(tab).toBeInTheDocument();
  });

  it('applies default class when isActive is false', () => {
    const { container } = render(<HeaderTab {...defaultProps} isActive={false} />);
    const tab = container.querySelector('.header-tab');
    expect(tab).toBeInTheDocument();
    expect(container.querySelector('.header-tab--active')).not.toBeInTheDocument();
  });

  it('calls onClick when tab is clicked', () => {
    const onClick = vi.fn();
    render(<HeaderTab {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole('tab'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<HeaderTab {...defaultProps} onClose={onClose} />);
    const closeButton = screen.getByLabelText('Close Test Tab');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops propagation when close button is clicked', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(<HeaderTab {...defaultProps} onClick={onClick} onClose={onClose} />);
    const closeButton = screen.getByLabelText('Close Test Tab');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders close button by default', () => {
    render(<HeaderTab {...defaultProps} />);
    expect(screen.getByLabelText('Close Test Tab')).toBeInTheDocument();
  });

  it('hides close button when showClose is false', () => {
    render(<HeaderTab {...defaultProps} showClose={false} />);
    expect(screen.queryByLabelText('Close Test Tab')).not.toBeInTheDocument();
  });

  it('does not render dot by default', () => {
    const { container } = render(<HeaderTab {...defaultProps} />);
    expect(container.querySelector('.header-tab__dot')).not.toBeInTheDocument();
  });

  it('renders dot when showDot is true', () => {
    const { container } = render(<HeaderTab {...defaultProps} showDot={true} />);
    expect(container.querySelector('.header-tab__dot')).toBeInTheDocument();
  });

  it('has correct ARIA attributes', () => {
    render(<HeaderTab {...defaultProps} isActive={true} />);
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('title', 'Test Tab');
  });

  it('has correct ARIA attributes when not active', () => {
    render(<HeaderTab {...defaultProps} isActive={false} />);
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('aria-selected', 'false');
  });

  it('is not draggable by default', () => {
    render(<HeaderTab {...defaultProps} />);
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('draggable', 'false');
  });

  it('is draggable when draggable prop is true', () => {
    render(<HeaderTab {...defaultProps} draggable={true} />);
    const tab = screen.getByRole('tab');
    expect(tab).toHaveAttribute('draggable', 'true');
  });

  it('calls onDragStart when drag starts', () => {
    const onDragStart = vi.fn();
    render(<HeaderTab {...defaultProps} draggable={true} onDragStart={onDragStart} />);
    const tab = screen.getByRole('tab');
    fireEvent.dragStart(tab);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('renders X icon in close button', () => {
    render(<HeaderTab {...defaultProps} />);
    const closeButton = screen.getByLabelText('Close Test Tab');
    expect(closeButton.querySelector('svg')).toBeInTheDocument();
  });
});
