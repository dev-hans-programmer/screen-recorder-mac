import { useEffect, useMemo, useState, type PointerEvent, type ReactElement } from 'react';

interface SelectionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function normalizeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): SelectionRect {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

function toPhysicalRegion(rect: SelectionRect, scaleFactor: number) {
  return {
    x: Math.round(rect.left * scaleFactor),
    y: Math.round(rect.top * scaleFactor),
    width: Math.max(2, Math.round(rect.width * scaleFactor)),
    height: Math.max(2, Math.round(rect.height * scaleFactor)),
  };
}

function adjustRect(
  rect: SelectionRect,
  key: string,
  step: number,
  resize: boolean,
  viewportWidth: number,
  viewportHeight: number,
): SelectionRect {
  if (resize) {
    const widthDelta = key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0;
    const heightDelta = key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0;
    return {
      ...rect,
      width: Math.max(2, Math.min(viewportWidth - rect.left, rect.width + widthDelta)),
      height: Math.max(2, Math.min(viewportHeight - rect.top, rect.height + heightDelta)),
    };
  }

  const horizontalDelta = key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0;
  const verticalDelta = key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0;
  return {
    ...rect,
    left: Math.max(0, Math.min(viewportWidth - rect.width, rect.left + horizontalDelta)),
    top: Math.max(0, Math.min(viewportHeight - rect.height, rect.top + verticalDelta)),
  };
}

export function RegionSelector(): ReactElement {
  const [start, setStart] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [rect, setRect] = useState<SelectionRect | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const scaleFactor = window.devicePixelRatio || 1;
  const physicalRect = useMemo(
    () => (rect === null ? null : toPhysicalRegion(rect, scaleFactor)),
    [rect, scaleFactor],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.screenRecorder.cancelRegionSelection();
      }
      if (event.key === 'Enter' && rect !== null && rect.width >= 2 && rect.height >= 2) {
        event.preventDefault();
        window.screenRecorder.submitRegionSelection(toPhysicalRegion(rect, scaleFactor));
      }
      if (
        rect !== null &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        setRect(
          adjustRect(
            rect,
            event.key,
            event.altKey ? 10 : event.shiftKey ? 10 : 1,
            event.shiftKey,
            window.innerWidth,
            window.innerHeight,
          ),
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rect, scaleFactor]);

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => ({
    x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
    y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setStart(point);
    setRect({ left: point.x, top: point.y, width: 0, height: 0 });
    setIsSelecting(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isSelecting || start === null) return;
    const point = pointFromEvent(event);
    setRect(normalizeRect(start.x, start.y, point.x, point.y));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isSelecting || start === null) return;
    const point = pointFromEvent(event);
    const completedRect = normalizeRect(start.x, start.y, point.x, point.y);
    setRect(completedRect);
    setStart(null);
    setIsSelecting(false);
  };

  return (
    <main
      aria-label="Select a region to record"
      className="region-selector-root"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="region-selector-hint">
        <strong>Drag to select a region</strong>
        <span>
          Arrow keys move · Shift + Arrow resizes · Enter confirms · Escape cancels · {scaleFactor}×
          display
        </span>
      </div>
      {rect !== null && rect.width >= 2 && rect.height >= 2 && (
        <div
          aria-live="polite"
          className="region-selection-box"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <span>
            {physicalRect?.width} × {physicalRect?.height} px ·{' '}
            {((physicalRect?.width ?? 0) / Math.max(1, physicalRect?.height ?? 1)).toFixed(2)}:1
          </span>
        </div>
      )}
    </main>
  );
}
