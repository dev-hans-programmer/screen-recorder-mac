import { DomainError } from '../errors/domain-error';
import type { CaptureRegion } from './capture-region';

export interface CaptureSourceSelection {
  readonly sourceId: string;
  readonly region: CaptureRegion | undefined;
}

export function createCaptureSourceSelection(
  sourceId: string,
  region?: CaptureRegion,
): CaptureSourceSelection {
  if (sourceId.trim().length === 0) {
    throw new DomainError('INVALID_CAPTURE_SOURCE', 'A capture source selection requires an id.');
  }

  return Object.freeze({ sourceId, region });
}
