import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCounter } from '../StatCounter';

describe('StatCounter', () => {
  it('renders label and value', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders trend when provided', () => {
    render(<StatCounter label="Cost" value="$4.20" accent="orange" trend={{ direction: 'down', label: '12% vs yesterday' }} />);
    expect(screen.getByText(/12% vs yesterday/)).toBeInTheDocument();
  });

  it('renders suffix text', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" suffix="live" />);
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('applies accent color to label', () => {
    const { container } = render(<StatCounter label="Tasks" value={17} accent="pink" />);
    const label = container.querySelector('[data-role="stat-label"]') as HTMLElement;
    expect(label.style.color).toBe('var(--neon-pink)');
  });
});
