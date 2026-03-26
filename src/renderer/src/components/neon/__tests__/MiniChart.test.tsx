import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MiniChart, type ChartBar } from '../MiniChart';
import { tokens } from '../../../design-system/tokens';

const data: ChartBar[] = [
  { value: 70, accent: 'cyan' },
  { value: 45, accent: 'pink' },
  { value: 85, accent: 'blue' },
  { value: 30, accent: 'orange' },
];

describe('MiniChart', () => {
  it('renders correct number of bars', () => {
    const { container } = render(<MiniChart data={data} />);
    const bars = container.querySelectorAll('[data-role="chart-bar"]');
    expect(bars).toHaveLength(4);
  });

  it('normalizes bar heights relative to max value', () => {
    const { container } = render(<MiniChart data={data} />);
    const bars = container.querySelectorAll('[data-role="chart-bar"]') as NodeListOf<HTMLElement>;
    expect(bars[2].style.height).toBe('100%');
    expect(bars[3].style.height).toBe('35%');
  });

  it('renders empty state when no data', () => {
    const { container } = render(<MiniChart data={[]} />);
    expect(container.textContent).toContain('No data');
    const emptyDiv = container.firstElementChild as HTMLElement;
    expect(emptyDiv.style.color).toBe(tokens.neon.textDim);
    expect(emptyDiv.style.fontSize).toBe(tokens.size.xs);
  });

  it('uses purple as default accent when bar has no accent', () => {
    const noAccentData: ChartBar[] = [{ value: 50 }];
    const { container } = render(<MiniChart data={noAccentData} />);
    const bar = container.querySelector('[data-role="chart-bar"]') as HTMLElement;
    expect(bar.style.background).toContain('var(--neon-purple)');
  });
});
