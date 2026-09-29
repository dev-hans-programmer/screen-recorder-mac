import { DomainError } from '../errors/domain-error';

export type CaptureSourceKind = 'display' | 'window' | 'application' | 'region';

export interface PixelDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CaptureSource {
  readonly id: string;
  readonly kind: CaptureSourceKind;
  readonly name: string;
  readonly dimensions: PixelDimensions | undefined;
  readonly scaleFactor: number | undefined;
  readonly isAvailable: boolean;
}

export interface CaptureSourceInput {
  readonly id: string;
  readonly kind: CaptureSourceKind;
  readonly name: string;
  readonly dimensions?: PixelDimensions;
  readonly scaleFactor?: number;
  readonly isAvailable?: boolean;
}

export function createPixelDimensions(width: number, height: number): PixelDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new DomainError(
      'INVALID_VALUE',
      'Capture dimensions must be positive integer pixel values.',
      { width, height },
    );
  }

  return Object.freeze({ width, height });
}

export function createCaptureSource(input: CaptureSourceInput): CaptureSource {
  if (input.id.trim().length === 0 || input.name.trim().length === 0) {
    throw new DomainError('INVALID_CAPTURE_SOURCE', 'Capture sources require an id and name.');
  }

  if (
    input.scaleFactor !== undefined &&
    (!Number.isFinite(input.scaleFactor) || input.scaleFactor <= 0)
  ) {
    throw new DomainError(
      'INVALID_CAPTURE_SOURCE',
      'Capture source scale factor must be positive.',
      {
        scaleFactor: input.scaleFactor,
      },
    );
  }

  return Object.freeze({
    id: input.id,
    kind: input.kind,
    name: input.name,
    dimensions:
      input.dimensions === undefined
        ? undefined
        : createPixelDimensions(input.dimensions.width, input.dimensions.height),
    scaleFactor: input.scaleFactor,
    isAvailable: input.isAvailable ?? true,
  });
}
