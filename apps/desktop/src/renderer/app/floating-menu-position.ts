export interface FloatingRect {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface FloatingSize {
  readonly width: number;
  readonly height: number;
}

export interface FloatingViewport {
  readonly width: number;
  readonly height: number;
}

export interface FloatingMenuPosition {
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly placement: 'above' | 'below';
}

const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 7;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Keeps a floating menu visible and gives it a scrollable height in compact windows. */
export function calculateFloatingMenuPosition(
  trigger: FloatingRect,
  menu: FloatingSize,
  viewport: FloatingViewport,
): FloatingMenuPosition {
  const spaceBelow = Math.max(0, viewport.height - VIEWPORT_MARGIN - trigger.bottom - TRIGGER_GAP);
  const spaceAbove = Math.max(0, trigger.top - VIEWPORT_MARGIN - TRIGGER_GAP);
  const placement = menu.height > spaceBelow && spaceAbove > spaceBelow ? 'above' : 'below';
  const maxHeight = placement === 'above' ? spaceAbove : spaceBelow;
  const visibleHeight = Math.min(menu.height, maxHeight);
  const top =
    placement === 'above'
      ? trigger.top - TRIGGER_GAP - visibleHeight
      : trigger.bottom + TRIGGER_GAP;
  const left = clamp(
    trigger.right - menu.width,
    VIEWPORT_MARGIN,
    viewport.width - VIEWPORT_MARGIN - menu.width,
  );

  return { top, left, maxHeight, placement };
}
