import { DomainError } from '../errors/domain-error';

import type { PixelDimensions } from './capture-source';

export interface CaptureRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function createCaptureRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): CaptureRegion {
  const values = [x, y, width, height];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new DomainError('INVALID_REGION', 'Capture regions must contain finite coordinates.');
  }

  if (width < 2 || height < 2) {
    throw new DomainError('INVALID_REGION', 'Capture regions must be at least 2 by 2 pixels.', {
      width,
      height,
    });
  }

  return Object.freeze({ x, y, width, height });
}

export function scaleCaptureRegion(region: CaptureRegion, scaleFactor: number): CaptureRegion {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new DomainError('INVALID_REGION', 'Region scale factor must be positive.', {
      scaleFactor,
    });
  }

  return createCaptureRegion(
    Math.round(region.x * scaleFactor),
    Math.round(region.y * scaleFactor),
    Math.max(2, Math.round(region.width * scaleFactor)),
    Math.max(2, Math.round(region.height * scaleFactor)),
  );
}

/**
 * Region coordinates are local to the selected source. Global display coordinates may be
 * negative, but a crop sent to ScreenCaptureKit must remain inside its source raster.
 */
export function captureRegionFitsWithin(
  region: CaptureRegion,
  dimensions: PixelDimensions,
): boolean {
  return (
    region.x >= 0 &&
    region.y >= 0 &&
    region.x + region.width <= dimensions.width &&
    region.y + region.height <= dimensions.height
  );
}

export function assertCaptureRegionFitsWithin(
  region: CaptureRegion,
  dimensions: PixelDimensions,
): void {
  if (!captureRegionFitsWithin(region, dimensions)) {
    throw new DomainError('INVALID_REGION', 'The capture region extends beyond its source.', {
      region,
      dimensions,
    });
  }
}
