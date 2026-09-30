import { describe, expect, it } from 'vitest';

import { calculateFloatingMenuPosition } from '../src/renderer/app/floating-menu-position';

describe('floating menu positioning', () => {
  it('opens above a trigger near the bottom of the window', () => {
    const position = calculateFloatingMenuPosition(
      { top: 680, right: 900, bottom: 710 },
      { width: 180, height: 160 },
      { width: 1_000, height: 740 },
    );

    expect(position.placement).toBe('above');
    expect(position.top).toBe(513);
    expect(position.left).toBe(720);
  });

  it('constrains a tall menu so its options can scroll inside a compact window', () => {
    const position = calculateFloatingMenuPosition(
      { top: 100, right: 300, bottom: 130 },
      { width: 180, height: 600 },
      { width: 320, height: 300 },
    );

    expect(position.placement).toBe('below');
    expect(position.maxHeight).toBe(151);
    expect(position.left).toBe(120);
  });

  it('keeps the menu inside the left viewport edge', () => {
    const position = calculateFloatingMenuPosition(
      { top: 30, right: 80, bottom: 60 },
      { width: 160, height: 80 },
      { width: 600, height: 400 },
    );

    expect(position.left).toBe(12);
  });
});
