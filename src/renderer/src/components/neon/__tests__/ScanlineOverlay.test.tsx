import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScanlineOverlay } from '../ScanlineOverlay';

describe('ScanlineOverlay', () => {
  it('renders with pointer-events none', () => {
    const { container } = render(<ScanlineOverlay />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('renders with absolute positioning', () => {
    const { container } = render(<ScanlineOverlay />);
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.style.position).toBe('absolute');
  });
});
