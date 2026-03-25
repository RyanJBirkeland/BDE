import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ParticleField } from '../ParticleField';

describe('ParticleField', () => {
  it('renders particles', () => {
    const { container } = render(<ParticleField density={5} />);
    const particles = container.querySelectorAll('[data-role="particle"]');
    expect(particles).toHaveLength(5);
  });

  it('renders with pointer-events none', () => {
    const { container } = render(<ParticleField />);
    const field = container.firstChild as HTMLElement;
    expect(field.style.pointerEvents).toBe('none');
  });

  it('defaults to 18 particles', () => {
    const { container } = render(<ParticleField />);
    const particles = container.querySelectorAll('[data-role="particle"]');
    expect(particles).toHaveLength(18);
  });
});
